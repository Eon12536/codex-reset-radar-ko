const $ = (id) => document.getElementById(id);

function meterColor(remaining) {
  if (remaining < 25) return "var(--danger)";
  if (remaining < 60) return "var(--amber)";
  return "var(--teal)";
}

function accountPlaceholder(settings, accountState) {
  if (!settings.monitorAccount) return "账户功能已关闭";
  if (accountState?.status === "signedOut") return "可选：登录后显示";
  if (accountState?.status === "error") return "个人数据暂时不可用";
  return "可选：登录后显示";
}

function renderWindow(kind, usage, settings, accountState) {
  const windowData = RadarUsage.findWindow(usage, kind);
  const prefix = kind === "fiveHour" ? "fiveHour" : "weekly";
  const bar = $(`${prefix}Bar`);
  const meta = $(`${prefix}Meta`);
  if (!windowData) {
    bar.style.width = "0";
    meta.textContent = accountPlaceholder(settings, accountState);
    return;
  }
  const timeZone = RadarTime.resolveTimeZone(settings);
  bar.style.width = `${windowData.remainingPercent}%`;
  bar.style.background = meterColor(windowData.remainingPercent);
  const resetText = windowData.resetAt
    ? `${RadarTime.relativeDuration(windowData.resetAt)}恢复 · ${RadarTime.formatDateTime(windowData.resetAt, timeZone)}`
    : "恢复时间未知";
  meta.textContent = `${windowData.remainingPercent}% 剩余 · ${resetText}`;
}

function renderSignal(signalSnapshot, settings) {
  const signal = RadarSignals.isActive(signalSnapshot?.signal) ? signalSnapshot.signal : null;
  if (!signal) {
    $("signalHeadline").textContent = signalSnapshot?.checkedAt ? "暂无可执行信号" : "正在扫描公开动态";
    $("confidenceBadge").textContent = signalSnapshot?.checkedAt ? "监控中" : "等待数据";
    $("confidenceBadge").className = "confidence neutral";
    $("signalMeta").textContent = signalSnapshot?.checkedAt
      ? `最近检查 ${RadarTime.formatTime(signalSnapshot.checkedAt, RadarTime.resolveTimeZone(settings))}`
      : "首次检查可能需要几秒钟";
    $("viewEvidence").disabled = true;
    return;
  }
  const timeZone = RadarTime.resolveTimeZone(settings);
  const compactEventTime = signal.assessment.eventAt ? new Intl.DateTimeFormat(
    globalThis.navigator?.language || "zh-CN",
    { timeZone, month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }
  ).format(new Date(signal.assessment.eventAt)) : null;
  const communityPrediction = signal.prediction?.kind === "milestone";
  $("signalHeadline").textContent = signal.assessment.eventAt
    ? `${communityPrediction ? "社区经验预计" : "可能"} ${compactEventTime}${communityPrediction ? " 前后" : ""}重置`
    : "公开信号显示可能即将重置";
  $("confidenceBadge").textContent = {
    high: "高可信",
    medium: "中可信",
    low: "低可信"
  }[signal.assessment.confidence] || "待评估";
  $("confidenceBadge").className = "confidence";
  const age = signal.createdAt ? RadarTime.relativeDuration(Date.now() + Math.max(0, Date.now() - RadarTime.parseTimestamp(signal.createdAt))) : "刚刚";
  const sourceLabel = signal.source?.label || signal.author || "公开动态";
  $("signalMeta").textContent = `${communityPrediction ? "经验模型" : "来自"} ${sourceLabel} · ${age.replace("后", "前")}`;
  $("viewEvidence").disabled = false;
}

function forecastDate(value, timeZone) {
  return new Intl.DateTimeFormat(globalThis.navigator?.language || "zh-CN", {
    timeZone,
    month: "numeric",
    day: "numeric",
    weekday: "short"
  }).format(new Date(value));
}

function renderForecast(signals, settings) {
  const timeZone = RadarTime.resolveTimeZone(settings);
  const forecast = RadarForecast.build({ signals, timeZone });
  const highlighted = [...forecast.slots]
    .sort((a, b) => b.probability - a.probability || a.startAt - b.startAt)
    .slice(0, 3)
    .sort((a, b) => a.startAt - b.startAt);
  $("forecastSummary").textContent = forecast.basis === "community-experience"
    ? `未来 72 小时约 ${forecast.totalProbability}% · 社区经验预测`
    : forecast.basis === "public-signal"
      ? `未来 72 小时约 ${forecast.totalProbability}% · ${forecast.sourceCount} 源加权`
      : `未来 72 小时约 ${forecast.totalProbability}% · 暂无有效信号`;
  $("forecastSummary").title = "启发式概率，不代表 OpenAI 的计划或承诺";
  $("forecastSlots").replaceChildren(...highlighted.map((slot) => {
    const item = document.createElement("div");
    item.className = "forecast-slot";
    const label = document.createElement("span");
    const start = RadarTime.formatTime(slot.startAt, timeZone);
    const end = RadarTime.formatTime(slot.endAt, timeZone);
    label.textContent = `${forecastDate(slot.startAt, timeZone)} · ${start}–${end}`;
    const probability = document.createElement("strong");
    probability.textContent = `≈${slot.probability}%`;
    item.append(label, probability);
    return item;
  }));
}

