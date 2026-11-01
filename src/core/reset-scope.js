// Independent topical evidence for public reset alerts. Model output is not proof.
(function (root) {
  const str = value => typeof value === 'string' ? value : '';
  const technical = /\b(?:password|git|factory|router|device|database|cache|memory|config|workspace|session|api[ -]?key|workflow|brain|mind|claude|anthropic|gemini)\b/i;
  const quota = /\b(?:quotas?|allowances?|(?:usage|weekly|rate|codex) limits?)\b/;
  const refill = /\b(?:fresh(?: start)?|refill(?:ed|ing)?|refresh(?:ed|ing)?|renew(?:ed|ing)?|restor(?:e|ed|ing)|replenish(?:ed|ing)?|reset(?:s|ting)?)\b/;
  function topical(text) {
    return str(text).toLowerCase().split(/[.!?;\n]+/).some(part => {
      if (technical.test(part) || /\bcontext (?:window |length )?reset|\breset (?:the |your |my )?context\b/.test(part)) return false;
      if (/\b(?:resets?|resetting)\b/.test(part)) return true;
      const q = quota.exec(part), r = refill.exec(part);
      return !!q && !!r && Math.abs(q.index - r.index) <= 80;
    });
  }
  function followUp(text) {
    const value = str(text).trim().toLowerCase().replace(/[’‘]/g, "'");
    if (value.length > 240 || /\b(?:accountant|documents?|password|new model|model release|product launch|launch(?:ing)?|release(?:d|s)?)\b/i.test(value)) return false;
    return /^(?:done|all done|complete(?:d)?|finished|it(?:'s| is) (?:now )?(?:done|complete(?:d)?|finished))[.!]*$/.test(value) ||
      /^(?:(?:confirmed[, ]+)?(?:now )?landed\b|all fixed\b|will be there by\b|(?:lands?|landing|arriving|coming|rolling out)\b|(?:ok(?:ay)? fine|yes|sure)[,.!\s])/.test(value) ||
      /^(?:(?:next|this) )?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|today|tonight|tomorrow)\b[\s\d:apm.!👀]*(?:pst|pdt|pt|utc|gmt|kst)?[.!\s]*$/.test(value) ||
      /^(?:[1-9]|1[0-2])(?::[0-5]\d)?\s*(?:am|pm)(?:\s+(?:pst|pdt|pt|utc|gmt|kst))?[.!\s]*$/.test(value);
  }
  function context(item, ref, depth = 0) {
    if (ref?.relation === 'previous-reset-announcement') return ref === item.replyContext && root.RadarSignals?.inferredTimingContext(item) === true;
    if (!ref || !['conversation-before', 'quoted-post', 'previous-announcement'].includes(ref.relation) || ref.targetId !== item.id) return false;
    if (ref.relation === 'previous-announcement' && !(item.assessment?.report === 'completed-reset' && item.assessment.completionLink === 'inferred')) return false;
    const match = /^https:\/\/x\.com\/([A-Za-z0-9_]{1,15})\/status\/([1-9]\d{0,24})$/.exec(str(ref.url));
    const before = Date.parse(ref.createdAt), at = Date.parse(item.createdAt);
    return !!match && match[1].toLowerCase() === str(ref.author).replace(/^@/, '').toLowerCase() && match[2] === str(ref.id) &&
      ref.id !== item.id && !ref.truncated && Number.isFinite(before) && Number.isFinite(at) && before < at && at - before <= 7 * 86400000 &&
      (topical(ref.text) || depth === 0 && followUp(ref.text) && context(ref, ref.replyContext, 1));
  }
  function allows(item, settings = {}) {
    if (!item) return false;
    const sourceSetting = { 'codex-lead': 'monitorLeadSource', 'openai-status': 'monitorStatusSource',
      'community-reset-history': 'monitorHistorySource', 'github-community': 'monitorCommunitySource' }[item.source?.id];
    if (sourceSetting && settings[sourceSetting] === false) return false;
    if (settings.resetOnly === false || item.source?.id !== 'codex-lead') return true;
    if (item.truncated || !str(item.text).trim()) return false;
    if (root.RadarSignals?.resetMetaphor(item)) return true;
    if (topical(item.text)) return true;
    // Revalidate the quote/reply chain rather than trusting a stored verdict.
    // A verified propagation report need not repeat the word "reset" itself.
    if (item.assessment?.report === 'completed-reset' && item.assessment.completionLink === 'verified' &&
        root.RadarSignals?.reports([item]).some(report => report.id === item.id &&
          report.assessment.report === 'completed-reset' && report.assessment.completionLink === 'verified')) return true;
    // Poll choices are public text too; use the existing bounded survey rules.
    if (root.RadarSignals?.resetDiscussion(item)?.rule === 'reset-poll') return true;
    if (followUp(item.text) && [item.replyContext, item.semanticContext].some(ref => context(item, ref))) return true;
    // Narrow branch: same-author strict clock deadline reply (e.g. a bare midnight deadline) under a verified canonical parent.
    // Only replyContext is considered here; semanticContext is intentionally ignored.
    const signals = root.RadarSignals, ref = item.replyContext;
    if (!signals || !ref || typeof signals.clockDeadline !== 'function' || typeof signals.classify !== 'function') return false;
    const handle = value => str(value).replace(/^@/, '').toLowerCase();
    const own = /^https:\/\/x\.com\/([A-Za-z0-9_]{1,15})\/status\/([1-9]\d{0,24})$/.exec(str(item.url));
    const author = handle(item.author);
    if (!own || !author || own[1].toLowerCase() !== author || own[2] !== str(item.id)) return false;
    if (handle(ref.author) !== author) return false;
    if (!signals.clockDeadline(item.text)) return false;
    if (!context(item, ref)) return false;
    const at = Date.parse(item.createdAt);
    if (!Number.isFinite(at)) return false;
    return signals.classify(item, { now: at })?.actionable === true ||
      (typeof signals.inferredTimingContext === 'function' && signals.inferredTimingContext(item) === true);
  }
  function schedule(state, settings) {
    return { ...state, events: (state?.events || []).filter(event => allows(event.original, settings)) };
  }
  root.RadarResetScope = Object.freeze({ allows, topical, schedule });
  if (typeof module !== 'undefined') module.exports = root.RadarResetScope;
})(globalThis);
