(function (root) {
  const DAY = 86400000;
  const publicId = id => /^(signal|hint|report|schedule|event|model):/.test(id || '');
  function dayKey(at = Date.now(), zone = root.RadarTime.countryZone().zone) {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' })
      .formatToParts(new Date(at));
    const value = type => parts.find(part => part.type === type).value;
    return `${value('year')}-${value('month')}-${value('day')}`;
  }
  function recentMonths(at = Date.now()) {
    const current = dayKey(at).slice(0, 7);
    const [year, month] = current.split('-').map(Number);
    const previous = month === 1 ? `${year - 1}-12` : `${year}-${String(month - 1).padStart(2, '0')}`;
    return [current, previous];
  }
  function entries(state, settings) {
    const rows = root.RadarNews.list(state.signalSnapshot, state.hintSnapshot, settings);
    const byKey = new Map(rows.map(row => [row.key, row]));
    if (settings.monitorSignals && settings.monitorLeadSource) for (const item of state.signalSnapshot?.modelReleases || []) {
      if (!root.RadarModelRelease?.detect(item)) continue;
      const key = 'codex-lead:' + item.id;
      const existing = byKey.get(key);
      byKey.set(key, existing ? { ...existing, modelRelease: true } : { ...root.RadarNews.describe(item, key), topic: 'model-release' });
    }
    if (settings.monitorSignals && settings.monitorLeadSource && !settings.resetOnly) for (const notice of root.RadarEvents?.notices(state.hintSnapshot?.eventAlerts) || []) {
      const item = notice.event.item, key = 'codex-lead:' + item.id;
      if (!root.RadarResetScope.allows(item, settings)) continue;
      if (!byKey.has(key)) byKey.set(key, { ...root.RadarNews.describe(item, key), event: notice.event, topic: 'event' });
    }
    if (settings.monitorSignals && settings.monitorLeadSource) for (const change of root.RadarSchedule.changes(
      root.RadarResetScope.schedule(state.scheduleSnapshot, settings))) {
      const key = 'codex-lead:' + change.post.id;
      byKey.set(key, { key, item: change.post, label: change.label, kindLabel: '리셋 일정 변경',
        explicit: change.kind === 'signal', change,
        timing: root.RadarNews.schedule(change.post).text, timingDetail: '확인된 선행 예고와 연결된 일정 변경입니다.',
        publishedAt: root.RadarTime.parseTimestamp(change.post.createdAt),
        publishedText: root.RadarTime.formatDateTime(change.post.createdAt, root.RadarTime.countryZone().zone),
        caption: change.association === 'inferred' ? '선행 예고와 연결 추정' : '선행 예고와 연결 확인' });
    }
    return [...byKey.values()].sort((a, b) => b.publishedAt - a.publishedAt);
  }
  // Archived records are display-only and never enter the notification path.
  function displayEntries(state, settings) {
    const saved = root.RadarResetHistory?.rows(state, settings) || [];
    if (settings.monitorSignals && settings.monitorLeadSource) for (const item of state.modelReleaseHistory || []) {
      if (!root.RadarModelRelease?.detect(item)) continue;
      saved.push({ ...root.RadarNews.describe(item, 'codex-lead:' + item.id), topic: 'model-release', historical: true });
    }
    const current = entries(state, settings);
    const merged = new Map();
    for (const row of [...saved, ...current]) {
      const prior = merged.get(row.key);
      const isModel = row.topic === 'model-release', wasModel = prior?.topic === 'model-release';
      if (prior && isModel && !wasModel) merged.set(row.key, { ...prior, modelRelease: true });
      else if (prior && wasModel && !isModel) merged.set(row.key, { ...row, modelRelease: true });
      else merged.set(row.key, prior?.modelRelease ? { ...row, modelRelease: true } : row);
    }
    return [...merged.values()]
      .sort((a, b) => b.publishedAt - a.publishedAt);
  }
  function summary(rows) {
    const counts = { forecast: 0, completed: 0, grant: 0, update: 0, candidate: 0, inferred: 0, model: 0 };
    const times = new Map();
    for (const row of rows) {
      const kind = statusKind(row);
      counts[kind]++;
      if (row.modelRelease && kind !== 'model') counts.model++;
      if (kind === 'model') continue;
      const time = row.timingSchedule || root.RadarNews.schedule(row.item);
      if (Number.isFinite(time.deadlineAt) || Number.isFinite(time.instant))
        times.set(`${Number.isFinite(time.deadlineAt) ? time.deadlineType || 'deadline' : 'instant'}:${time.deadlineAt ?? time.instant}`, {
          text: time.text.split('\n').at(-1), detail: time.detail, key: row.key,
          kind: time.estimatedWindow ? 'window' : Number.isFinite(time.deadlineAt) ? 'deadline' : 'instant', at: time.deadlineAt ?? time.instant });
    }
    const en = (root.RadarI18n?.uiLanguage?.() || 'ko').startsWith('en');
    const labels = en ? { forecast: 'forecast posts', completed: 'completion posts', grant: 'credit grant posts', update: 'updates', candidate: 'candidate posts', inferred: 'inferred resets', model: 'new model releases' } :
      { forecast: '예고', completed: '완료 표현', grant: '리셋권 공지', update: '후속·일정 변경', candidate: '관련 후보', inferred: '리셋 추정', model: '신모델 출시' };
    return { text: Object.entries(counts).filter(([,count]) => count).map(([key, count]) => `${labels[key]} ${count}`).join(' · '),
      times: [...times.values()], counts };
  }
  function headline(summary, resetOnly = true) {
    const en = (root.RadarI18n?.uiLanguage?.() || 'ko').startsWith('en');
    const times = summary.times || [];
    if (summary.counts?.model && Object.entries(summary.counts).every(([key, count]) => key === 'model' || !count))
      return en ? 'New model release' : '신모델 출시';
    if (!times.length) return en ? (resetOnly ? 'Reset news' : 'Public news') : (resetOnly ? '리셋 소식 요약' : '공개 소식 요약');
    const subject = en ? (resetOnly ? 'Reset' : 'Public') : (resetOnly ? '리셋' : '공개');
    const label = times.length > 1 ? (en ? `${subject} schedules ${times.length}` : `${subject} 일정 ${times.length}개`) :
      times[0].kind === 'window' ? (en ? 'Estimated reset window' : '리셋 오늘 범위 추정') :
      times[0].kind === 'deadline' ? (en ? `${subject} deadline` : `${subject} 예정 기한`) :
        (en ? `${subject} scheduled` : `${subject} 예정`);
    return `${label} · ${compactTime(times[0])}`;
  }
  function compactTime(time) {
    return time.text.replace(/ · (?:기한|Deadline|게시일 기준|Based on publication)(?= · |$)/gi, '');
  }
  function status(row) {
    const en = (root.RadarI18n?.uiLanguage?.() || 'ko').startsWith('en');
    if (row.topic === 'model-release') return en ? 'New model release' : '신모델 출시';
    const assessment = row.item.assessment || {};
    if (statusKind(row) === 'inferred') return en ? 'Reset inferred' : '리셋 추정';
    if (row.change || assessment.report === 'reset-update') return en ? 'Reset update' : '리셋 후속';
    if (statusKind(row) === 'grant' && (assessment.grantStage === 'inferred' || root.RadarSignals.bareBankedNumber(row.item))) return en ? 'Reset credit inferred' : '리셋권 추정';
    if (statusKind(row) === 'grant') return assessment.grantStage === 'forecast' || root.RadarSignals.bankedForecast(row.item) ?
      (en ? 'Reset credit forecast' : '리셋권 예고') : (en ? 'Reset credit granted' : '리셋권 지급');
    if (assessment.report === 'completed-reset') return assessment.completionLink === 'inferred' ?
      (en ? 'Completion inferred' : '리셋 완료 추정') : (en ? 'Reset completed' : '리셋 완료');
    if (statusKind(row) === 'forecast') return en ? 'Reset forecast' : '리셋 예고';
    return en ? 'Reset inferred' : '리셋 추정';
  }
  function author(row) {
    return root.RadarSignals.isLead(row.item) ? root.RadarSignals.authorName(row.item) : row.item.source?.label || row.item.author || '작성자 미확인';
  }
  function brief(row) {
    const text = excerpt(row).replace(/\s+together with (?:a|another|one) (?:small|minor) (?:ship|release|update)[.!]?$/i, '')
      .replace(/https?:\/\/\S+/g, '').replace(/\s+/g, ' ').trim();
    if (text.length <= 180) return text;
    const cut = text.slice(0, 177).replace(/\s+\S*$/, '');
    return (cut || text.slice(0, 177)) + '…';
  }
  function groups(state, settings, month = '') {
    const rows = displayEntries(state, settings), days = new Map();
    for (const row of rows) {
      const at = Number.isFinite(row.publishedAt) ? row.publishedAt :
        state.publicAlertState?.entries?.[row.item.id]?.observedAt || row.item.firstDetectedAt;
      if (!Number.isFinite(at)) continue;
      const key = dayKey(at);
      if (month && !(Array.isArray(month) ? month : [month]).includes(key.slice(0, 7))) continue;
      if (!days.has(key)) days.set(key, []);
      days.get(key).push(row);
    }
    return [...days].sort(([a], [b]) => b.localeCompare(a)).map(([day, items]) => ({ day, items, ...summary(items) }));
  }
  function prune(records, now = Date.now()) {
    return Object.fromEntries(Object.entries(records || {}).filter(([key, record]) => /^\d{4}-\d{2}-\d{2}$/.test(key) &&
      Number.isFinite(record?.sentAt) && record.sentAt <= now + 300000 && record.sentAt > now - 8 * DAY));
  }
  function signature(row) {
    let hash = 2166136261;
    const value = [row.item.text, row.timing, row.item.assessment?.report, row.item.assessment?.semanticCategory].join('\0');
    for (let i = 0; i < value.length; i++) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619);
    return (hash >>> 0).toString(16); // Revision hint, not an authentication digest.
  }
  function sourceSignature(row) {
    // Public source revision only: enriching a displayed schedule must not
    // retract a delivered toast. This remains a revision hint, not identity proof.
    const item = row.item;
    return signature({ item: { text: JSON.stringify([item.id, item.author, item.url, item.createdAt, item.text]) }, timing: '' });
  }
  function excerpt(row) {
    const text = [row.item.text, ...(row.item.pollOptions || [])].join('\n');
    const clauses = text.split(/(?<=[!?;\n])\s*|(?<=[^\d]\.)\s+(?!\d)/);
    const relevant = clauses.filter(part => /\bresets?|quota|allowance|\b(?:by|before)\b/i.test(part));
    return relevant.join(' ').trim() || text;
  }
  function statusKind(row) { // Mirrors status(); class hook only, text comes from status().
    if (row.topic === 'model-release') return 'model';
    const assessment = row.item.assessment || {};
    if (row.change || assessment.report === 'reset-update') return 'update';
    if (assessment.report === 'credit-grant' || root.RadarSignals.bankedForecast(row.item) || root.RadarSignals.bankedGrant(row.item)) return 'grant';
    if (assessment.completionLink === 'inferred') return 'inferred';
    if (assessment.report === 'completed-reset') return 'completed';
    return root.RadarSignals.isResetForecast(row.item) ? 'forecast' : 'inferred';
  }
  function statusChips(rows) {
    const seen = new Map();
    for (const row of rows || []) { const text = status(row); if (!seen.has(text)) seen.set(text, { kind: statusKind(row), text }); }
    return [...seen.values()];
  }
  // A display-only quotation, never a calculated timestamp or alert input.
  // Keep the whole short clause so qualifiers such as "not" are retained.
  function timeExpression(row) {
    const item = row?.item;
    if (!item || item.truncated || row.topic || row.event || !root.RadarSecurity.evidenceUrl(item) ||
        typeof item.text !== 'string' || item.text.length > 6000) return '';
    const source = item.source?.id;
    if (source !== 'codex-lead' || !root.RadarSignals.isLead(item)) return '';
    const canonical = `https://x.com/${String(item.author || '').replace(/^@/, '').toLowerCase()}/status/${item.id}`;
    if (root.RadarSecurity.evidenceUrl(item).toLowerCase() !== canonical) return '';
    const clock = /\b(?:soon|shortly|later|today|tonight|tomorrow|yesterday|morning|afternoon|evening|midnight|noon|eod|(?:this|next|last)\s+(?:week|weekend|month|morning|afternoon|evening)|(?:within|in|after|before|by|over|during)\s+(?:the\s+)?(?:next\s+)?(?:a\s+few|a\s+couple\s+of|\d+|an?|the|end\s+of\s+the)\s+(?:minutes?|hours?|days?|weeks?|months?|day)|(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)|(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d{1,2}|(?:[01]?\d|2[0-3]):[0-5]\d|(?:1[0-2]|0?[1-9])(?::[0-5]\d)?\s*[ap]\.?m\.?|\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)\b|(?:곧|오늘|내일|모레|이번\s*주|다음\s*주|오전|오후|\d+\s*(?:시간|분|일)\s*(?:후|이내|전))/i;
    const separateTopic = /\b(?:launch(?:es|ed|ing)?|releases?|ship(?:ped|ping)?|product|keynote|conference|event|features?|api)\b/i;
    const linkedReply = root.RadarSignals.inferredTimingContext(item) === true;
    const parts = item.text.split(/(?<=[.!?;])\s*|\n+/).map(s => s.replace(/\s+/g, ' ').trim()).filter(Boolean);
    const clause = parts.find(part => part.length <= 240 && clock.test(part) && !separateTopic.test(part) &&
      (/\bresets?\b|리셋|초기화/i.test(part) || linkedReply));
    return clause || '';
  }
  function verifiedTime(row) { // Uses the already zone-encoded schedule; never derives a clock.
    const en = (root.RadarI18n?.uiLanguage?.() || 'ko').startsWith('en');
    if (row.topic === 'model-release') return { verified: false, text: '', detail: '' };
    const time = row.timingSchedule || root.RadarNews.schedule(row.item) || {};
    const at = Number.isFinite(time.deadlineAt) ? time.deadlineAt : Number.isFinite(time.instant) ? time.instant : NaN;
    if (!Number.isFinite(at) || !time.text) {
      const expression = timeExpression(row);
      return { verified: false, text: expression ? `${en ? 'Source wording' : '원문 시간 표현'} · “${expression}”` :
        (en ? 'Reset time unverified' : '리셋 시각 미확인'), detail: expression ?
        (en ? 'Original wording; reset time and interpretation are unconfirmed.' : '원문 표현이며 리셋 시각과 해석은 미확정입니다.') : '', expression };
    }
    return { verified: true, at, text: compactTime({ text: time.text.split('\n').at(-1) }), detail: time.detail || '' };
  }
  // Display-only helpers for the daily card; ledger/summary semantics untouched.
  function resetCounts(rows) { // Every row counts once; public credit-grant notices count separately (never as
    // inferred resets, never as a personal balance); other public updates still fold into inferred.
    const counts = { forecast: 0, completed: 0, inferred: 0, grant: 0 };
    for (const row of rows || []) { const kind = statusKind(row); if (kind === 'model') counts.model = (counts.model || 0) + 1; else { counts[kind in counts ? kind : 'inferred']++; if (row.modelRelease) counts.model = (counts.model || 0) + 1; } }
    return counts;
  }
  function digestText(rows, max = 260) { // Extractive: deduped relevant clauses from all rows.
    const en = (root.RadarI18n?.uiLanguage?.() || 'ko').startsWith('en'), list = rows || [], seen = new Set(), parts = [];
    for (const row of list) for (const clause of brief(row).split(/(?<=[.!?])\s+/)) {
      const norm = clause.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
      if (norm && !seen.has(norm)) { seen.add(norm); parts.push(clause.trim()); }
    }
    let text = (en ? `${list.length} posts detected` : `${list.length}건 탐지`) + (parts.length ? ' — ' + parts.join(' · ') : '');
    if (text.length > max) text = (text.slice(0, max - 1).replace(/\s+\S*$/, '') || text.slice(0, max - 1)) + '…';
    return text;
  }
  function dayTimes(rows) { // Distinct verified times only; never borrows/derives a clock.
    const seen = new Map();
    for (const row of rows || []) { const info = verifiedTime(row); if (info.verified && !seen.has(info.text)) seen.set(info.text, info); }
    return [...seen.values()].sort((a, b) => a.at - b.at);
  }
  function sourceLabels(rows) {
    const counts = new Map();
    return (rows || []).map(row => {
      const base = String(author(row)).split(/[\s·(@]/)[0] || 'Src', n = (counts.get(base) || 0) + 1;
      counts.set(base, n); return base + n;
    });
  }
  root.RadarDailyNews = Object.freeze({ publicId, dayKey, recentMonths, entries, displayEntries, summary, headline, compactTime, status, statusKind, statusChips, verifiedTime, timeExpression, author, brief, groups, prune, signature, sourceSignature, excerpt, resetCounts, digestText, dayTimes, sourceLabels });
  if (typeof module !== 'undefined') module.exports = root.RadarDailyNews;
})(globalThis);
