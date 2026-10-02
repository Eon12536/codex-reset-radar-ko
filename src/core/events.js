(function initEvents(root) {
  const DAY = 86400000;
  // Verified against the official FAQ on 2026-09-29. No tweet IDs are matched.
  // Breakfast starts at 8am PT; the keynote starts at 10am; reception ends at 7pm.
  const devday = Object.freeze({ id: 'devday-2026', name: 'OpenAI DevDay 2026',
    date: { year: 2026, month: 9, day: 29 }, startAt: Date.parse('2026-09-29T15:00:00Z'),
    keynoteAt: Date.parse('2026-09-29T17:00:00Z'), endAt: Date.parse('2026-09-30T02:00:00Z'),
    until: Date.parse('2026-09-30T02:00:00Z'), zone: { zone: 'America/Los_Angeles', label: 'PT' },
    officialUrl: 'https://devday.openai.com/', checkedAt: '2026-09-29',
    availableAt: Date.parse('2026-09-28T15:00:00Z') });
  const EVENT = /\b(?:dev\s?day|developer (?:day|conference)|openai (?:event|keynote|livestream))\b/i;
  const CANCELLED = /\b(?:cancelled|canceled|not happening|not on|no longer|won't happen|is over|has ended|has finished|wrapped up)\b/i;
  const REVISED = /\b(?:moved|rescheduled|delayed|postponed|instead|changed|updated|new time|now at)\b/i;
  function resolve(item, previous = null) {
    if (!root.RadarSignals.isLead(item)) return null;
    const text = root.RadarSignals.eventContext(item);
    if (!EVENT.test(text) || /\b(?:recap|throwback|yesterday|last (?:week|month|year)|was|were|maybe|might|could|rumou?red)\b|\?/i.test(text)) return null;
    const cancelled = CANCELLED.test(text) || /\b(?:delayed|postponed)\b/i.test(text) && !root.RadarSignals.hasEventTime(item.text);
    if (!cancelled && !root.RadarSignals.hasEventTime(item.text)) return null;
    const published = root.RadarTime.parseTimestamp(item.createdAt);
    if (published === null) return null;
    let window = root.RadarNews.eventWindow({ ...item, text });
    const isDevday = /\bdev\s?day\b/i.test(text) && !/\b(?:exchange|exchanges|Tokyo|Seoul|Bengaluru|Paris|Berlin|London|Paulo|Mexico)\b/i.test(text);
    const dated = /\b20\d{2}-\d{1,2}-\d{1,2}\b|\b\d{1,2}\/\d{1,2}\b|\b(?:Jan\w*|Feb\w*|Mar\w*|Apr\w*|May|Jun\w*|Jul\w*|Aug\w*|Sep\w*|Oct\w*|Nov\w*|Dec\w*)\.?\s+\d|\b\d{1,2}(?:st|nd|rd|th)?\s+(?:Jan\w*|Feb\w*|Mar\w*|Apr\w*|May|Jun\w*|Jul\w*|Aug\w*|Sep\w*|Oct\w*|Nov\w*|Dec\w*)/i.test(text);
    const sameDate = window ? window.date.year === 2026 && window.date.month === 9 && window.date.day === 29 : !dated;
    const year = /\b(20\d{2})\b/.exec(text)?.[1];
    const known = isDevday && (!year || year === '2026') && sameDate &&
      published >= Date.parse('2026-06-01T00:00:00Z') && published < devday.until;
    if (known && !window) window = root.RadarNews.eventWindow({ ...item, text: text + ' on September 29, 2026' });
    const schedule = known ? { ...devday,
      ...(window?.startAt ? { keynoteAt: window.startAt, endAt: window.endAt || devday.endAt, until: window.endAt || devday.until } : {})
    } : window || (cancelled ? previous : null);
    if (!schedule?.until) return null;
    const id = previous && (cancelled || REVISED.test(text) || item.replyContext?.id === previous.item?.id) ? previous.id : isDevday ? `devday-${schedule.date.year}` : `${EVENT.exec(text)[0].toLowerCase().replace(/\s+/g, '-')}-${schedule.date.year}-${schedule.date.month}-${schedule.date.day}`;
    return { ...schedule, id, name: known ? devday.name : isDevday ? `OpenAI DevDay ${schedule.date.year}` : EVENT.exec(text)[0],
      status: cancelled ? 'cancelled' : 'scheduled', item, published };
  }
  function groups(previous = [], incoming = [], { now = Date.now(), seeds = [] } = {}) {
    const posts = new Map([...previous, ...incoming].filter(item => item?.id).map(item => [String(item.id), item]));
    const events = new Map(seeds.map(event => [event.id, { ...event, related: [event.item] }]));
    for (const item of [...posts.values()].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))) {
      const context = root.RadarSignals.eventContext(item);
      const name = EVENT.exec(context)?.[0].toLowerCase();
      const matches = [...events.values()].filter(event => EVENT.exec(root.RadarSignals.eventContext(event.item))?.[0].toLowerCase() === name);
      const parent = matches.find(event => event.related.some(post => post.id === item.replyContext?.id));
      const prior = parent || (matches.length === 1 ? matches[0] : null);
      let event = resolve(item, prior);
      if (!event || event.published > now + 300000) continue;
      const sameInstant = matches.find(value => event.startAt && event.startAt === (value.keynoteAt || value.startAt));
      if (!events.has(event.id) && sameInstant) event.id = sameInstant.id;
      const current = events.get(event.id);
      // A date-only reminder must not erase a precise schedule or undo a
      // cancellation. Only an explicit update can reinstate a cancelled event.
      if (current && current.status === 'cancelled' && event.status !== 'cancelled' && !REVISED.test(context)) continue;
      const clockInPost = /\b\d{1,2}(?::\d{2})?\s*[ap]\.?m\.?|\b\d{1,2}:\d{2}\b/i.test(item.text);
      if (current && current.status === 'scheduled' && event.status === 'scheduled' && !REVISED.test(context) &&
          !clockInPost && JSON.stringify(event.date) === JSON.stringify(current.date)) {
        event = { ...current, item, published: event.published };
      }
      if (current?.endAt && !event.endAt && event.status === 'scheduled' && !REVISED.test(context) &&
          (event.keynoteAt || event.startAt) === (current.keynoteAt || current.startAt)) {
        event = { ...current, item, published: event.published };
      }
      if (!current || event.published >= current.published) {
        const scheduleItem = event.scheduleItem || (event.status === 'cancelled' ? current?.scheduleItem : null) || item;
        const related = [item, ...(current?.related || []).filter(post => post.id !== item.id)].slice(0, 30);
        // Keep the evidence supplying the exact schedule when many date-only
        // reminders would otherwise evict it from the bounded cache.
        if (!related.some(post => post.id === scheduleItem.id)) related.splice(29, 1, scheduleItem);
        events.set(event.id, { ...event, scheduleItem, related });
      }
    }
    // Retain related posts and cancellation tombstones until the event expires.
    return [...events.values()].filter(event => Math.max(event.until, event.id === devday.id ? devday.until : 0) > now && event.until - now <= 366 * DAY)
      .sort((a, b) => a.until - b.until).slice(0, 30);
  }
  function reconcile(previous = [], incoming = [], options = {}) {
    return groups(previous, incoming, options).flatMap(event => event.related).slice(0, 100);
  }
  function signature(event) {
    // For known DevDay, the keynote is the public announcement time. Ignore
    // source wording, author, timezone notation and other cosmetic differences.
    const date = value => value ? [value.year, value.month, value.day] : null;
    const start = event.keynoteAt || event.startAt || null;
    return JSON.stringify([event.status, start || date(event.date), event.endAt || null,
      !event.endAt && event.endDate && JSON.stringify(date(event.endDate)) !== JSON.stringify(date(event.date)) ? date(event.endDate) : null]);
  }
  function resetEvidence(item, now = Date.now()) {
    const hint = root.RadarSignals.classifyHint(item, { now });
    return root.RadarSignals.classify(item, { now }).actionable || root.RadarSignals.reports([item], { now }).length > 0 ||
      hint.candidate && !hint.topic && !['product-time', 'schedule-time'].includes(hint.rule);
  }
  function alerts(previous, baseline = [], incoming = [], { now = Date.now() } = {}) {
    const entries = { ...(previous?.entries || {}) };
    if (!previous) for (const event of groups([], baseline, { now })) {
      const { related, ...current } = event;
      entries[event.id] = { current, signature: signature(event), notice: null };
    }
    for (const event of groups([], incoming, { now, seeds: Object.values(entries).map(entry => entry.current) })) {
      const before = entries[event.id], value = signature(event);
      if (before && event.published < before.current.published) continue;
      const { related, ...current } = event;
      const changed = !before || before.signature !== value;
      const kind = event.status === 'cancelled' ? 'cancelled' : before ? 'changed' : 'scheduled';
      const notice = changed ? (!resetEvidence(event.item, now) ? { event: current, kind, id: 'event:' + event.item.id } : null) : before.notice;
      entries[event.id] = { current, signature: value, notice };
    }
    return { entries: Object.fromEntries(Object.entries(entries).filter(([, entry]) =>
      Math.max(entry.current.until, entry.current.id === devday.id ? devday.until : 0) > now).slice(-100)) };
  }
  function notices(state) {
    return Object.values(state?.entries || {}).map(entry => entry.notice).filter(Boolean);
  }
  function pinned(signalSnapshot, hintSnapshot, settings, { now = Date.now() } = {}) {
    if (!settings.monitorSignals || !settings.monitorLeadSource) return [];
    const incoming = [...(hintSnapshot?.items || []), ...(signalSnapshot?.activeSignals || []), ...(signalSnapshot?.reports || [])];
    const resolved = groups(hintSnapshot?.events || [], incoming, { now });
    // Official schedules do not depend on X collection succeeding. Keep this
    // separate from tweets, notification evidence and reset forecasts.
    if (now >= devday.availableAt && now < devday.until && !resolved.some(event => event.id === devday.id)) {
      resolved.push({ ...devday, status: 'scheduled', officialOnly: true, item: null });
    }
    return resolved.filter(event => event.status !== 'cancelled' && event.until > now).sort((a, b) => a.until - b.until);
  }
  function describe(event) {
    const locale = root.RadarI18n?.uiLanguage?.() || 'ko-KR';
    const ko = locale === 'ko-KR';
    const target = root.RadarTime.countryZone();
    const stamp = (at, zone) => root.RadarTime.formatDateTime(at, zone, locale);
    const lines = [];
    if (event.keynoteAt) return [
      `${ko ? '키노트' : 'Keynote'} · ${target.label} ${stamp(event.keynoteAt, target.zone)}`,
      `${ko ? '종료' : 'Ends'} · ${target.label} ${stamp(event.endAt, target.zone)}`,
      `${event.zone.label} ${stamp(event.keynoteAt, event.zone.zone)} – ${new Intl.DateTimeFormat(locale, {timeZone:event.zone.zone, hour:'numeric',minute:'2-digit',hourCycle:'h12'}).format(event.endAt)}`
    ];
    if (event.startAt) lines.push(`${target.label} ${stamp(event.startAt, target.zone)}${event.endAt ? ' – ' + stamp(event.endAt, target.zone) : ''}`);
    else if (event.endAt) lines.push(`${ko ? '종료' : 'Ends'} · ${target.label} ${stamp(event.endAt, target.zone)}`);
    else lines.push(`${event.dateText || ''} · ${ko ? '시각 미정' : 'Time unconfirmed'}`);
    if (event.startAt && event.zone?.zone) lines.push(`${event.zone.label} ${stamp(event.startAt, event.zone.zone)}${event.endAt ? ' – ' + new Intl.DateTimeFormat(locale, {timeZone:event.zone.zone, hour:'numeric',minute:'2-digit',hourCycle:'h12'}).format(event.endAt) : ''}${event.zone.assumed ? (ko ? ' · 추정' : ' · Estimated') : ''}`);
    if (!event.endAt) lines.push(ko ? '종료 미정 · 행사일 종료까지 임시 고정' : 'End unconfirmed · Pinned through the event day');
    return lines;
  }
  root.RadarEvents = Object.freeze({ resolve, reconcile, groups, pinned, describe, alerts, notices, resetEvidence });
  if (typeof module !== 'undefined') module.exports = root.RadarEvents;
})(globalThis);
