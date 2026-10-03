(function initPublicAlerts(root) {
  const DAY = 86400000;
  const publicId = id => /^(signal|hint|report|schedule|event):/.test(id || '');

  function notificationKeys(itemId, ids = []) {
    const keys = ['signal:', 'hint:', 'report:', 'event:'].map(prefix => prefix + itemId);
    // Schedule keys include both the original post and the changed post, plus
    // a revision fingerprint. Only the changed post shares this notification.
    return [...keys, ...ids.filter(id => /^schedule:[^:]+:[^:]+:[a-f0-9]+$/.test(id) &&
      id.split(':')[2] === String(itemId))];
  }

  // A retained news item is not necessarily a newly detected notification.
  // Remember first observation independently of the classifier/category.
  function observe(previous, items, { knownIds = [], now = Date.now(), catchUpSince = null, catchUpUntil = now } = {}) {
    const entries = Object.fromEntries(Object.entries(previous?.entries || {})
      .filter(([, value]) => value.observedAt > now - 8 * DAY));
    if (!previous) for (const id of knownIds) entries[id] = { observedAt: now, expiresAt: 0 };
    for (const item of items) {
      if (!item?.id) continue;
      const publishedAt = root.RadarTime.parseTimestamp(item.createdAt);
      if (Object.hasOwn(entries, item.id)) {
        const entry = entries[item.id];
        // Older workers interpreted zone-less UTC feeds in the host zone.
        // Repair that observation, preserving its original expiry and the
        // intentionally silent migration baseline (which has no publishedAt).
        if (Number.isFinite(entry.publishedAt) && Number.isFinite(publishedAt) && entry.publishedAt !== publishedAt) {
          const fresh = publishedAt >= entry.observedAt - DAY ||
            entry.catchUp && publishedAt >= entry.observedAt - 7 * DAY;
          entries[item.id] = { ...entry, publishedAt,
            expiresAt: fresh && publishedAt <= entry.observedAt + 300000 ? entry.observedAt + DAY : 0 };
        }
        continue;
      }
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
    const at = root.RadarTime.parseTimestamp(item.createdAt);
    const recent = Number.isFinite(at) && at >= now - DAY && at <= now + 300000;
    const fresh = entry ? entry.expiresAt > now || (queued && recent) : recent;
    // Reclassification of one post must not produce a second toast.
    return fresh && (queued || !notificationKeys(item.id, Object.keys(history)).some(key => history[key]));
  }

  root.RadarPublicAlerts = Object.freeze({ observe, allowed, publicId, notificationKeys });
  if (typeof module !== 'undefined') module.exports = root.RadarPublicAlerts;
})(globalThis);