function renderCredits(credits, settings, accountState) {
  if (!credits) {
    $("creditsCount").textContent = "--";
    $("creditsExpiry").textContent = accountPlaceholder(settings, accountState);
    return;
  }
  $("creditsCount").textContent = String(credits.availableCount);
  const nearest = RadarUsage.nearestExpiry(credits);
  if (!nearest) {
    $("creditsExpiry").textContent = credits.availableCount ? "部分重置券未提供过期时间" : "当前没有可用重置券";
    return;
  }
  const timeZone = RadarTime.resolveTimeZone(settings);
  $("creditsExpiry").textContent = `最近一张 ${RadarTime.relativeDuration(nearest)}过期 · ${RadarTime.formatDateTime(nearest, timeZone)}`;
}

function renderAdvice(advice) {
  const value = advice || {
    tier: "guest",
    title: "公开信号雷达运行中",
    message: "无需登录即可监控公开重置信号；登录后会补充个人额度与重置券建议。",
    detail: "基础模式"
  };
  $("advicePanel").dataset.tier = value.tier;
  $("adviceTitle").textContent = value.tier === "guest" ? value.title : `建议：${value.title}`;
  $("adviceMessage").textContent = value.message;
  $("adviceDetail").textContent = value.detail;
}

async function render() {
  const data = await chrome.storage.local.get([
    "settings",
    "accountSnapshot",
    "signalSnapshot",
    "adviceSnapshot",
    "lastCheckedAt",
    "accountState",
    "accountError",
    "signalError"
  ]);
  const settings = RadarSettings.sanitize(data.settings);
  renderSignal(data.signalSnapshot, settings);
  renderForecast(data.signalSnapshot?.activeSignals || [data.signalSnapshot?.signal].filter(Boolean), settings);
  renderWindow("fiveHour", data.accountSnapshot?.usage, settings, data.accountState);
  renderWindow("weekly", data.accountSnapshot?.usage, settings, data.accountState);
  renderCredits(data.accountSnapshot?.credits, settings, data.accountState);
  renderAdvice(data.adviceSnapshot);
  const radarHasError = Boolean(data.signalError);
  $("healthDot").className = `health-dot ${radarHasError ? "warn" : data.lastCheckedAt ? "ok" : ""}`;
  $("healthDot").title = radarHasError
    ? "公开信号暂时不可用"
    : data.accountState?.status === "signedOut"
      ? "基础模式：公开信号监控正常"
      : "监控正常";
  $("notificationState").textContent = settings.notifyOfficialReset || settings.notifyCreditExpiry || settings.notifyAdvice
    ? "通知已开启"
    : "通知已关闭";
  $("notificationState").style.color = settings.notifyOfficialReset || settings.notifyCreditExpiry || settings.notifyAdvice
    ? "#7bcf74"
    : "var(--muted)";
  $("lastChecked").textContent = data.lastCheckedAt
    ? `检查 ${RadarTime.formatTime(data.lastCheckedAt, RadarTime.resolveTimeZone(settings))}`
    : "尚未检查";
}

$("openSettings").addEventListener("click", () => chrome.runtime.openOptionsPage());
$("viewEvidence").addEventListener("click", () => chrome.runtime.sendMessage({ type: "OPEN_EVIDENCE" }));
$("refreshButton").addEventListener("click", async () => {
  const button = $("refreshButton");
  button.classList.add("busy");
  button.disabled = true;
  try {
    const tabs = await chrome.tabs.query({ url: "https://chatgpt.com/*" });
    if (tabs[0]?.id) {
      await chrome.tabs.sendMessage(tabs[0].id, { type: "CAPTURE_ACCOUNT_NOW" }).catch(() => null);
    }
    await chrome.runtime.sendMessage({ type: "REFRESH_NOW" });
    await render();
  } finally {
    button.classList.remove("busy");
    button.disabled = false;
  }
});

chrome.storage.onChanged.addListener(render);
render();
