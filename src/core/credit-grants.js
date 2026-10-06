(function initCreditGrants(root) {
  const TTL = 24 * 3600000;
  const MAX_GAP = 30 * TTL;

  async function inventory(credits, raw, accountKey) {
    if (!credits || !accountKey) return null;
    // Row order and expiry changes do not identify a new credit. Use optional
    // stable server IDs only when the entire available inventory has IDs.
    const rows = Array.isArray(raw?.credits) ? raw.credits.filter(row =>
      row && String(row.status || "available").toLowerCase() === "available") : [];
    const ids = rows.map(row => typeof row.id === "string" && row.id.length > 0 && row.id.length <= 256 ? row.id : null);
    const complete = Array.isArray(raw?.credits) && rows.length === credits.availableCount &&
      ids.every(Boolean) && new Set(ids).size === ids.length;
    const hashes = complete ? await Promise.all(ids.map(async id => {
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify([accountKey, id])));
      return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
    })) : null;
    return { count: credits.availableCount, ids: hashes };
  }

  function advance(previous, reading, key, { now = Date.now(), notify = true, resumed = false } = {}) {
    if (!reading || !key) return previous;
    const same = previous?.accountKey === key && previous.observedAt <= now && now - previous.observedAt <= MAX_GAP;
    const state = same ? { ...previous } : { accountKey: key, sequence: 0, seenIds: [], identitiesReady: false, events: [] };
    // Keep delivery evidence independently of the popup/badge's 24-hour TTL.
    // Only an originally queued notice may use these older observations.
    state.events = retainedEvents(state, now);
    if (resumed) state.events = state.events.map(event => ({ ...event, catchUp: true }));
    const addedIds = same && state.identitiesReady && reading.ids ? reading.ids.filter(id => !state.seenIds.includes(id)) : [];
    const countAdded = same ? Math.max(0, reading.count - state.count) : 0;
    // A count-only response may already have announced credits whose IDs arrive
    // on the next complete response. Resolve that gap without a second alert.
    const added = same ? (state.identitiesReady && reading.ids ? Math.max(0, addedIds.length - (state.unidentifiedAdded || 0)) : countAdded) : 0;
    // Credits that have all been spent/expired cannot account for IDs found
    // in a later grant. Keep only the unresolved amount still possibly held.
    state.unidentifiedAdded = reading.ids ? 0 : Math.min(100, reading.count, (state.unidentifiedAdded || 0) + countAdded);
    if (reading.ids) {
      state.seenIds = [...new Set([...state.seenIds, ...reading.ids])].slice(-1000);
      state.identitiesReady = true;
    }
    if (added) {
      state.sequence++;
      state.events = [...state.events, {
        id: `banked:${key.slice(0, 16)}:${state.sequence}:${now}`, accountKey: key,
        added, availableCount: reading.count, observedAt: now, notify, catchUp: resumed
      }].slice(-8);
    }
    return { ...state, count: reading.count, observedAt: now };
  }

  function retainedEvents(state, now = Date.now()) {
    return (state?.events || []).filter(event => event.accountKey === state.accountKey &&
      Number.isInteger(event.added) && event.added > 0 && Number.isFinite(event.observedAt) &&
      event.observedAt <= now && now - event.observedAt < MAX_GAP);
  }

  function currentEvents(state, now = Date.now()) {
    return retainedEvents(state, now).filter(event => now - event.observedAt < TTL);
  }

  function pendingEvent(state, pending, now = Date.now()) {
    if (!Number.isFinite(pending?.queuedAt) || pending.queuedAt > now) return null;
    return retainedEvents(state, now).find(event => event.id === pending.id && event.notify &&
      event.observedAt <= pending.queuedAt && pending.queuedAt - event.observedAt < TTL) || null;
  }

  function latest(state, snapshot, now = Date.now()) {
    if (!snapshot?.accountKey || snapshot.accountKey !== state?.accountKey) return null;
    return currentEvents(state, now).at(-1) || null;
  }

  root.RadarCreditGrants = Object.freeze({ TTL, inventory, advance, retainedEvents, currentEvents, pendingEvent, latest });
  if (typeof module !== "undefined") module.exports = root.RadarCreditGrants;
})(globalThis);
