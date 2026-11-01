// Persistent local job coordination. Classification itself is in semantic.js.
(function (root) {
  const engine = () => root.RadarSemantic || require('./semantic');
  const WEEK = 7 * 86400000;
  const clean = item => { const { semantic, assessment, ...copy } = item; return copy; };
  function trim(entries, prior = 0) {
    let bytes = 128, dropped = 0;
    const ordered = Object.values(entries).sort((a,b) => Date.parse(b.item.createdAt) - Date.parse(a.item.createdAt));
    for (const [index, entry] of ordered.entries()) {
      const encoded = JSON.stringify({ [entry.item.id]: entry });
      const size = typeof TextEncoder === 'function' ? new TextEncoder().encode(encoded).length : encoded.length * 3;
      if (index >= 1000 || bytes + size > 2 * 1024 * 1024) { delete entries[entry.item.id]; dropped++; }
      else bytes += size;
    }
    return Math.max(Number(prior) || 0, dropped);
  }
  function decision(item, result, now) {
    if (!result || result.version !== 1 || result.key !== engine().key(item)) return null;
    if (!engine().CATEGORIES.includes(result.category) || typeof result.evidence !== 'string' || result.evidence.length > 500) return null;
    if (['unrelated', 'cancelled'].includes(result.category)) {
      if (result.evidence && !item.text.includes(result.evidence)) return null;
    } else if (!engine().hint({ ...item, semantic: result }, { now })) return null;
    return { version: 1, key: result.key, category: result.category, evidence: result.evidence };
  }
  const cooldown = attempts => Math.min(1800000, 60000 * 2 ** Math.min(5, Math.max(0, attempts - 1)));
  async function run({ items = [], state = {}, api, now = Date.now(), maxItems = 1000, budgetMs = 90000, itemTimeoutMs = 45000, signal,
    onCheckpoint = async () => {} } = {}) {
    const entries = Object.create(null);
    const valid = item => engine().input(item) && Date.parse(item.createdAt) <= now + 300000 && now - Date.parse(item.createdAt) <= WEEK;
    for (const entry of Object.values(state?.entries || {})) {
      if (!entry?.item || !valid(entry.item)) continue;
      const item = clean(entry.item), key = engine().key(item);
      entries[item.id] = { item, key, attempts: Math.max(0, Math.min(100, Number(entry.attempts) || 0)),
        lastTriedAt: Math.min(now, Math.max(0, Number(entry.lastTriedAt) || 0)), result: decision(item, entry.result, now), lastError: entry.lastError || null, errorPhase: entry.errorPhase || null, errorDetail: String(entry.errorDetail || '').slice(0,180) };
    }
    for (const raw of items) {
      if (!valid(raw)) continue;
      let item = clean(raw);
      const previous = entries[item.id];
      if (previous && previous.item.text === item.text && previous.item.createdAt === item.createdAt &&
        !engine().input(item).parent && engine().input(previous.item).parent) item = { ...item,
          replyContext: previous.item.replyContext, semanticContext: previous.item.semanticContext };
      const key = engine().key(item);
      entries[item.id] = previous?.key === key ? { ...previous, item } : { item, key, attempts: 0, lastTriedAt: 0, result: null };
    }
    // Storage.local is shared with the account and collector caches. Bound bytes as well as rows.
    const saved = { entries, overflow: trim(entries, state?.overflow) };
    await onCheckpoint(saved);
    let availabilityTimer;
    const availability = await Promise.race([engine().available(api), new Promise(resolve => {
      availabilityTimer = setTimeout(() => resolve({ state: 'error' }), 1500);
    })]).finally(() => clearTimeout(availabilityTimer));
    const started = Date.now();
    // Injected `now` plus real elapsed wall time, so cooldowns reflect when each attempt actually ran.
    const clock = () => now + Math.max(0, Date.now() - started);
    const limit = Number.isFinite(Number(maxItems)) ? Math.max(0, Math.floor(Number(maxItems))) : 1000;
    let error = null, processed = 0;
    if (availability.state === 'available' && limit > 0) {
      // Unattempted rows (lastTriedAt 0) first, newest first; then retries by oldest attempt for fairness.
      const pending = Object.values(entries).filter(e => !e.result && (!e.lastTriedAt || now - e.lastTriedAt >= cooldown(e.attempts)))
        .sort((a,b) => a.lastTriedAt - b.lastTriedAt || Date.parse(b.item.createdAt) - Date.parse(a.item.createdAt));
      for (const entry of pending) {
        if (signal?.aborted || processed >= limit || Date.now() - started >= budgetMs) break;
        processed++;
        const priorAttempt = { lastTriedAt: entry.lastTriedAt, attempts: entry.attempts };
        entry.lastTriedAt = clock(); entry.attempts++;
        const controller = new AbortController();
        const abort = () => controller.abort();
        signal?.addEventListener('abort', abort, { once: true });
        let timer, progressTimer, finished = false;
        // Persist real in-flight progress while slow native inference is pending.
        // Extension storage calls also keep the bounded worker task alive.
        const progress = async () => {
          if (finished || controller.signal.aborted || signal?.aborted) return;
          try { await onCheckpoint(saved); } catch { /* The final checkpoint reports storage failures. */ }
          if (!finished && !controller.signal.aborted && !signal?.aborted) progressTimer = setTimeout(progress, 15000);
        };
        progressTimer = setTimeout(progress, 15000);
        try {
          const timeout = new Promise((_, reject) => { timer = setTimeout(() => {
            reject(new Error('semantic-timeout')); controller.abort();
          }, Math.max(1, Math.min(itemTimeoutMs, budgetMs - (Date.now() - started)))); });
          const result = await Promise.race([engine().judge(entry.item, { api, signal: controller.signal }), timeout]);
          if (controller.signal.aborted || signal?.aborted) throw new Error('semantic-aborted');
          entry.result = decision(entry.item, result, now);
          if (!entry.result) throw new Error('semantic-invalid-output');
          entry.lastError = null; entry.errorPhase = null; entry.errorDetail = null;
        } catch (failure) {
          if (signal?.aborted) { Object.assign(entry, priorAttempt); break; }
          error = String((typeof failure?.code === 'string' && failure.code) || failure?.message || failure?.name || 'semantic-error').slice(0, 80);
          entry.lastError = error; entry.errorPhase = failure?.phase || 'queue';
          entry.errorDetail = String(failure?.detail || failure?.message || error).slice(0,180);
          entry.result = null;
        } finally {
          finished = true; clearTimeout(timer); clearTimeout(progressTimer); signal?.removeEventListener('abort', abort);
        }
        saved.overflow = trim(entries, saved.overflow);
        await onCheckpoint(saved);
      }
    }
    const all = Object.values(entries);
    const failed = all.filter(e => !e.result && e.lastError).sort((a,b)=>b.lastTriedAt-a.lastTriedAt)[0];
    const end = clock();
    const due = all.filter(e => !e.result).map(e => e.lastTriedAt ? Math.max(end, e.lastTriedAt + cooldown(e.attempts)) : end);
    const nextAttemptAt = due.length ? Math.min(...due) : null;
    const status = { state: availability.state, pending: all.filter(e => !e.result).length,
      classified: all.filter(e => e.result).length, positive: all.filter(e => e.result && !['unrelated','cancelled'].includes(e.result.category)).length,
      checkedAt: now, overflow: saved.overflow, lastError: failed?.lastError || error, errorPhase: failed?.errorPhase || null, errorDetail: failed?.errorDetail || null, failedId: failed?.item.id || null,
      processed, nextAttemptAt, itemTimeoutMs, budgetMs };
    return { state: saved, status, items: all.map(e => e.result ? { ...e.item, semantic: e.result } : e.item) };
  }
  root.RadarSemanticQueue = Object.freeze({ run });
  if (typeof module !== 'undefined') module.exports = root.RadarSemanticQueue;
})(globalThis);
