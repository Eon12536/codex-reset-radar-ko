(function initBadge(root) {
  const TTL = 24 * 3600000;
  const read = (entry, detectedAt, now) => Number.isFinite(entry?.badgeReadAt) &&
    entry.badgeReadAt >= detectedAt && entry.badgeReadAt <= now;

  function view(state, settings, { signal, now = Date.now() } = {}) {
    const snapshot = state.signalSnapshot;
    const posts = settings.monitorSignals ? [
      ...(snapshot?.activeSignals || [snapshot?.signal].filter(Boolean)).filter(item => root.RadarSignals.isActive(item, { now })),
      ...(signal?.assessment?.actionable ? [signal] : [])
    ] : [];
    if (settings.monitorSignals && settings.monitorLeadSource) posts.push(
      ...root.RadarSignals.reports(snapshot?.reports || [], { now }),
      ...root.RadarSignals.hintCandidates(state.hintSnapshot?.items || [], { now, limit: 100 }).filter(item =>
        !item.assessment.topic && !['product-time', 'schedule-time'].includes(item.assessment.rule)),
      ...root.RadarSchedule.changes(state.scheduleSnapshot, { now }).map(change => change.post));
    const unique = new Map();
    for (const item of posts) {
      if (!settings.monitorLeadSource && item.source?.id === 'codex-lead') continue;
      const observed = state.publicAlertState?.entries?.[item.id];
      const detectedAt = observed ? observed.observedAt :
        root.RadarTime.parseTimestamp(item.firstDetectedAt) || root.RadarTime.parseTimestamp(item.createdAt);
      const expiresAt = observed ? Math.min(observed.expiresAt, detectedAt + TTL) : detectedAt + TTL;
      if (!detectedAt || detectedAt > now || expiresAt <= now || !Number.isFinite(expiresAt) || read(observed || item, detectedAt, now)) continue;
      unique.set(item.id, { id: item.id, detectedAt, expiresAt, publishedAt: root.RadarTime.parseTimestamp(item.createdAt) });
    }
    const publicItems = [...unique.values()];
    const accountKey = state.accountSnapshot?.accountKey || null;
    const bankedItems = settings.monitorAccount && accountKey && accountKey === state.creditGrantState?.accountKey ?
      root.RadarCreditGrants.currentEvents(state.creditGrantState, now).filter(event => !read(event, event.observedAt, now)) : [];
    const hasUnread = publicItems.length > 0 || bankedItems.length > 0;
    const grant = settings.monitorAccount ? root.RadarCreditGrants.latest(state.creditGrantState, state.accountSnapshot, now) : null;
    const count = settings.monitorAccount ? state.accountSnapshot?.credits?.availableCount : null;
    const knownInventory = accountKey && Number.isInteger(count) && count > 0;
    // Existing inventory is useful even when the first reading only established
    // a baseline. It must never be presented as a newly detected grant.
    const notice = grant ? { kind: 'grant', added: grant.added, count, observedAt: grant.observedAt, unread: bankedItems.length > 0 }
      : knownInventory ? { kind: 'inventory', count, observedAt: state.accountSnapshot.updatedAt, unread: hasUnread }
      : publicItems.length ? { kind: 'public', total: publicItems.length,
        observedAt: Math.max(...publicItems.map(item => item.detectedAt)), unread: true } : null;
    return { publicItems, bankedItems, hasUnread, notice,
      deadlines: [...publicItems.map(item => item.expiresAt), ...bankedItems.map(event => event.observedAt + TTL)],
      receipt: { public: publicItems.filter(item => typeof item.id === 'string').map(({ id, detectedAt }) => ({ id, detectedAt })),
        banked: bankedItems.map(event => ({ id: event.id, detectedAt: event.observedAt })), accountKey } };
  }

  function validReceipt(receipt) {
    if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt) ||
      Object.keys(receipt).length !== 3 || Object.keys(receipt).some(key => !['public', 'banked', 'accountKey'].includes(key)) ||
      !(receipt.accountKey === null || typeof receipt.accountKey === 'string' && /^[a-f0-9]{64}$/.test(receipt.accountKey))) return false;
    return [['public', 500], ['banked', 8]].every(([key, limit]) => Array.isArray(receipt[key]) && receipt[key].length <= limit && receipt[key].every(item =>
      item && typeof item === 'object' && !Array.isArray(item) && Object.keys(item).length === 2 &&
      Object.keys(item).every(key => ['id', 'detectedAt'].includes(key)) &&
      typeof item.id === 'string' && /^[a-zA-Z0-9_.:-]{1,256}$/.test(item.id) &&
      !['__proto__', 'constructor', 'prototype'].includes(item.id) && Number.isFinite(item.detectedAt) && item.detectedAt > 0));
  }

  function acknowledge(state, settings, receipt, now = Date.now()) {
    if (!validReceipt(receipt)) throw new TypeError('Invalid badge receipt');
    const current = view(state, settings, { now });
    const updates = {};
    const matches = (rows, item, detectedAt) => rows.some(row => row.id === item.id && row.detectedAt === detectedAt);
    const publicItems = current.publicItems.filter(item => matches(receipt.public, item, item.detectedAt));
    if (publicItems.length) {
      const entries = new Map(Object.entries(state.publicAlertState?.entries || {}));
      for (const item of publicItems) entries.set(item.id, { ...(entries.get(item.id) || {
        observedAt: item.detectedAt, expiresAt: item.expiresAt, publishedAt: item.publishedAt
      }), badgeReadAt: now });
      updates.publicAlertState = { ...state.publicAlertState, entries: Object.fromEntries([...entries]
        .sort((a, b) => b[1].observedAt - a[1].observedAt).slice(0, 2000)) };
    }
    // Only the exact events rendered by the popup are acknowledged. A new
    // arrival or account switch while this request is queued stays unread.
    if (receipt.accountKey === current.receipt.accountKey && current.bankedItems.some(event => matches(receipt.banked, event, event.observedAt))) {
      const ids = new Set(current.bankedItems.filter(event => matches(receipt.banked, event, event.observedAt)).map(event => event.id));
      updates.creditGrantState = { ...state.creditGrantState,
        events: state.creditGrantState.events.map(event => ids.has(event.id) ? { ...event, badgeReadAt: now } : event) };
    }
    return updates;
  }

  root.RadarBadge = Object.freeze({ TTL, view, validReceipt, acknowledge });
  if (typeof module !== 'undefined') module.exports = root.RadarBadge;
})(globalThis);
