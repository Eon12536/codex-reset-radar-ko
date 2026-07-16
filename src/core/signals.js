(function initSignals(root) {
  // Dayclaw payload normalization follows the public source shape documented by
  // thinkingjimmy/codex-reset-watchdog. The classifier below is an independent,
  // deterministic browser implementation because that repository does not
  // currently expose a license through GitHub's license endpoint.
  const QUOTA_TERMS = [
    "codex", "usage limit", "weekly limit", "rate limit", "quota", "allowance",
    "capacity", "caps", "credits", "用量", "额度", "限额", "配额"
  ];
  const RESET_TERMS = [
    "will reset", "resetting", "reset limits", "refill", "restore", "replenish",
    "top up", "make good", "get their allowance back", "重置", "恢复额度", "补回额度"
  ];
  const FUTURE_TERMS = [
    "later today", "this evening", "tonight", "tomorrow", "next hour", "soon",
    "after the deploy", "this week", "稍后", "今晚", "明天", "即将", "之后"
  ];
  const COMPLETE_TERMS = [
    "have now reset", "has been reset", "limits are reset", "we reset", "completed",
    "已重置", "已经重置", "恢复完成"
  ];
  const NEGATIONS = [
    "no reset", "not planned", "won't reset", "will not reset", "cannot reset",
    "不重置", "没有重置", "不会重置"
  ];
  const EXCLUSIONS = [
    "git reset", "password reset", "reset button", "reset config", "reset cache",
    "database reset", "workspace reset", "token reset", "重置密码", "重置配置", "重置按钮"
  ];

  function includesAny(text, terms) {
    return terms.some((term) => text.includes(term));
  }

  function approximateEventTime(text, createdAt, now = Date.now()) {
    const base = root.RadarTime?.parseTimestamp?.(createdAt) || now;
    const lower = text.toLowerCase();
    if (includesAny(lower, ["next hour", "in the next hour", "一小时内"])) return base + 60 * 60 * 1000;
    if (includesAny(lower, ["later today", "this evening", "tonight", "今晚", "稍后"])) {
      return base + 8 * 60 * 60 * 1000;
    }
    if (includesAny(lower, ["tomorrow morning", "明早", "明天早上"])) return base + 18 * 60 * 60 * 1000;
    if (includesAny(lower, ["tomorrow", "明天"])) return base + 24 * 60 * 60 * 1000;
    if (includesAny(lower, ["this week", "本周"])) return base + 3 * 24 * 60 * 60 * 1000;
    if (includesAny(lower, ["soon", "即将"])) return base + 6 * 60 * 60 * 1000;
    return null;
  }

  function classify(item, options = {}) {
    const now = options.now ?? Date.now();
    const text = String(item?.text || item?.content || "").replace(/\s+/g, " ").trim();
    const lower = text.toLowerCase();
    const createdAt = root.RadarTime?.parseTimestamp?.(item?.createdAt ?? item?.created_at ?? item?.published_at);
    if (!text || includesAny(lower, NEGATIONS) || includesAny(lower, EXCLUSIONS)) {
      return { actionable: false, confidence: "none", score: 0, reason: "negated-or-unrelated" };
    }
    const hasQuota = includesAny(lower, QUOTA_TERMS);
    const hasReset = includesAny(lower, RESET_TERMS);
    const hasFuture = includesAny(lower, FUTURE_TERMS);
    const completed = includesAny(lower, COMPLETE_TERMS);
    let score = 0;
    if (hasQuota) score += 3;
    if (hasReset) score += 3;
    if (hasFuture) score += 2;
    if (/we|we'll|we will|i will|planning|计划|我们/.test(lower)) score += 1;
    if (completed) score -= 3;
    if (item?.isReply) score -= 1;
    const eventAt = approximateEventTime(lower, createdAt, now);
    const future = eventAt ? eventAt > now : hasFuture;
    const actionable = hasQuota && hasReset && !completed && future && score >= 7;
    const confidence = score >= 8 ? "high" : score >= 6 ? "medium" : "low";
    return {
      actionable,
      confidence,
      score,
      eventAt,
      reason: actionable ? "future-quota-reset-language" : completed ? "historical-complete" : "insufficient-signal"
    };
  }

  function normalizeItem(raw) {
    const metadata = raw?.metadata && typeof raw.metadata === "object" ? raw.metadata : {};
    const id = String(raw?.external_id || raw?.id || "").trim();
    const text = String(raw?.content ?? raw?.title ?? "").trim();
    if (!id || !text) return null;
    const author = metadata.author_user_name || raw.author || null;
    return {
      id,
      text,
      author,
      createdAt: raw.published_at || raw.created_at || null,
      url: raw.url || (author ? `https://x.com/${author}/status/${id}` : `https://x.com/i/web/status/${id}`),
      isReply: Boolean(metadata.is_reply ?? raw.isReply ?? raw.inReplyToId)
    };
  }

  function extractItems(payload) {
    const rawItems = payload?.items || payload?.data?.items || payload?.result?.items || [];
    return Array.isArray(rawItems) ? rawItems.map(normalizeItem).filter(Boolean) : [];
  }

  function strongest(items, options = {}) {
    return items
      .map((item) => ({ ...item, assessment: classify(item, options) }))
      .filter((item) => item.assessment.actionable)
      .sort((a, b) => b.assessment.score - a.assessment.score || (b.assessment.eventAt || 0) - (a.assessment.eventAt || 0))[0] || null;
  }

  root.RadarSignals = Object.freeze({ classify, normalizeItem, extractItems, strongest });
  if (typeof module !== "undefined") module.exports = root.RadarSignals;
})(globalThis);
