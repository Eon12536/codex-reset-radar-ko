(function initPublicAlerts(root) {
  const DAY = 86400000;
  const publicId = id => /^(signal|hint|report|schedule|event):/.test(id || '');

  // A retained news item is not necessarily a newly detected notification.
  // Remember first observation independently of the classifier/category.
  function observe(previous, items, { knownIds = [], now = Date.now(), catchUpSince = null, catchUpUntil = now } = {}) {
    const entries = Object.fromEntries(Object.entries(previous?.entries || {})
      .filter(([, value]) => value.observedAt > now - 8 * DAY));
    if (!previous) for (const id of knownIds) entries[id] = { observedAt: now, expiresAt: 0 };
    for (const item of items) {
      if (!item?.id || Object.hasOwn(entries, item.id)) continue;
      const publishedAt = Date.parse(item.createdAt);
      const recent = publishedAt >= now - DAY;
      const missed = Number.isFinite(catchUpSince) && publishedAt >= catchUpSince && publishedAt <= catchUpUntil && publishedAt >= now - 7 * DAY;
      const eligible = Number.isFinite(publishedAt) && publishedAt <= now + 300000 && (recent || missed);
      entries[item.id] = { observedAt: now, publishedAt, expiresAt: eligible ? now + DAY : 0, catchUp: Boolean(missed) };
    }
    return { entries: Object.fromEntries(Object.entries(entries).sort((a, b) => b[1].observedAt - a[1].observedAt).slice(0, 2000)) };
  }

  function allowed(item, state, history = {}, { queued = false, now = Date.now() } = {}) {
    if (!item?.id) return false;
    const entry = state?.entries?.[item.id];
    const at = Date.parse(item.createdAt);
    const recent = Number.isFinite(at) && at >= now - DAY && at <= now + 300000;
    const fresh = entry ? entry.expiresAt > now || (queued && recent) : recent;
    // Reclassification of one post must not produce a second toast.
    return fresh && (queued || !['signal:', 'hint:', 'report:', 'event:'].some(prefix => history[prefix + item.id]));
  }

  root.RadarPublicAlerts = Object.freeze({ observe, allowed, publicId });
  if (typeof module !== 'undefined') module.exports = root.RadarPublicAlerts;
})(globalThis);
