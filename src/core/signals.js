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
    "after the deploy", "this week", "next week", "monday", "tuesday", "wednesday",
    "thursday", "friday", "saturday", "sunday", "稍后", "今晚", "明天", "即将", "之后"
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

  // Rules curated from supplied short excerpts, not a trained model or verified
  // reset history. Keep future event labels and personal telemetry out of input.
  const UNRELATED = /\b(?:git|password|database|workspace|config|cache|claude|gemini|hoodies?|swag|merch(?:andise)?|door handle|giveaway|winners?|fans?)\b/;
  const BANKED_CREDIT = /\b(?:(?:banked|stored|spare) (?:reset )?credits?|reset credits?|resets? (?:in|to|for) (?:your |the )?bank)\b/;
  const RHETORICAL = /\bwho (?:says|said) (?:that )?(?:it|codex(?: (?:usage )?limits?)?|(?:the |your )?(?:usage |weekly |rate )?limits?) (?:won't|will not) reset\b/g;
  const QUALIFIED_TIME = /\b(?:not (?:today|tonight|this week|yet)|(?:no|without) (?:date|eta|schedule)|delayed|postponed|rescheduled|pushed back|moved to)\b/;
  const SPECULATIVE = /\b(?:may|might|maybe|could|should|shall|if|whether|hope|hopefully)\b|\?/;

  function normalizedText(item) {
    return String(item?.text || item?.content || "").slice(0, 6000).toLowerCase().replace(/[’‘]/g, "'").trim();
  }

  function isLead(item) {
    return item?.source?.id === 'codex-lead' && /^@?(?:thsottiaux|reach_vb|openai)$/i.test(item.author || '');
  }
  function authorName(item) { return ({thsottiaux: 'Tibo', reach_vb: 'VB', openai: 'OpenAI'})[String(item?.author || '').replace(/^@/, '').toLowerCase()] || 'X'; }
  // Only X profile-image paths. No credentials, query parameters or arbitrary hosts.
  function avatarUrl(value) { return typeof value === 'string' && value.length <= 512 && /^https:\/\/pbs\.twimg\.com\/profile_images\/[a-zA-Z0-9_/-]+\.(?:png|jpe?g|webp)$/.test(value) ? value : null; }
  function pollOptions(value) {
    return Array.isArray(value) ? value.slice(0, 4).flatMap(option => {
      const label = typeof option === 'string' ? option : option?.label ?? option?.text;
      return typeof label === 'string' && label.trim() ? [label.trim().slice(0, 160)] : [];
    }) : [];
  }
  function resetDiscussion(item) {
    if (!isLead(item)) return null;
    const text = normalizedText(item);
    const choices = pollOptions(item.pollOptions).map(option => option.toLowerCase());
    const all = [text, ...choices].join(' ');
    if (UNRELATED.test(all) || includesAny(all, EXCLUSIONS) || BANKED_CREDIT.test(all) || isNegated(text) || isCompleted(text) ||
      /\b(?:yesterday|last (?:year|month|week)|(?:years?|months?) ago|previous|recap)\b/.test(text)) return null;
    if (choices.length >= 2 && choices.some(choice => /\b(?:needs?|want(?:s)?|should|time for) (?:a |another |the )?reset\b/.test(choice) && !isNegated(choice)))
      return { rule: 'reset-poll', reason: '리셋 필요 여부를 묻는 설문 · 지급·실행 약속은 아님' };
    if (/\b(?:updates?|releases?|features?|ships?) or (?:a |another |the )?reset\b/.test(text))
      return { rule: 'reset-choice', reason: '업데이트와 리셋을 선택지로 언급 · 실행 여부·시각 미확정' };
    return null;
  }
  const DIRECT_PROMISE = /\b(?:we|i)(?:'ll| will| are going to| am going to) (?:also |now )?reset\b/;

  function leadResetPromise(item, text) {
    // A named author's explicit reset promise supplies the context omitted in
    // short follow-ups. No post ID or user-submitted URL is a detection rule.
    return isLead(item) &&
      /\b(?:i|we)(?: have)? promis(?:e|ed) (?:you )?(?:a |another |the )?reset\b/.test(text) &&
      /\b(?:for|on|this|next|today|tonight|tomorrow|soon)\b/.test(text) &&
      !/\b(?:last|yesterday|ago|cancelled|canceled|delivered|broke|withdrawn|cannot|can't|won't|no longer)\b/.test(normalizedText(item));
  }

  function leadResetAnnouncement(item, text) {
    // Monitored authors often omit "Codex limits" in a short follow-up.
    // A direct forward-looking reset statement supplies that missing context;
    // it does not identify the reset kind or give an exact execution time.
    const datedReset = /^(?:(?:also|and)[,:]?\s+)?(?:(?:a|another|the|global)\s+){0,2}resets? (?:is |are |will be )?on\s+(?:(?:this|next)\s+)?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/.test(text) &&
      !/\b(?:was|were|had|did|not|never|happened|recap|previous)\b/.test(text);
    return isLead(item) &&
      (/\bresets? (?:are |is |will be )?(?:coming|on the way|planned|scheduled|due|land(?:ing|s)|arriv(?:ing|es)|happening|rolling out)\b/.test(text) || datedReset) &&
      includesAny(text, FUTURE_TERMS) &&
      !/\b(?:banked|credits?|heard|hear|rumou?rs?|apparently|reportedly|said|says|last|yesterday|ago|cancelled|canceled)\b/.test(normalizedText(item)) &&
      !/["“”]/.test(String(item.text || ''));
  }

  function clauses(text) {
    // A model version (GPT-6.1) or decimal belongs to its sentence. Splitting
    // it at the dot can separate the product name from "is now available".
    return text.split(/[!?;\n。！？]+|(?<!\d)\.|\.(?!\d)/).map(part => part.trim()).filter(Boolean);
  }

  function isNegated(text) {
    const withoutTimeQualifier = text.replace(/\bnot (?:today|tonight|this week|yet)\b/g, "timing uncertain");
    return includesAny(text, NEGATIONS) || /\b(?:not|never|won't|cannot|can't|no)\b.{0,35}\b(?:reset|refill|refuel|recharg|fresh|top.?up|button|surprise|gift|celebrat|milestone)/.test(withoutTimeQualifier);
  }

  function isCompleted(text) {
    return /\b(?:already|yesterday|completed|have (?:now )?(?:been )?reset|has (?:now )?(?:been )?reset|just reset|limits are reset|all reset for|reset all propagated|brand new usage|tokens flow again|rest is history)\b/.test(text)
      || /\bresets? (?:have (?:now )?)?(?:all )?(?:propagated|completed|done)\b/.test(text)
      || /\b(?:i|we) reset\b/.test(text) && !/\b(?:should|shall|can|could|if) (?:i|we) reset\b/.test(text)
      || includesAny(text, ["已重置", "已经重置", "恢复完成"]);
  }

  function prospective(text) {
    return includesAny(text, FUTURE_TERMS) || /\b(?:in a while|may|might|maybe|could|should|let's|shall we|going to|time to)\b/.test(text);
  }

  function timeQualifier(text) {
    if (/\bnot today\b/.test(text)) return "오늘은 아님";
    if (/\bnot tonight\b/.test(text)) return "오늘 밤은 아님";
    if (/\bnot this week\b/.test(text)) return "이번 주는 아님";
    return QUALIFIED_TIME.test(text) ? "일정 미확정·변경 가능" : "";
  }

  const CLOCK = /\b(?:(?:1[0-2]|0?[1-9])(?::[0-5]\d)?\s*[ap]\.?m\.?|(?:[01]?\d|2[0-3]):[0-5]\d)(?![\w:])/i;
  const DAY = /\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|today|tonight|tomorrow)\b/i;
  const PRODUCT = /\b(?:codex|chatgpt|openai|sora|gpt[- ]?\d[\w.-]*)\b/i;
  const LAUNCH = /\b(?:launch(?:ing|es)?|release|releasing|ship(?:ping|s)?|roll(?:ing)? out|announc(?:e|ing|ement)|unveil(?:ing)?|drop(?:ping|s)?|available|coming|go(?:ing|es)? live)\b/i;
  const EVENT = /\b(?:dev\s?day|developer (?:day|conference)|openai (?:event|keynote|livestream))\b/i;
  function eventContext(item) {
    const own = String(item?.text || '');
    if (EVENT.test(own)) return own;
    const parent = item?.replyContext;
    // Borrow the event name, never a parent's date for an undated reaction.
    if (parent?.relation !== 'conversation-before' || parent.targetId !== item.id ||
        !/^https:\/\/x\.com\/(?:OpenAI|thsottiaux|reach_vb)\/status\/[1-9]\d{0,24}$/i.test(parent.url || '') ||
        !parent.url.endsWith('/' + parent.id)) return '';
    const name = EVENT.exec(parent.text || '')?.[0];
    return name ? name + '. ' + own : '';
  }
  function hasEventTime(text) {
    return CLOCK.test(String(text || '').replace(/\b(?:UTC|GMT)\s*[+-]\d{1,2}(?::?\d{2})?\b/gi, '')) || DAY.test(text) ||
      /\b20\d{2}-\d{1,2}-\d{1,2}\b|\b\d{1,2}\/\d{1,2}\b|\b(?:Jan\w*|Feb\w*|Mar\w*|Apr\w*|May|Jun\w*|Jul\w*|Aug\w*|Sep\w*|Oct\w*|Nov\w*|Dec\w*)\.?\s+\d|\b\d{1,2}(?:st|nd|rd|th)?\s+(?:Jan\w*|Feb\w*|Mar\w*|Apr\w*|May|Jun\w*|Jul\w*|Aug\w*|Sep\w*|Oct\w*|Nov\w*|Dec\w*)/i.test(text);
  }

  function timedAnnouncement(item, text) {
    const clock = CLOCK.exec(text);
    if (!clock || isCompleted(text) || /\b(?:yesterday|last|ago|launched|released|shipped|announced|was|were|cancelled|canceled|delayed|postponed|not|never|won't|can't|cannot)\b/.test(text)) return null;
    const context = item.replyContext;
    const linked = context?.relation === "conversation-before" && context.targetId === item.id && referenceId(context.id) &&
      /^https:\/\/x\.com\/[a-zA-Z0-9_]{1,15}\/status\/[1-9]\d{0,24}$/.test(context.url || "") && context.url.endsWith("/" + context.id);
    const product = PRODUCT.test(text) || (linked && PRODUCT.test(context.text || ""));
    // A short calendar+clock reply can stand on its own as a weak schedule clue.
    // Product context does not establish a release, let alone a quota reset.
    const remainder = text.replace(clock[0], "").replace(new RegExp(DAY.source, "gi"), "")
      .replace(/\b(?:on|a|at|this|next|the|maybe|perhaps|see|you|then|utc|gmt|kst|pst|pdt|pt|est|edt|et)\b/gi, "")
      .replace(/[^\p{L}\p{N}]/gu, "");
    const shortSchedule = DAY.test(text) && !remainder;
    const productSchedule = DAY.test(text) && !remainder.replace(new RegExp(PRODUCT.source, "gi"), "");
    if (!shortSchedule && !(product && (LAUNCH.test(text) || productSchedule || (linked && !remainder)))) return null;
    const retrospective = linked && /\b(?:was|were|yesterday|ago|last|recap)\b/i.test(context.text || "");
    return { candidate: true, actionable: false, confidence: "low", eventAt: null, qualifier: "",
      rule: product ? "product-time" : "schedule-time",
      reason: retrospective ? "행사 회고 문맥의 시간 언급 · 출시·리셋 여부 미확인" :
        product ? "출시·공개 일정 단서 · 리셋 여부 미확인" : "요일·시각을 지정한 짧은 답글 · 출시·리셋 여부 미확인" };
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

  function productEventHint(item, text) {
    // These are news clues, never reset promises or inputs to reset forecasts.
    const context = item.replyContext;
    const linked = context?.relation === 'conversation-before' && context.targetId === item.id && referenceId(context.id) &&
      /^https:\/\/x\.com\/[a-zA-Z0-9_]{1,15}\/status\/[1-9]\d{0,24}$/.test(context.url || '') && context.url.endsWith('/' + context.id);
    const parent = linked ? String(context.text || '').toLowerCase() : '';
    const product = /\b(?:codex|chatgpt|sora|gpt[- ]?\d[\w.-]*|(?:new|next|upcoming) (?:model|product|feature|release))\b/;
    const announcement = /\b(?:introducing|meet|this is|launch(?:ing|es|ed)?|releas(?:e|ing|ed)|ship(?:ping|s|ped)?|roll(?:ing)? out|unveil(?:ing|ed)?|announc(?:e|ing|ed)|available|out now|can now|now (?:you|users?|everyone) can|coming|arriv(?:es|ing)|go(?:ing|es)? live)\b/;
    const past = /\b(?:yesterday|last (?:week|month|year)|ago|recap|throwback|was|were)\b/;
    const cancelled = /\b(?:cancelled|canceled|delayed|postponed|not|never|won't|cannot|can't)\b/;
    if (past.test(text) || cancelled.test(text.replace(/\bcan't wait\b/g, "eager"))) return null;
    const response = /\b(?:soon|tomorrow|coming|stay tuned|see you|ready|excited|can't wait)\b|👀|🚀/;
    const eventPost = Boolean(eventContext(item));
    if (eventPost && !hasEventTime(text)) return null;
    const launchPost = clauses(text).some(part => product.test(part) && announcement.test(part)) ||
      /\b(?:something (?:new|big|special)|big (?:news|announcement))\b/.test(text) && response.test(text) ||
      product.test(parent) && announcement.test(parent) && !past.test(parent) && response.test(text);
    if (!eventPost && !launchPost) return null;
    return { candidate: true, actionable: false, confidence: 'low', eventAt: null, qualifier: '',
      topic: eventPost ? 'event' : 'launch', rule: eventPost ? 'event-news' : 'launch-news',
      reason: eventPost ? '행사·DevDay 관련 소식 · 리셋 여부 미확인' : '신제품 출시·공개 단서 · 리셋 여부 미확인' };
  }

  function classify(item, options = {}) {
    const now = options.now ?? Date.now();
    const lower = normalizedText(item);
    const createdAt = root.RadarTime?.parseTimestamp?.(item?.createdAt ?? item?.created_at ?? item?.published_at);
    if (!lower || isNegated(lower) || includesAny(lower, EXCLUSIONS) || UNRELATED.test(lower) || BANKED_CREDIT.test(lower)) {
      return { actionable: false, confidence: "none", score: 0, eventAt: null, reason: "negated-or-unrelated" };
    }
    // A future word in an unrelated sentence must not turn a completed reset
    // into an upcoming one. Qualifiers/questions must not gain a guessed ETA.
    const futureClauses = clauses(lower).filter(part =>
      (includesAny(part, RESET_TERMS) || leadResetPromise(item, part) || leadResetAnnouncement(item, part) || DIRECT_PROMISE.test(part)) &&
      (includesAny(part, FUTURE_TERMS) || DIRECT_PROMISE.test(part))
      && !isCompleted(part) && !isNegated(part) && !SPECULATIVE.test(part)
    );
    const qualified = QUALIFIED_TIME.test(lower) || SPECULATIVE.test(lower);
    const futureText = qualified ? "" : futureClauses.join(". ");
    const promised = Boolean(futureText) && leadResetPromise(item, futureText);
    const shortAnnouncement = Boolean(futureText) && leadResetAnnouncement(item, futureText);
    const hasQuota = includesAny(lower, QUOTA_TERMS) || promised || shortAnnouncement || isLead(item) && DIRECT_PROMISE.test(futureText);
    const hasReset = includesAny(lower, RESET_TERMS) || promised || shortAnnouncement || DIRECT_PROMISE.test(futureText);
    const hasFuture = includesAny(lower, FUTURE_TERMS) || DIRECT_PROMISE.test(futureText);
    const completed = !futureText && (isCompleted(lower) || includesAny(lower, COMPLETE_TERMS));
    let score = 0;
    if (hasQuota) score += 3;
    if (hasReset) score += 3;
    if (hasFuture) score += 2;
    if (/we|we'll|we will|i will|planning|计划|我们/.test(lower)) score += 1;
    if (completed) score -= 3;
    if (item?.isReply) score -= 1;
    const untimedPromise = shortAnnouncement || Boolean(futureText) && DIRECT_PROMISE.test(futureText) && !includesAny(futureText, FUTURE_TERMS);
    const eventAt = futureText && !untimedPromise ? root.RadarTime?.parseTimestamp?.(item?.eventAtHint) || approximateEventTime(futureText, createdAt, now) : null;
    const future = Boolean(futureText) && (eventAt ? eventAt > now : hasFuture);
    const sourceWeight = Math.min(1, Math.max(0.1, Number(item?.source?.weight) || 1));
    const weightedScore = Number((score * sourceWeight).toFixed(2));
    const actionable = hasQuota && hasReset && !completed && future && score >= 7;
    const confidence = weightedScore >= 8 ? "high" : weightedScore >= 5 ? "medium" : "low";
    return {
      actionable,
      confidence,
      score,
      sourceWeight,
      weightedScore,
      eventAt,
      untimedPromise,
      reason: actionable ? "future-quota-reset-language" : qualified ? "qualified-or-speculative" : completed ? "historical-complete" : "insufficient-signal"
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
      ...(pollOptions(raw.pollOptions ?? raw.poll?.options ?? raw.poll?.choices ?? metadata.poll?.options).length ?
        { pollOptions: pollOptions(raw.pollOptions ?? raw.poll?.options ?? raw.poll?.choices ?? metadata.poll?.options) } : {}),
      author,
      avatarUrl: avatarUrl(metadata.profile_image_url_https || raw.avatarUrl),
      createdAt: raw.published_at || raw.created_at || null,
      url: raw.url || (author ? `https://x.com/${author}/status/${id}` : `https://x.com/i/web/status/${id}`),
      isReply: Boolean(metadata.is_reply ?? raw.isReply ?? raw.inReplyToId),
      inReplyToId: referenceId(metadata.in_reply_to_status_id_str ?? metadata.in_reply_to_status_id ?? raw.in_reply_to_status_id_str ?? raw.in_reply_to_status_id ?? raw.inReplyToId),
      quotedStatusId: referenceId(metadata.quoted_status_id_str ?? metadata.quoted_status_id ?? raw.quoted_status_id_str ?? raw.quoted_status_id ?? raw.quotedStatusId)
    };
  }

  function referenceId(value) {
    // Numeric X IDs may exceed JS integer precision; do not trust rounded IDs.
    if (typeof value === "number" && !Number.isSafeInteger(value)) return null;
    return /^(?:[1-9]\d{0,24})$/.test(String(value || "")) ? String(value) : null;
  }

  // These are deliberately weak, local hints. They never enter actionable(),
  // forecasts or account advice, and are not a general semantic classifier.
  function classifyHint(item, options = {}) {
    const none = { candidate: false, actionable: false, reason: "" };
    if (!isLead(item)) return none;
    const now = options.now ?? Date.now();
    const at = root.RadarTime?.parseTimestamp?.(item.createdAt);
    if (!at || at > now + 300000 || now - at > 7 * 24 * 3600000) return none;
    const text = normalizedText(item);
    if (UNRELATED.test(text) || BANKED_CREDIT.test(text)) return none;
    const rhetorical = text.replace(RHETORICAL, "rhetorical reset question");
    const hasRhetorical = rhetorical !== text;
    // The single narrow interrogative exception does not exempt other negation.
    if (isNegated(rhetorical)) return none;
    if (classify(item, options).actionable) return none;
    if (resetUpdate(item)) return none;
    const discussion = resetDiscussion(item);
    if (discussion) return { ...discussion, candidate: true, actionable: false,
      confidence: 'low', eventAt: null, qualifier: '' };
    if (!isCompleted(text) && !/\b(?:don't|do not|stop|never|not)\b/.test(text) &&
        clauses(text).some(part => /^(?:(?:please|let's|time to|go)\s+)?(?:burn(?: through)?|use(?: up)?|spend)\s+(?:(?:those|your|the|remaining|all|extra|spare)\s+){0,3}tokens?\b/.test(part))) {
      return { candidate: true, actionable: false, confidence: 'low', eventAt: null, qualifier: '',
        rule: 'token-burn', reason: '토큰 소진을 권하는 표현 · 한도 회복·리셋 여부 미확인' };
    }
    // Reset clues win even when the same post also mentions an event/product.
    const fallback = () => productEventHint(item, text) ||
      (eventContext(item) ? null : timedAnnouncement(item, text)) || none;
    const parts = clauses(text);
    const futureParts = parts.filter(part => prospective(part) && !isCompleted(part));
    if (!futureParts.length) return fallback();
    const futureText = futureParts.join(". ");
    const codexContext = /\bcodex\b/.test(futureText);
    const resetContext = /\b(?:codex|(?:usage|weekly|rate) limits?|quota|allowance|reset)\b/.test(text);
    // Context may be in another sentence of this post, but completion of that
    // context cannot be borrowed by an unrelated future product announcement.
    const completedContext = parts.some(part => isCompleted(part));
    const qualifier = timeQualifier(text);
    let rule = "";
    let reason = "";
    const context = item.replyContext;
    const conversationContext = context?.relation === "conversation-before" && context.targetId === item.id;
    const linkedContext = (context?.relation === "adjacent-unverified" || conversationContext) && referenceId(context.id) &&
      /^https:\/\/x\.com\/[a-zA-Z0-9_]{1,15}\/status\/[1-9]\d{0,24}$/.test(context.url || "") &&
      context.url.endsWith("/" + context.id) && /\b(?:banked resets?|reset credits?|codex.{0,60}(?:reset|limits?|quota)|(?:reset|limits?|quota).{0,60}codex|(?:usage|weekly|rate) limits?.{0,40}reset)\b/i.test(context.text || "");
    if (linkedContext && !completedContext && !/\b(?:launch|release|product|dev ?day|shipping)\b/.test(text) &&
        (conversationContext || /\b(?:ok(?:ay)?(?: fine)?|sure|agreed|yes)\b/.test(text)) &&
        /\b(?:coming|will|going to|soon|tomorrow|next week|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/.test(futureText)) {
      rule = "reply-reset-context";
      reason = conversationContext
        ? "리셋·리셋권 대화의 일정 답글 · 대화 원문 확인, 리셋 실행·일정 대상 미확정"
        : "리셋·리셋권 요청 주변의 동의·일정 답글 · 문맥 연결과 일정 대상 미확인";
    } else if (hasRhetorical && !completedContext) {
      rule = "rhetorical";
      reason = "리셋 가능성을 되묻는 반문 · 실행 약속은 아님";
    } else if (QUALIFIED_TIME.test(futureText) && resetContext && /\b(?:celebration|celebrate)\b/.test(futureText)) {
      rule = "rescheduled-celebration";
      reason = "리셋 문맥의 축하 일정 변경 · 새 리셋 여부 미확인";
    } else if (qualifier && /\breset\b/.test(text) && !completedContext) {
      rule = "qualified-reset";
      reason = "리셋 언급에 시간 제약이 있어 시각을 추정하지 않음";
    } else if (/\breset button\b/.test(text) && !completedContext && /\b(?:dust(?:ing)?|find|look(?:ing)? for|press(?:ing)?|push(?:ing)?)\b/.test(futureText)) {
      rule = "reset-button";
      reason = "리셋 버튼을 찾거나 누르려는 간접 표현";
    } else if (codexContext && /\b(?:refuel|fresh fuel|fill (?:up )?(?:the |your )?tank|gas in (?:the |your )?tank|recharge (?:the |your )?batter)/.test(futureText)) {
      rule = "refuel";
      reason = "Codex와 연료·충전 비유가 함께 등장";
    } else if (codexContext && /\b(?:fresh start|clean slate|second wind|another round|back to full|full tank)\b/.test(futureText)
      && !/\b(?:news|funding|investment|launch|release|product)\b/.test(futureText)) {
      rule = "fresh-start";
      reason = "Codex와 새 출발·다시 채움 비유가 함께 등장";
    } else if (!completedContext && /\bmilestone\b/.test(futureText) && /\bcelebrat(?:e|ing|ion)\b/.test(futureText)
      && (/\b(?:new milestone|users?|dashboard|growth|codex)\b/.test(futureText))) {
      rule = "milestone-celebration";
      reason = "알려진 이정표·축하 표현과 유사 · 리셋 대상 언급은 별도 확인";
    } else if (!completedContext && resetContext && /\b(?:surprise|gift|present|treat)\b/.test(futureText)) {
      rule = "contextual-surprise";
      reason = "Codex·한도 문맥의 선물·놀라움 예고 · 내용 미확인";
    } else if (!completedContext && /\breset\b/.test(futureText)
      && /\b(?:codex|(?:usage|weekly|rate) limits?|quota|allowance)\b/.test(futureText) && SPECULATIVE.test(text)) {
      rule = "tentative-reset";
      reason = "리셋 가능성을 제안·질문하는 표현 · 실행 약속은 아님";
    }
    return reason ? {
      candidate: true, actionable: false, confidence: "low", eventAt: null, rule,
      qualifier, reason: qualifier ? `${reason} (${qualifier})` : reason
    } : fallback();
  }

  function hintCandidates(items, options = {}) {
    const unique = new Map();
    for (const item of items) {
      if (item?.id) unique.delete(item.id);
      const assessment = classifyHint(item, options);
      if (item?.id && assessment.candidate) unique.set(item.id, {
        id: String(item.id), text: String(item.text).slice(0, 6000), author: item.author, avatarUrl: avatarUrl(item.avatarUrl),
        createdAt: item.createdAt, source: item.source, url: item.url, assessment,
        ...(pollOptions(item.pollOptions).length ? { pollOptions: pollOptions(item.pollOptions) } : {}),
        ...(item.replyContext ? { replyContext: item.replyContext } : {})
      });
    }
    const limit = Number.isInteger(options.limit) ? Math.min(100, Math.max(1, options.limit)) : 3;
    return [...unique.values()].sort((a, b) => root.RadarTime.parseTimestamp(b.createdAt) - root.RadarTime.parseTimestamp(a.createdAt)).slice(0, limit);
  }

  function extractItems(payload) {
    const rawItems = payload?.items || payload?.data?.items || payload?.result?.items || [];
    return Array.isArray(rawItems) ? rawItems.map(normalizeItem).filter(Boolean) : [];
  }

  function resetKind(item) {
    const text = String(item?.text || '').toLowerCase();
    const parts = clauses(text.replace(/[^.!?;\n]*\?/g, '')).filter(part => !isNegated(part) && !UNRELATED.test(part));
    const banked = parts.some(part => /\b(?:banked resets?|reset credits?|stored reset credits?)\b/.test(part) && !/\b(?:not|no|never|without)\b/.test(part));
    const ordinary = parts.some(part => !/\b(?:banked|credits?|not|no|never|without)\b/.test(part) &&
      /\breset(?:s|ting)?\b/.test(part) && /\b(?:limits?|quota|usage|automatically|automatic)\b/.test(part));
    return banked && ordinary ? 'both' : banked ? 'banked' : ordinary ? 'ordinary' : 'unknown';
  }

  function reports(items, options = {}) {
    const now = options.now ?? Date.now();
    const unique = new Map();
    for (const item of items || []) {
      if (!item?.id) continue;
      unique.delete(item.id);
      const at = root.RadarTime.parseTimestamp(item.createdAt);
      if (!isLead(item) ||
          !at || at > now + 300000 || now - at > 7 * 86400000) continue;
      const text = normalizedText(item);
      if (classify(item, options).actionable) continue;
      const update = resetUpdate(item);
      // "Reset should be reflected for everyone" reports propagation, unlike
      // the suggestion "we should reset". Keep this exception narrowly scoped.
      const reflected = part => /^resets? should (?:now )?be reflected for everyone\b/.test(part);
      const relevant = clauses(text.replace(/[^.!?;\n]*\?/g, '')).filter(part => !isNegated(part) && (!SPECULATIVE.test(part) || reflected(part)) && !UNRELATED.test(part) &&
        !/\b(?:not|never|didn't|don't|cannot|can't|won't|last year|last month|ago)\b/.test(part));
      const grant = relevant.some(part => /\b(?:banked resets?|reset credits?)\b/.test(part) &&
        /\b(?:load(?:ing|ed)?|giv(?:e|en|ing)|gave|grant(?:ed|ing)?|add(?:ed|ing)?|issu(?:ed|ing)|deposited|receiv(?:e|ed|ing))\b/.test(part));
      const completed = relevant.some(part => !BANKED_CREDIT.test(part) && !/\bbanked resets?\b/.test(part) &&
        !includesAny(part, EXCLUSIONS) && (!prospective(part) || reflected(part)) && /\bresets?\b/.test(part) &&
        ((/\b(?:codex|chatgpt|limits?|quotas?|allowance|usage|tokens?)\b/.test(part) &&
          (isCompleted(part) || /\b(?:was|were|we've|i've) (?:just |now )?reset\b/.test(part))) ||
          /^(?:all )?resets? (?:have (?:now )?)?(?:(?:all )?propagated|done|complete|completed)\b/.test(part) || reflected(part)));
      if (!grant && !completed && !update) continue;
      unique.set(item.id, { id: String(item.id), text: String(item.text).slice(0, 6000), author: item.author, avatarUrl: avatarUrl(item.avatarUrl),
        createdAt: item.createdAt, source: item.source, url: item.url,
        ...(update && item.replyContext ? { replyContext: item.replyContext } : {}),
        assessment: { report: grant ? 'credit-grant' : completed ? 'completed-reset' : 'reset-update', actionable: false, confidence: 'high', eventAt: null,
          ...(update && !grant && !completed ? { updateStatus: update } : {}),
          reason: grant ? '리셋권 지급 안내 · 자동 한도 리셋과 구분' : completed ? '작성자가 리셋 완료를 알림 · 내 계정 반영은 잔여량 조회로 확인' :
            update === 'resolved' ? '리셋 반영 문제 수정 안내 · 추가 리셋 지급·내 계정 반영은 별도 확인' : '리셋 반영 문제 조사·보완 안내 · 추가 리셋 여부·시각 미확정' } });
    }
    return [...unique.values()].sort((a, b) => root.RadarTime.parseTimestamp(b.createdAt) - root.RadarTime.parseTimestamp(a.createdAt)).slice(0, 30);
  }

  function resetUpdate(item) {
    // Negative reports about a missed reset are useful follow-ups, not a
    // promise of another reset. Keep them outside predictions and counters.
    const text = normalizedText(item);
    if (!isLead(item) || UNRELATED.test(text) || includesAny(text, EXCLUSIONS) ||
        /\?|\b(?:if|maybe|might|could|rumou?rs?|last year|last month|years? ago)\b/.test(text)) return null;
    const parent = item.replyContext;
    const parentAt = root.RadarTime.parseTimestamp(parent?.createdAt);
    const itemAt = root.RadarTime.parseTimestamp(item.createdAt);
    const linked = ['quoted-post', 'conversation-before'].includes(parent?.relation) && parent.targetId === item.id &&
      /^@?(?:thsottiaux|reach_vb|openai)$/i.test(parent.author || '') && referenceId(parent.id) &&
      parent.url === `https://x.com/${String(parent.author).replace(/^@/, '')}/status/${parent.id}` &&
      Number.isFinite(parentAt) && Number.isFinite(itemAt) && parentAt <= itemAt && itemAt - parentAt <= 14 * 86400000;
    const context = linked ? normalizedText(parent) : '';
    const relevant = value => /\bresets?\b/.test(value) &&
      /\b(?:codex|chatgpt|limits?|quota|usage|allowance|pro|paid|users?|accounts?)\b/.test(value) &&
      !UNRELATED.test(value) && !includesAny(value, EXCLUSIONS);
    if (!relevant(text) && !relevant(context)) return null;
    const failed = /\b(?:didn't|did not|hasn't|haven't|not|failed|missing|missed|issues?|problems?|delayed)\b.{0,65}\bresets?\b|\bresets?\b.{0,65}\b(?:not|missing|missed|failed|issues?|problems?|delayed|didn't|did not|hasn't|haven't)\b/;
    const resolved = /\b(?:all fixed|(?:we(?:'ve| have)? |now )?(?:fixed|resolved|patched) (?:the |this |that |it|reset)|made (?:up for|it right))\b/.test(text) &&
      !/\b(?:not|never|haven't|hasn't|didn't|did not|can't|cannot|won't)\b.{0,30}\b(?:fixed|resolved|patched|made)\b/.test(text);
    if (resolved && (failed.test(text) || linked && failed.test(context))) return 'resolved';
    if (failed.test(text) && /\b(?:investigating|looking into|working (?:on|to)|will make (?:up for|it right)|we(?:'ll| will) (?:fix|resolve))\b/.test(text) &&
        !/\b(?:not|never|won't|will not|can't|cannot)\b.{0,25}\b(?:investigating|looking|working|make|fix|resolve)\b/.test(text)) return 'investigating';
    return null;
  }

  function strongest(items, options = {}) {
    return items
      .map((item) => ({ ...item, assessment: classify(item, options) }))
      .filter((item) => item.assessment.actionable)
      .sort((a, b) => b.assessment.weightedScore - a.assessment.weightedScore || (b.assessment.eventAt || 0) - (a.assessment.eventAt || 0))[0] || null;
  }

  function actionable(items, options = {}) {
    return items
      .map((item) => item?.assessment ? item : ({ ...item, assessment: classify(item, options) }))
      .filter((item) => item.assessment.actionable)
      .sort((a, b) => b.assessment.weightedScore - a.assessment.weightedScore || (b.assessment.eventAt || 0) - (a.assessment.eventAt || 0));
  }

  function isActive(signal, options = {}) {
    const now = options.now ?? Date.now();
    const graceMs = (options.graceHours ?? 12) * 60 * 60 * 1000;
    const namedDay = /\b(?:next week|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i.test(signal?.text || "");
    const fallbackMs = (options.fallbackHours ?? (namedDay || signal?.assessment?.untimedPromise ? 7 * 24 : 24)) * 60 * 60 * 1000;
    if (!signal?.assessment?.actionable) return false;
    // Readers (including a popup opened before the worker wakes) must not trust
    // an older rule's cached assessment. Evaluate intent at publication time to
    // preserve the existing post-event grace window for valid announcements.
    const publishedAt = root.RadarTime?.parseTimestamp?.(signal.createdAt);
    if (signal.text && !classify(signal, { now: Math.min(now, publishedAt || now) }).actionable) return false;
    const eventAt = root.RadarTime?.parseTimestamp?.(signal.assessment.eventAt);
    if (eventAt) return now <= eventAt + graceMs;
    const createdAt = root.RadarTime?.parseTimestamp?.(signal.createdAt);
    return Boolean(createdAt && now <= createdAt + fallbackMs);
  }

  function preferActive(incoming, existing, options = {}) {
    const candidates = [incoming, existing].filter((signal) => isActive(signal, options));
    return candidates.sort((a, b) => {
      const scoreDifference = (b.assessment?.weightedScore || b.assessment?.score || 0) -
        (a.assessment?.weightedScore || a.assessment?.score || 0);
      if (scoreDifference) return scoreDifference;
      const bCreated = root.RadarTime?.parseTimestamp?.(b.createdAt) || 0;
      const aCreated = root.RadarTime?.parseTimestamp?.(a.createdAt) || 0;
      return bCreated - aCreated;
    })[0] || null;
  }


  function mergeActive(incoming = [], existing = [], options = {}) {
    const byId = new Map();
    for (const signal of [...existing, ...incoming]) {
      if (signal?.id && isActive(signal, options)) byId.set(signal.entityId || signal.id, signal);
    }
    return [...byId.values()].sort((a, b) => {
      const bScore = b.assessment?.weightedScore || b.assessment?.score || 0;
      const aScore = a.assessment?.weightedScore || a.assessment?.score || 0;
      return bScore - aScore || (b.assessment?.eventAt || 0) - (a.assessment?.eventAt || 0);
    }).slice(0, 20);
  }

  root.RadarSignals = Object.freeze({
    isLead, authorName, avatarUrl, pollOptions, resetDiscussion, eventContext, hasEventTime,
    classify,
    classifyHint,
    hintCandidates,
    reports,
    resetKind,
    normalizeItem,
    extractItems,
    strongest,
    actionable,
    isActive,
    preferActive,
    mergeActive
  });
  if (typeof module !== "undefined") module.exports = root.RadarSignals;
})(globalThis);
