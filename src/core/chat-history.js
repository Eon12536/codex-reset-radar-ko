(function initChatHistory(root) {
  const ORIGIN = 'https://chatgpt.com';
  const DAY = 86400000;
  const ID = /^[a-zA-Z0-9_-]{6,160}$/;
  const HASH = /^[a-f0-9]{64}$/;
  const MAX_DETAILS = 20;
  const CLASSIFICATION_VERSION = 3;
  function timestamp(value) {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value < 1e12 ? value * 1000 : value;
    if (typeof value === 'string' && /^\d{4}-\d\d-\d\dT/.test(value)) {
      return root.RadarTime.parseTimestamp(value);
    }
    return null;
  }
  function listUrl(offset, archived) {
    return `${ORIGIN}/backend-api/conversations?offset=${offset}&limit=50&order=updated&is_archived=${archived}`;
  }
  function detailUrl(id) { return `${ORIGIN}/backend-api/conversations/${id}?include_has_versions=true&num_turns=100`; }
  function legacyUrl(id) { return `${ORIGIN}/backend-api/conversation/${id}`; }
  function messagesUrl(id, before) {
    return `${ORIGIN}/backend-api/conversations/${id}/messages?before=${encodeURIComponent(before)}&include_has_versions=true&num_turns=100`;
  }
  function allowedUrl(value) {
    try {
      const u = new URL(value);
      if (u.origin !== ORIGIN || u.username || u.password || u.hash || u.port) return false;
      if (u.pathname === '/backend-api/conversations') {
        const offset = Number(u.searchParams.get('offset')), archived = u.searchParams.get('is_archived');
        return [0, 50].includes(offset) && ['true', 'false'].includes(archived) && value === listUrl(offset, archived);
      }
      const match = /^\/backend-api\/(conversations|conversation)\/([a-zA-Z0-9_-]{6,160})(\/messages)?$/.exec(u.pathname);
      if (!match || !ID.test(match[2])) return false;
      if (match[1] === 'conversation') return !match[3] && value === legacyUrl(match[2]);
      if (!match[3]) return value === detailUrl(match[2]);
      const before = u.searchParams.get('before');
      return typeof before === 'string' && before.length > 0 && before.length <= 160 && /^[a-zA-Z0-9_=:./+-]+$/.test(before) && value === messagesUrl(match[2], before);
    } catch { return false; }
  }
  function retained(rows, now = Date.now()) {
    return (Array.isArray(rows) ? rows : []).filter(e => HASH.test(e?.key) && Object.hasOwn(root.RadarChatCounter.MODELS, e.model) &&
      Number.isFinite(e.at) && e.at <= now && e.at > now - 30 * DAY)
      .map(e => ({ key: e.key, model: e.model, at: e.at })).sort((a, b) => a.at - b.at).slice(-2000);
  }
  // Only the following metadata survives projection. Never keep text, titles,
  // raw payloads, URLs or response bodies in results/errors/storage.
  function project(payload, now, { family } = {}) {
    const mapping = payload?.mapping;
    const raw = mapping && typeof mapping === 'object' && !Array.isArray(mapping) ? Object.values(mapping).map(node => node?.message) : payload?.messages;
    if (!Array.isArray(raw)) throw new Error('history-schema');
    const entries = [], seen = new Set();
    let unknown = 0;
    for (const item of raw.slice(0, 10000)) {
      const m = item?.message || item;
      if (!m || (m.author?.role || m.role) !== 'assistant') continue;
      const meta = m.metadata || {}, channel = m.channel || meta.channel;
      const product = meta.product || meta.conversation_mode?.kind || payload?.conversation_mode?.kind;
      if (['work', 'codex', 'agent', 'api', 'deep_research'].includes(product)) continue;
      if ((channel && channel !== 'final') || m.end_turn === false || (m.recipient && m.recipient !== 'all') ||
          meta.is_visually_hidden_from_conversation || (m.status && m.status !== 'finished_successfully')) continue;
      const at = timestamp(m.create_time ?? m.created_at ?? m.createdAt);
      if (at && (at <= now - 30 * DAY || at > now)) continue;
      const slug = meta.model_slug || m.model_slug;
      const model = root.RadarChatCounter.model(slug, { family, product, effort: meta.reasoning_effort || meta.thinking_effort });
      // Explicit non-Pro models are excluded, never upgraded to Sol Pro.
      if (!model && typeof slug === 'string' && /^(gpt-(?:5|6).*(?:thinking|instant)|gpt-4|o[134](?:-|$))/.test(slug)) continue;
      if (!model || !at || !ID.test(m.id || '')) { unknown++; continue; }
      if (seen.has(m.id)) continue;
      seen.add(m.id);
      entries.push({ id: m.id, at, model });
    }
    const info = payload?.page_info;
    return { entries, unknown, truncated: raw.length > 10000,
      previous: Boolean(info?.has_previous_page), cursor: typeof info?.start_cursor === 'string' ? info.start_cursor : null };
  }
  function errorCode(error) {
    if ([401, 403].includes(error?.status)) return 'auth';
    if (error?.status === 429) return 'rate';
    if (error?.message === 'history-schema') return 'schema';
    return 'network';
  }
  async function collect({ read, hash, previous = {}, now = Date.now(), signal, family }) {
    // Revisit unchanged conversations once after metadata interpretation updates.
    const cache = {}, oldCache = previous.historyClassificationVersion === CLASSIFICATION_VERSION ? previous.historyCache || {} : {};
    for (const [key, v] of Object.entries(oldCache).slice(-200)) if (HASH.test(key) &&
      Number.isFinite(v?.updatedAt) && v.updatedAt > now - 30 * DAY && v.updatedAt <= now &&
      Number.isSafeInteger(v.unknown) && v.unknown >= 0 && v.unknown <= 30000) cache[key] = { updatedAt: v.updatedAt, unknown: v.unknown };
    const byId = new Map(), rows = new Map(retained(previous.historyEvents, now).map(e => [e.key, e]));
    let partial = false, failure = null, scanned = 0, reused = 0, unknown = 0, pending = 0;
    try {
      for (const archived of [false, true]) {
        for (const offset of [0, 50]) {
          signal?.throwIfAborted();
          let payload;
          try {
            payload = await read(listUrl(offset, archived));
            if (!Array.isArray(payload?.items)) throw new Error('history-schema');
          } catch (error) {
            // Archive and active lists are independent. Keep processing lists
            // already read when one endpoint temporarily fails; never bypass
            // an authentication failure, rate limit or cancellation.
            if ([401, 403, 429].includes(error.status) || signal?.aborted) throw error;
            partial = true; failure = errorCode(error);
            break;
          }
          let reachedOld = false;
          for (const item of payload.items.slice(0, 50)) {
            const id = item?.id || item?.conversation_id, updatedAt = timestamp(item?.update_time ?? item?.updated_at);
            if (!ID.test(id || '')) { partial = true; continue; }
            if (updatedAt && updatedAt <= now - 30 * DAY) { reachedOld = true; continue; }
            byId.set(id, { id, updatedAt });
          }
          const total = Number.isSafeInteger(payload.total) ? payload.total : null;
          if (reachedOld || (total !== null && offset + payload.items.length >= total)) break;
          if (payload.items.length < 50) { if (total !== null && total > offset + payload.items.length) partial = true; break; }
          if (offset === 50) partial = true;
        }
      }
      for (const item of byId.values()) {
        signal?.throwIfAborted();
        const key = await hash('conversation:' + item.id), saved = cache[key];
        if (item.updatedAt && saved?.updatedAt === item.updatedAt) { reused++; unknown += saved.unknown; continue; }
        if (scanned >= MAX_DETAILS) { pending++; partial = true; continue; }
        let payload;
        scanned++;
        try {
          try { payload = await read(detailUrl(item.id)); }
          catch (error) { if (![404, 405].includes(error.status)) throw error; payload = await read(legacyUrl(item.id)); }
          let localUnknown = 0, complete = true, previousCursor = null;
          for (let page = 0; page < 3; page++) {
            const projected = project(payload, now, { family });
            payload = null;
            localUnknown += projected.unknown;
            for (const entry of projected.entries) {
              const eventKey = await hash(entry.id);
              rows.set(eventKey, { key: eventKey, at: entry.at, model: entry.model });
            }
            if (projected.truncated) complete = false;
            if (!projected.previous) break;
            const url = messagesUrl(item.id, projected.cursor || '');
            if (page === 2 || !allowedUrl(url) || projected.cursor === previousCursor) { complete = false; break; }
            previousCursor = projected.cursor;
            payload = await read(url);
          }
          unknown += localUnknown;
          if (complete && item.updatedAt && item.updatedAt <= now) cache[key] = { updatedAt: item.updatedAt, unknown: localUnknown };
          else partial = true;
        } catch (error) {
          partial = true;
          if ([401, 403, 429].includes(error.status) || signal?.aborted) throw error;
          failure = errorCode(error); // No raw server errors or private payloads.
        }
      }
    } catch (error) {
      failure = errorCode(error); partial = true;
    }
    signal?.throwIfAborted();
    const historyEvents = retained([...rows.values()], now);
    if (rows.size > 2000) partial = true;
    return { historyEvents, historyClassificationVersion: CLASSIFICATION_VERSION, historyCache: Object.fromEntries(Object.entries(cache).slice(-200)),
      history: { status: failure ? 'error' : partial ? 'partial' : 'synced', code: failure,
        checkedAt: now, scanned, reused, indexed: byId.size, pending, unknown,
        // 'synced' is a completed bounded scan, not a claim of complete billing history.
        since: now - 30 * DAY } };
  }
  function statusText(history) {
    if (!history) return '계정 기록 동기화 전';
    if (history.status === 'running') return '계정 기록 확인 중…';
    if (history.status === 'error') return ({ auth: '로그인 확인 필요 · 기존 집계 유지', rate: '요청 제한 · 잠시 후 다시 확인',
      schema: '기록 형식 확인 필요 · 기존 집계 유지', network: '동기화 실패 · 기존 집계 유지', changed: '계정이 바뀌어 동기화를 중단했어요' })[history.code] || '동기화 실패 · 기존 집계 유지';
    return `최근 30일 기록 ${history.status === 'partial' ? '일부 확인' : '확인'} · 대화 ${history.scanned + history.reused}개` +
      (history.pending ? ` · 대기 ${history.pending}개` : '') + (history.unknown ? ` · 모델·시각 미확인 ${history.unknown}개` : '');
  }
  root.RadarChatHistory = Object.freeze({ allowedUrl, timestamp, retained, project, collect, statusText });
  if (typeof module !== 'undefined') module.exports = root.RadarChatHistory;
})(globalThis);
