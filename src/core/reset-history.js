(function initResetHistory(root) {
  // Display-only ledger: never used as a source for live classifications or
  // notifications. Do not silently evict previously recorded posts.
  function clean(item) {
    if (!item || item.source?.id !== 'codex-lead' || item.truncated || typeof item.text !== 'string' || !item.text.trim() || item.text.length > 6000) return null;
    const id = String(item.id || ''), author = String(item.author || '').replace(/^@/, '').toLowerCase();
    if (!/^[1-9]\d{0,24}$/.test(id) || !['thsottiaux', 'reach_vb', 'openai'].includes(author)) return null;
    const expected = `https://x.com/${author}/status/${id}`;
    if (root.RadarSecurity.evidenceUrl(item)?.toLowerCase() !== expected || !Number.isFinite(Date.parse(item.createdAt))) return null;
    const a = item.assessment || {};
    const assessment = { actionable: a.actionable === true, candidate: a.candidate === true,
      ...(typeof a.rule === 'string' ? { rule: a.rule.slice(0, 80) } : {}),
      ...(typeof a.report === 'string' ? { report: a.report.slice(0, 80) } : {}),
      ...(typeof a.grantStage === 'string' ? { grantStage: a.grantStage.slice(0, 30) } : {}),
      ...(typeof a.completionLink === 'string' ? { completionLink: a.completionLink.slice(0, 30) } : {}),
      ...(typeof a.completionContext === 'string' ? { completionContext: a.completionContext.slice(0, 30) } : {}),
      ...(typeof a.timingLink === 'string' ? { timingLink: a.timingLink.slice(0, 30) } : {}),
      ...(typeof a.confidence === 'string' ? { confidence: a.confidence.slice(0, 20) } : {}),
      ...(typeof a.reason === 'string' ? { reason: a.reason.slice(0, 400) } : {}),
      ...(Number.isFinite(a.eventAt) ? { eventAt: a.eventAt } : {}) };
    return { id, author, text: item.text, createdAt: new Date(item.createdAt).toISOString(), url: expected,
      source: { id: 'codex-lead', label: root.RadarSignals.authorName(item) + ' · 공개 소식',
        kind: item.source.kind === 'x-page' ? 'x-page' : 'dayclaw', weight: 1 }, assessment };
  }
  function merge(existing, rows, observed = []) {
    const previous = Array.isArray(existing?.items) ? existing.items : [];
    const saved = new Map(previous.filter(item => item && typeof item.id === "string").map(item => [item.id, item]));
    const byKey = new Map((rows || []).map(row => [row.key, row]));
    for (const row of rows || []) {
      if (row.topic || row.event || row.change) continue;
      const item = clean(row.item);
      if (!item || !root.RadarResetScope.allows(row.item, { monitorLeadSource: true, resetOnly: true })) continue;
      const timingItem = row.timingSourceKey && clean(byKey.get(row.timingSourceKey)?.item);
      if (timingItem && timingItem.author === item.author && Date.parse(timingItem.createdAt) > Date.parse(item.createdAt)) {
        item.timingSource = timingItem;
        item.timingAssociation = row.timingSchedule?.association === 'inferred' ? 'inferred' : 'verified';
      }
      const old = saved.get(item.id);
      if (old?.timingSource && !item.timingSource && old.text === item.text && old.createdAt === item.createdAt) {
        item.timingSource = old.timingSource;
        item.timingAssociation = old.timingAssociation;
        if (old.timingStale) item.timingStale = true;
      }
      if (old && JSON.stringify(old) === JSON.stringify(item)) continue;
      saved.set(item.id, item);
    }
    // Preserve records but stop displaying stale claims when X supplies an
    // edited body; invalidate linked schedules if their source was edited.
    for (const raw of observed || []) {
      const current = clean(raw);
      if (!current) continue;
      const record = saved.get(current.id);
      if (record && record.author === current.author && record.text !== current.text)
        saved.set(record.id, { ...record, retracted: true });
      for (const [key, parent] of saved) {
        if (parent.timingSource?.id === current.id && parent.timingSource.author === current.author && parent.timingSource.text !== current.text)
          saved.set(key, { ...parent, timingStale: true });
      }
    }
    return { version: 1, items: [...saved.values()], full: false };
  }
  function rows(state, settings) {
    if (!settings.monitorSignals || !settings.monitorLeadSource) return [];
    return (Array.isArray(state.resetHistory?.items) ? state.resetHistory.items : []).flatMap(raw => {
      if (raw?.retracted) return [];
      const item = clean(raw);
      if (!item) return [];
      const row = root.RadarNews.describe(item, 'codex-lead:' + item.id);
      const timingItem = clean(raw.timingSource);
      if (!raw.timingStale && timingItem && timingItem.author === item.author && Date.parse(timingItem.createdAt) > Date.parse(item.createdAt)) {
        const time = root.RadarNews.schedule(timingItem);
        if (Number.isFinite(time.deadlineAt) || Number.isFinite(time.instant)) {
          row.timingSchedule = { ...time, detail: time.detail + (raw.timingAssociation === 'inferred' ? ' · 후속 글 기준 추정' : ' · 확인된 답글 기준') };
          row.timing = time.text;
          row.timingDetail = time.detail + (raw.timingAssociation === 'inferred' ? ' · 후속 글 기준 추정' : ' · 확인된 답글 기준');
        }
      }
      return [{ ...row, historical: true }];
    });
  }
  function classifyRows(items, settings) {
    if (!settings.monitorSignals || !settings.monitorLeadSource) return [];
    const result = [];
    for (const item of items || []) {
      const at = root.RadarTime.parseTimestamp(item.createdAt);
      if (!at || at > Date.now() + 300000) continue;
      const report = root.RadarSignals.reports([item], { now: at }).find(entry => entry.id === item.id);
      const signal = root.RadarSignals.classify(item, { now: at });
      const hint = !signal.actionable && !report ? root.RadarSignals.classifyHint(item, { now: at }) : null;
      if (!report && !signal.actionable && !hint?.candidate) continue;
      const verified = { ...item, assessment: report?.assessment || (signal.actionable ? signal : hint) };
      if (!root.RadarResetScope.allows(verified, { ...settings, resetOnly: true })) continue;
      result.push(root.RadarNews.describe(verified, 'codex-lead:' + verified.id));
    }
    return result;
  }
  root.RadarResetHistory = Object.freeze({ merge, rows, classifyRows });
  if (typeof module !== 'undefined') module.exports = root.RadarResetHistory;
})(globalThis);
