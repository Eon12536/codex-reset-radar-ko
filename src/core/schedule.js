(function initSchedule(root) {
  const HOUR = 3600000;
  const RETENTION = 7 * 24 * HOUR;
  const FRESH = 48 * HOUR;
  const at = post => root.RadarTime.parseTimestamp(post?.createdAt) || 0;
  const text = post => String(post?.text || "").toLowerCase().replace(/[’‘]/g, "'");
  const lead = post => post?.source?.id === "codex-lead" && /^@?(thsottiaux|reach_vb|openai)$/i.test(post.author || "");
  const refs = post => [post?.inReplyToId, post?.quotedStatusId].filter(Boolean).map(String);
  const unrelated = /\b(?:password|git|database|workspace|cache|config|claude|gemini|swag|merch|giveaway|meeting|launch|release|reset credits?)\b/;

  function delay(post) {
    const value = text(post);
    if (!lead(post) || unrelated.test(value) || /\b(?:may|might|maybe|could|if|would)\b|\?/.test(value)) return null;
    if (/\b(?:not|never|no|won't|will not|can't|cannot|isn't|is not|hasn't|has not)\s+(?:(?:be|being|been|a|any|further|longer|actually|really|going to|getting)\s+){0,3}(?:delay|postpon|reschedul|mov|push)/.test(value)) return null;
    if (/\b(?:already reset|all reset|reset all propagated|limits are reset|has been reset|have (?:now )?reset)\b/.test(value)) return null;
    const postponed = /\b(?:delay(?:ed|ing)?|postpon(?:e|ed|ing)|push(?:ed|ing)? (?:it |this |the reset )?back|not (?:today|tonight))\b/.test(value);
    const moved = /\b(?:reschedul(?:e|ed|ing)|mov(?:e|ed|ing) (?:it |this |the (?:reset|celebration) )?(?:to|until|back|from))\b/.test(value);
    if (!postponed && !moved) return null;
    return { label: postponed ? "리셋 일정 연기" : "리셋 일정 변경", qualifier: root.RadarSignals.classifyHint(post, { now: at(post) + 1 }).qualifier || "" };
  }

  function kind(post) {
    if (!lead(post)) return null;
    const options = { now: at(post) + 1 };
    if (root.RadarSignals.classify(post, options).actionable) return "signal";
    const hint = root.RadarSignals.classifyHint(post, options);
    // Product/time clues are not reset schedules and must never acquire a
    // "reset postponed" label merely through a later reply.
    if (hint.candidate && !hint.topic && !["product-time", "schedule-time"].includes(hint.rule)) return "hint";
    return null;
  }

  function copy(post) {
    return { id: String(post.id), text: String(post.text).slice(0, 6000), author: post.author,
      createdAt: post.createdAt, url: post.url, source: { id: "codex-lead", weight: 1 },
      isReply: Boolean(post.isReply), inReplyToId: post.inReplyToId || null, quotedStatusId: post.quotedStatusId || null };
  }

  function latest(event) { return event.updates[event.updates.length - 1]?.post || event.original; }
  function hasId(event, id) { return event.original.id === id || event.updates.some(update => update.post.id === id); }
  function contextualMatch(event, post) {
    if (String(post.author).toLowerCase() !== String(event.original.author).toLowerCase()) return false;
    const gap = at(post) - at(latest(event));
    if (gap <= 0 || gap > FRESH) return false;
    const value = text(post);
    if (/\breset\b/.test(value)) return /\b(?:codex|quota|usage|weekly|rate|reset)\b/.test(text(event.original));
    return /\bcelebrat(?:ion|e)\b/.test(value) && /\bcelebrat(?:ion|e|ing)\b/.test(text(event.original));
  }

  // Only an explicit thread reference, an edit, or one unambiguous recent
  // subject match can associate posts. Never choose an arbitrary nearest post.
  function reconcile(previous = {}, incoming = [], { now = Date.now() } = {}) {
    const events = (previous.events || []).filter(event => lead(event.original) && at(event.original) >= now - RETENTION)
      .map(event => ({ ...event, updates: event.updates.map(update => ({ ...update })) }));
    const posts = new Map();
    for (const post of incoming) if (post?.id && lead(post) && at(post) > 0 && at(post) <= now + 300000 && now - at(post) <= RETENTION) posts.set(String(post.id), copy(post));
    for (const post of [...posts.values()].sort((a, b) => at(a) - at(b))) {
      const own = events.find(event => hasId(event, post.id));
      const oldUpdate = own?.updates.find(update => update.post.id === post.id);
      const changed = delay(post);
      if (own && ((oldUpdate && oldUpdate.post.text === post.text) || (!oldUpdate && own.original.text === post.text))) continue;
      if (own && !changed) {
        // An edited-away delay is no longer evidence. Descendants depending on
        // it are discarded as well, rather than retaining an obsolete chain.
        const index = own.updates.findIndex(update => update.post.id === post.id);
        if (index >= 0) own.updates.splice(index);
        if (own.original.id === post.id) {
          const nextKind = kind(post);
          if (nextKind) { own.original = post; own.kind = nextKind; }
          else events.splice(events.indexOf(own), 1);
        }
        continue;
      }
      if (changed && (own || now - at(post) <= FRESH)) {
        const references = refs(post);
        const matches = own ? [own] : events.filter(event => at(event.original) < at(post) &&
          (references.length ? references.some(id => hasId(event, id)) : contextualMatch(event, post)));
        if (matches.length === 1) {
          const event = matches[0];
          const index = event.updates.findIndex(update => update.post.id === post.id);
          const previousPost = index >= 0 ? event.updates[index].previous : latest(event);
          const update = { post, previous: copy(previousPost), association: own ? (oldUpdate?.association || "edit") : references.length ? "reference" : "inferred", detectedAt: now };
          if (index >= 0) event.updates.splice(index, event.updates.length - index, update);
          else event.updates.push(update);
          event.updates = event.updates.slice(-8);
          continue;
        }
      }
      const initialKind = kind(post);
      if (!own && initialKind) events.push({ original: post, kind: initialKind, updates: [] });
    }
    return { events: events.sort((a, b) => at(latest(b)) - at(latest(a))).slice(0, 30) };
  }

  function changes(state, { now = Date.now(), freshOnly = true } = {}) {
    return (state?.events || []).flatMap(event => {
      const update = event.updates[event.updates.length - 1];
      if (!update || now - at(event.original) > RETENTION || !delay(update.post) ||
          (freshOnly && now - at(update.post) > FRESH)) return [];
      return [{ ...update, original: event.original, kind: event.kind, ...delay(update.post) }];
    }).sort((a, b) => at(b.post) - at(a.post));
  }

  function supersededIds(state, options) {
    const ids = new Set();
    for (const change of changes(state, { ...options, freshOnly: false })) {
      const event = state.events.find(event => event.original.id === change.original.id);
      ids.add(event.original.id);
      for (const update of event.updates) ids.add(update.post.id);
    }
    return ids;
  }

  function notificationId(change) {
    // Bounded non-secret revision fingerprint: edits and later postponements
    // each alert once, while repeated polls of the same text remain silent.
    let hash = 2166136261;
    for (const char of change.post.text) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
    return `schedule:${change.original.id}:${change.post.id}:${(hash >>> 0).toString(16)}`;
  }

  root.RadarSchedule = Object.freeze({ reconcile, changes, supersededIds, notificationId });
  if (typeof module !== "undefined") module.exports = root.RadarSchedule;
})(globalThis);
