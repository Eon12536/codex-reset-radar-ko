(function initAdvice(root) {
  // The decision order and thresholds are a JavaScript port of the MIT-licensed
  // UsageNudge model from jordan-edai/codex-reset-watcher, adapted for a
  // browser extension and combined with public reset-signal awareness.
  function result(tier, title, message, detail) {
    return { tier, title, message, detail };
  }

  function translated(key, substitutions, fallback) {
    const localized = root.RadarI18n?.t?.(key, substitutions, "");
    if (localized) return localized;
    const values = Array.isArray(substitutions) ? substitutions : substitutions === undefined ? [] : [substitutions];
    return String(fallback).replace(/\$(\d+)/g, (_match, index) => String(values[Number(index) - 1] ?? ""));
  }

  function secondsUntil(timestamp, now) {
    return timestamp ? Math.max(0, Math.round((timestamp - now) / 1000)) : null;
  }

  function make({ usage, credits, signal, now = Date.now() }) {
    const resetCount = credits?.availableCount ?? usage?.embeddedResetCount ?? null;
    const fiveHour = root.RadarUsage?.findWindow?.(usage, "fiveHour");
    const weekly = root.RadarUsage?.findWindow?.(usage, "weekly");
    const nearestExpiry = root.RadarUsage?.nearestExpiry?.(credits, now);
    const expirySeconds = secondsUntil(nearestExpiry, now);
    const blocked = Boolean(usage?.limitReached || usage?.allowed === false || usage?.windows?.some((window) => window.limitReached));

    if (blocked) {
      if (resetCount > 0) {
        return result(
          "blocked",
          translated("adviceBlockedWithCreditsTitle", undefined, "Quota limit reached"),
          translated("adviceBlockedWithCreditsMessage", undefined, "If important work must continue, you can use one reset credit in Codex."),
          translated("resetCreditsAvailableCount", String(resetCount), "$1 reset credits available")
        );
      }
      return result(
        "blocked",
        translated("adviceWaitForQuotaTitle", undefined, "Wait for quota recovery"),
        translated("adviceWaitForQuotaMessage", undefined, "The quota limit is reached and no reset credits are available. Wait for the nearest quota window to recover."),
        translated("noResetCredits", undefined, "No reset credits available")
      );
    }

    if (expirySeconds !== null && expirySeconds <= 24 * 3600 && resetCount > 0) {
      if ((weekly?.remainingPercent ?? 100) <= 20) {
        return result(
          "expiring",
          translated("adviceConsiderExpiringTitle", undefined, "Consider using the expiring reset credit"),
          translated("adviceConsiderExpiringMessage", undefined, "The credit expires within 24 hours and weekly quota is low. Consider using it if you still have a long task today."),
          root.RadarTime.relativeDuration(nearestExpiry, now)
        );
      }
      return result(
        "expiring",
        translated("adviceCreditExpiringTitle", undefined, "Reset credit expiring soon"),
        translated("adviceCreditExpiringMessage", undefined, "It expires within 24 hours. Use it only when real work requires extra capacity."),
        root.RadarTime.relativeDuration(nearestExpiry, now)
      );
    }

    if (signal?.assessment?.actionable && signal.assessment.confidence === "high") {
      return result(
        "signal",
        translated("adviceHoldForSignalTitle", undefined, "Use remaining quota first; hold reset credits"),
        translated("adviceHoldForSignalMessage", undefined, "A high-confidence future public reset signal was detected. Keep reset credits unless you are already blocked."),
        signal.assessment.eventAt ? root.RadarTime.relativeDuration(signal.assessment.eventAt, now) : translated("timeWindowPending", undefined, "Time window pending")
      );
    }

    if (!usage) {
      return result(
        "guest",
        translated("adviceGuestTitle", undefined, "Public signal radar is running"),
        translated("adviceGuestMessage", undefined, "Monitor public reset signals and time forecasts without signing in. ChatGPT sign-in only adds personal quota and reset-credit advice."),
        translated("basicMode", undefined, "Basic mode")
      );
    }

    if (!weekly) {
      return result("unavailable", translated("adviceWeeklyPendingTitle", undefined, "Waiting for weekly quota data"), translated("adviceWeeklyPendingMessage", undefined, "Weekly quota cannot be identified reliably, so the extension will not guess whether to use a reset credit."), translated("retryAfterRefresh", undefined, "Retry after refresh"));
    }

    if (resetCount === null) {
      return result("unavailable", translated("adviceCreditsUnavailableTitle", undefined, "Reset-credit data unavailable"), translated("adviceCreditsUnavailableMessage", undefined, "Quota was read, but the number of reset credits could not be confirmed. Check Codex before deciding."), translated("weeklyRemaining", String(weekly.remainingPercent), "$1% weekly quota remaining"));
    }

    if (resetCount === 0) {
      if (fiveHour && fiveHour.remainingPercent <= 12) {
        return result("wait", translated("adviceWaitFiveHourTitle", undefined, "Wait for the 5-hour quota to recover"), translated("adviceNoCreditsWaitMessage", undefined, "No reset credits are available. Pace the task and wait for the short-term window to recover."), fiveHour.resetAt ? root.RadarTime.relativeDuration(fiveHour.resetAt, now) : translated("resetTimeUnknown", undefined, "Reset time unknown"));
      }
      return result("noCredits", translated("noResetCredits", undefined, "No reset credits available"), translated("adviceNoCreditsMessage", undefined, "Current capacity is usable, but there is no extra buffer if quota is reached."), translated("weeklyRemaining", String(weekly.remainingPercent), "$1% weekly quota remaining"));
    }

    const fiveHourSeconds = secondsUntil(fiveHour?.resetAt, now);
    if (fiveHour && fiveHour.remainingPercent <= 12 && weekly.remainingPercent >= 25) {
      if (fiveHourSeconds !== null && fiveHourSeconds <= 90 * 60) {
        return result("wait", translated("adviceWaitFiveHourTitle", undefined, "Wait for the 5-hour quota to recover"), translated("adviceShortWindowSoonMessage", undefined, "The short-term window recovers soon and weekly quota remains available. Keep the reset credit."), root.RadarTime.relativeDuration(fiveHour.resetAt, now));
      }
      return result("deadline", translated("adviceUrgentOnlyTitle", undefined, "Use a reset credit only for urgent work"), translated("adviceUrgentOnlyMessage", undefined, "Short-term quota is low. Without a real deadline, waiting for the 5-hour window is better."), fiveHour?.resetAt ? root.RadarTime.relativeDuration(fiveHour.resetAt, now) : translated("resetTimeUnknown", undefined, "Reset time unknown"));
    }

    const weeklySeconds = secondsUntil(weekly.resetAt, now);
    if (weeklySeconds === null) {
      return result("steady", translated("adviceContinueAndHoldTitle", undefined, "Continue working and keep reset credits"), translated("adviceUnknownWeeklyResetMessage", undefined, "Weekly recovery time is unknown. Consider a reset credit only after quota is actually reached."), translated("weeklyRemaining", String(weekly.remainingPercent), "$1% weekly quota remaining"));
    }
    const weeklyDays = weeklySeconds / 86400;
    if (resetCount >= 2 && weekly.remainingPercent <= 15 && weeklyDays >= 4) {
      return result("spend", translated("adviceContinueTaskTitle", undefined, "Continue the task"), translated("adviceContinueTaskMessage", undefined, "Weekly quota is low, recovery is far away, and several reset credits are available. Use remaining quota first, then consider a credit if blocked."), translated("weeklyRemaining", String(weekly.remainingPercent), "$1% weekly quota remaining"));
    }
    if (weekly.remainingPercent <= 20 && weeklyDays >= 2) {
      return result("useIfBlocked", translated("adviceUseIfBlockedTitle", undefined, "Use a reset credit only if blocked"), translated("adviceUseIfBlockedMessage", undefined, "A reset credit is reasonable if important work is blocked. Otherwise keep it."), root.RadarTime.relativeDuration(weekly.resetAt, now));
    }
    if ((weekly.remainingPercent >= 35 && weeklyDays <= 3) || (weekly.remainingPercent >= 25 && weeklyDays <= 2)) {
      return result("hold", translated("adviceHoldCreditsTitle", undefined, "Keep reset credits"), translated("adviceHoldCreditsMessage", undefined, "Weekly quota is healthy and recovery is near, so there is no need to use a reset credit now."), translated("weeklyRemaining", String(weekly.remainingPercent), "$1% weekly quota remaining"));
    }
    return result("steady", translated("adviceContinueTitle", undefined, "Continue working"), translated("adviceContinueMessage", undefined, "Capacity is available. Refresh once more before starting a large task."), translated("weeklyRemaining", String(weekly.remainingPercent), "$1% weekly quota remaining"));
  }

  root.RadarAdvice = Object.freeze({ make });
  if (typeof module !== "undefined") module.exports = root.RadarAdvice;
})(globalThis);
