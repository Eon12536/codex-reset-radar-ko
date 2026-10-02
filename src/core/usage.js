(function initUsage(root) {
  const FIVE_HOURS = 18_000;
  const WEEK = 604_800;
  const MAX_CREDITS = 100;

  function number(value) {
    // API schema failures must stay unknown. JavaScript coerces booleans,
    // empty arrays and whitespace to zero, which can fabricate full quota
    // or erase the credit baseline before a false "new grant" alert.
    if (!["number", "string"].includes(typeof value) ||
        (typeof value === "string" && value.trim() === "")) return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function integer(value) {
    const parsed = number(value);
    return parsed !== null && Number.isInteger(parsed) ? parsed : null;
  }

  function percent(value) {
    const parsed = number(value);
    if (parsed === null) return null;
    return Math.round(Math.min(100, Math.max(0, parsed)));
  }

  function epochMs(value) {
    const parsed = number(value);
    if (parsed === null) return null;
    const seconds = parsed > 10_000_000_000 ? parsed / 1000 : parsed;
    if (seconds < 946684800 || seconds > 7258118400) return null;
    return Math.round(seconds * 1000);
  }

  function windowDuration(raw) {
    const minutes = number(raw?.window_duration_mins ?? raw?.windowDurationMins);
    return integer(raw?.limit_window_seconds ?? (minutes === null ? null : minutes * 60));
  }

  function windowKind(seconds) {
    return seconds === FIVE_HOURS ? "fiveHour" : seconds === WEEK ? "weekly" : "generic";
  }

  function normalizeWindow(raw, now = Date.now(), id = "primary") {
    if (!raw || typeof raw !== "object") return null;
    const rawUsed = raw.used_percent ?? raw.usedPercent;
    const usedPercent = percent(rawUsed);
    if (usedPercent === null) return null;
    const windowSeconds = windowDuration(raw);
    const afterSeconds = integer(raw.reset_after_seconds ?? raw.resetAfterSeconds);
    const explicitReset = epochMs(raw.reset_at ?? raw.resets_at ?? raw.resetsAt);
    const resetAt = explicitReset || (afterSeconds !== null && afterSeconds >= 0
      ? now + afterSeconds * 1000
      : null);
    const kind = windowKind(windowSeconds);
    return {
      id,
      kind,
      usedPercent,
      // Display rounding must never turn e.g. 0.4% used into a reset event.
      usedPercentExact: ["number", "string"].includes(typeof rawUsed) && String(rawUsed).trim() !== "" &&
        Number(rawUsed) >= 0 && Number(rawUsed) <= 100 ? Number(rawUsed) : null,
      remainingPercent: 100 - usedPercent,
      windowSeconds: windowSeconds && windowSeconds > 0 ? windowSeconds : null,
      resetAt,
      resetAfterSeconds: afterSeconds !== null && afterSeconds >= 0 ? afterSeconds : null,
      limitReached: Boolean(raw.limit_reached ?? raw.limitReached)
    };
  }

  function dedupeWindowKinds(windows) {
    const seen = new Set();
    return windows.map((window) => {
      if (window.kind === "generic" || !seen.has(window.kind)) {
        seen.add(window.kind);
        return window;
      }
      return { ...window, kind: "generic" };
    });
  }

  function normalizeUsage(data, options = {}) {
    const now = options.now ?? Date.now();
    const rateLimit = data?.rate_limit || data?.rateLimits || {};
    const rawWindows = [rateLimit.primary_window || rateLimit.primary, rateLimit.secondary_window || rateLimit.secondary];
    const candidates = rawWindows.map((raw, index) => normalizeWindow(raw, now, index ? "secondary" : "primary"));
    const windows = dedupeWindowKinds(candidates.filter(Boolean));
    // A malformed reported window is distinct from an absent window. Keep
    // only its kind so the recovery detector can invalidate that comparison
    // without presenting the malformed value as quota.
    const invalidWindowKinds = [...new Set(rawWindows.flatMap((raw, index) => {
      if (!raw || typeof raw !== "object" || candidates[index] ||
          !["used_percent", "usedPercent"].some(key => Object.hasOwn(raw, key))) return [];
      const kind = windowKind(windowDuration(raw));
      return kind === "generic" ? [] : [kind];
    }))];
    const embeddedCount = integer(
      data?.rate_limit_reset_credits?.available_count ??
      data?.rateLimitResetCredits?.availableCount
    );
    if (!windows.length && !Boolean(rateLimit.limit_reached ?? rateLimit.limitReached ?? rateLimit.allowed === false)) {
      return null;
    }
    return {
      windows,
      ...(invalidWindowKinds.length ? { invalidWindowKinds } : {}),
      plan: typeof data?.plan_type === "string" ? data.plan_type : data?.planType || null,
      allowed: rateLimit.allowed !== false,
      limitReached: Boolean(rateLimit.limit_reached ?? rateLimit.limitReached ?? rateLimit.allowed === false),
      embeddedResetCount: embeddedCount === null ? null : Math.min(MAX_CREDITS, Math.max(0, embeddedCount)),
      fetchedAt: now,
      source: options.source || "unknown"
    };
  }

  function normalizeCredit(raw, index) {
    if (!raw || typeof raw !== "object") return null;
    const status = String(raw.status || "available").toLowerCase();
    const expiresAt = root.RadarTime?.parseTimestamp?.(raw.expires_at ?? raw.expiresAt) || null;
    return {
      key: `credit-${index}-${expiresAt || "unknown"}`,
      status,
      available: status === "available",
      expiresAt,
      title: typeof raw.title === "string" ? raw.title : null,
      resetType: raw.reset_type ?? raw.resetType ?? null
    };
  }

  function normalizeCredits(data) {
    if (!data || typeof data !== "object" || Array.isArray(data)) return null;
    const countValue = data.available_count ?? data.availableCount;
    const rawCount = integer(countValue);
    if ((countValue !== undefined && (rawCount === null || rawCount < 0 || rawCount > MAX_CREDITS)) ||
        (rawCount === null && !Array.isArray(data.credits))) return null;
    if (Array.isArray(data.credits) && data.credits.some(row => !row || typeof row !== "object" || Array.isArray(row))) return null;
    const credits = Array.isArray(data.credits)
      ? data.credits.map(normalizeCredit).filter(Boolean)
      : [];
    const derivedCount = credits.filter((credit) => credit.available).length;
    const availableCount = rawCount === null
      ? derivedCount
      : Math.min(MAX_CREDITS, Math.max(0, rawCount));
    return {
      availableCount,
      credits: credits.filter((credit) => credit.available).sort((a, b) => {
        if (!a.expiresAt) return 1;
        if (!b.expiresAt) return -1;
        return a.expiresAt - b.expiresAt;
      }),
      fetchedAt: Date.now()
    };
  }

  function findWindow(usage, kind) {
    return usage?.windows?.find((window) => window.kind === kind) || null;
  }

  function nearestExpiry(credits, now = Date.now()) {
    return credits?.credits?.find((credit) => credit.expiresAt && credit.expiresAt > now)?.expiresAt || null;
  }

  root.RadarUsage = Object.freeze({
    FIVE_HOURS,
    WEEK,
    normalizeWindow,
    normalizeUsage,
    normalizeCredits,
    findWindow,
    nearestExpiry
  });
  if (typeof module !== "undefined") module.exports = root.RadarUsage;
})(globalThis);
