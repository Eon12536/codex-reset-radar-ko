const $ = (id) => document.getElementById(id);

function meterColor(remaining) {
  if (remaining < 25) return "var(--danger)";
  if (remaining < 60) return "var(--amber)";
  return "var(--teal)";
}

function renderWindow(kind, usage, settings) {
  const windowData = RadarUsage.findWindow(usage, kind);
  const prefix = kind === "fiveHour" ? "fiveHour" : "weekly";
  const bar = $(`${prefix}Bar`);
  const meta = $(`${prefix}Meta`);
  if (!windowData) {
    bar.style.width = "0";
    meta.textContent = "数据不可用";
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
  const signal = signalSnapshot?.signal;
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
  $("signalHeadline").textContent = signal.assessment.eventAt
    ? `可能在 ${RadarTime.formatDateTime(signal.assessment.eventAt, timeZone)} 重置`
    : "公开信号显示可能即将重置";
  $("confidenceBadge").textContent = signal.assessment.confidence === "high" ? "高可信" : "中可信";
  $("confidenceBadge").className = "confidence";
  const age = signal.createdAt ? RadarTime.relativeDuration(Date.now() + Math.max(0, Date.now() - RadarTime.parseTimestamp(signal.createdAt))) : "刚刚";
  $("signalMeta").textContent = `来自 @${signal.author || "公开动态"} · ${age.replace("后", "前")}`;
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

function renderForecast(signal, settings) {
  const timeZone = RadarTime.resolveTimeZone(settings);
  const forecast = RadarForecast.build({ signal, timeZone });
  const highlighted = [...forecast.slots]
    .sort((a, b) => b.probability - a.probability || a.startAt - b.startAt)
    .slice(0, 3)
    .sort((a, b) => a.startAt - b.startAt);
  $("forecastSummary").textContent = forecast.basis === "public-signal"
    ? `未来 72 小时约 ${forecast.totalProbability}% · 公开信号估算`
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

function renderCredits(credits, settings) {
  if (!credits) {
    $("creditsCount").textContent = "--";
    $("creditsExpiry").textContent = "打开 ChatGPT/Codex 页面后刷新";
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
    tier: "unavailable",
    title: "等待完整数据",
    message: "插件不会在额度或重置券数据缺失时猜测。",
    detail: "只读建议"
  };
  $("advicePanel").dataset.tier = value.tier;
  $("adviceTitle").textContent = `建议：${value.title}`;
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
    "accountError",
    "signalError"
  ]);
  const settings = RadarSettings.sanitize(data.settings);
  renderSignal(data.signalSnapshot, settings);
  renderForecast(data.signalSnapshot?.signal || null, settings);
  renderWindow("fiveHour", data.accountSnapshot?.usage, settings);
  renderWindow("weekly", data.accountSnapshot?.usage, settings);
  renderCredits(data.accountSnapshot?.credits, settings);
  renderAdvice(data.adviceSnapshot);
  const hasError = Boolean(data.accountError && data.signalError);
  $("healthDot").className = `health-dot ${hasError ? "warn" : data.lastCheckedAt ? "ok" : ""}`;
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
