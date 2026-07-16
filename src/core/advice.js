(function initAdvice(root) {
  // The decision order and thresholds are a JavaScript port of the MIT-licensed
  // UsageNudge model from jordan-edai/codex-reset-watcher, adapted for a
  // browser extension and combined with official-reset signal awareness.
  function result(tier, title, message, detail) {
    return { tier, title, message, detail };
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
        return result("blocked", "当前已受限", "如果仍需继续重要任务，可以在 Codex 中使用一张重置券。", `${resetCount} 张重置券可用`);
      }
      return result("blocked", "等待额度恢复", "当前已受限且没有可用重置券，请等待最近的额度窗口恢复。", "没有可用重置券");
    }

    if (expirySeconds !== null && expirySeconds <= 24 * 3600 && resetCount > 0) {
      if ((weekly?.remainingPercent ?? 100) <= 20) {
        return result("expiring", "考虑使用即将过期的重置券", "重置券将在 24 小时内过期，而且每周额度偏低；若今天仍有长任务，可以考虑使用。", root.RadarTime.relativeDuration(nearestExpiry, now));
      }
      return result("expiring", "重置券即将过期", "它将在 24 小时内失效。仅在确有工作需要额外容量时使用。", root.RadarTime.relativeDuration(nearestExpiry, now));
    }

    if (signal?.assessment?.actionable && signal.assessment.confidence === "high") {
      return result("signal", "优先使用剩余额度，暂缓使用重置券", "检测到高可信的未来官方重置信号。除非已经被限制，否则先保留重置券。", signal.assessment.eventAt ? root.RadarTime.relativeDuration(signal.assessment.eventAt, now) : "时间窗口待确认");
    }

    if (!weekly) {
      return result("unavailable", "等待每周额度数据", "当前无法可靠识别每周额度，因此不会猜测是否应该使用重置券。", "刷新后重试");
    }

    if (resetCount === null) {
      return result("unavailable", "重置券数据不可用", "额度已读取，但无法确认重置券数量。请在决定前打开 Codex 检查。", `${weekly.remainingPercent}% 每周额度剩余`);
    }

    if (resetCount === 0) {
      if (fiveHour && fiveHour.remainingPercent <= 12) {
        return result("wait", "等待 5 小时额度恢复", "当前没有可用重置券，请控制任务节奏并等待短期窗口恢复。", fiveHour.resetAt ? root.RadarTime.relativeDuration(fiveHour.resetAt, now) : "恢复时间未知");
      }
      return result("noCredits", "没有可用重置券", "当前容量尚可，但被限制时没有额外缓冲。", `${weekly.remainingPercent}% 每周额度剩余`);
    }

    const fiveHourSeconds = secondsUntil(fiveHour?.resetAt, now);
    if (fiveHour && fiveHour.remainingPercent <= 12 && weekly.remainingPercent >= 25) {
      if (fiveHourSeconds !== null && fiveHourSeconds <= 90 * 60) {
        return result("wait", "等待 5 小时额度恢复", "短期窗口很快恢复且每周额度仍可用，保留重置券。", root.RadarTime.relativeDuration(fiveHour.resetAt, now));
      }
      return result("deadline", "仅在紧急任务时使用重置券", "短期额度偏低；若没有真实截止时间，等待 5 小时窗口恢复更合适。", fiveHour?.resetAt ? root.RadarTime.relativeDuration(fiveHour.resetAt, now) : "恢复时间未知");
    }

    const weeklySeconds = secondsUntil(weekly.resetAt, now);
    if (weeklySeconds === null) {
      return result("steady", "继续使用并保留重置券", "每周恢复时间未知，只在实际被限制时考虑使用重置券。", `${weekly.remainingPercent}% 每周额度剩余`);
    }
    const weeklyDays = weeklySeconds / 86400;
    if (resetCount >= 2 && weekly.remainingPercent <= 15 && weeklyDays >= 4) {
      return result("spend", "可以继续推进任务", "每周额度较低、恢复仍远且有多张重置券；先用完剩余额度，被限制后再考虑使用。", `${weekly.remainingPercent}% 每周额度剩余`);
    }
    if (weekly.remainingPercent <= 20 && weeklyDays >= 2) {
      return result("useIfBlocked", "只在被限制时使用重置券", "如果重要工作被阻断，使用重置券是合理的；否则继续保留。", root.RadarTime.relativeDuration(weekly.resetAt, now));
    }
    if ((weekly.remainingPercent >= 35 && weeklyDays <= 3) || (weekly.remainingPercent >= 25 && weeklyDays <= 2)) {
      return result("hold", "保留重置券", "每周额度尚可且恢复时间较近，目前无需消耗重置券。", `${weekly.remainingPercent}% 每周额度剩余`);
    }
    return result("steady", "继续使用", "当前容量可用，开始大型任务前再刷新一次状态。", `${weekly.remainingPercent}% 每周额度剩余`);
  }

  root.RadarAdvice = Object.freeze({ make });
  if (typeof module !== "undefined") module.exports = root.RadarAdvice;
})(globalThis);
