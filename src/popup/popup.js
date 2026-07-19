const $ = (id) => document.getElementById(id);
const msg = (key, substitutions, fallback) => RadarI18n.t(key, substitutions, fallback);

RadarI18n.apply();

function meterColor(remaining) {
  if (remaining < 25) return "var(--danger)";
  if (remaining < 60) return "var(--amber)";
  return "var(--teal)";
}

function accountPlaceholder(settings, accountState) {
  if (!settings.monitorAccount) return msg("accountFeatureOff", undefined, "Account features are off");
  if (accountState?.status === "signedOut") return msg("optionalSignInToShow", undefined, "Optional: sign in to show");
  if (accountState?.status === "error") return msg("personalDataUnavailable", undefined, "Personal data is temporarily unavailable");
  return msg("optionalSignInToShow", undefined, "Optional: sign in to show");
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
    ? msg("resetTiming", [RadarTime.relativeDuration(windowData.resetAt), RadarTime.formatDateTime(windowData.resetAt, timeZone)], "$1 · $2")
    : msg("resetTimeUnknown", undefined, "Reset time unknown");
  meta.textContent = msg("remainingWithReset", [String(windowData.remainingPercent), resetText], "$1% remaining · $2");
}

function renderSignal(signalSnapshot, settings) {
  const signal = RadarSignals.isActive(signalSnapshot?.signal) ? signalSnapshot.signal : null;
  if (!signal) {
    $("signalHeadline").textContent = signalSnapshot?.checkedAt
      ? msg("noActionableSignal", undefined, "No actionable signal")
      : msg("scanningPublicSignals", undefined, "Scanning public signals");
    $("confidenceBadge").textContent = signalSnapshot?.checkedAt
      ? msg("monitoring", undefined, "Monitoring")
      : msg("waitingForData", undefined, "Waiting for data");
    $("confidenceBadge").className = "confidence neutral";
    $("signalMeta").textContent = signalSnapshot?.checkedAt
      ? msg("lastCheckedAt", RadarTime.formatTime(signalSnapshot.checkedAt, RadarTime.resolveTimeZone(settings)), "Last checked $1")
      : msg("firstCheckHint", undefined, "The first check may take a few seconds");
    $("viewEvidence").disabled = true;
    return;
  }
  const timeZone = RadarTime.resolveTimeZone(settings);
  const compactEventTime = signal.assessment.eventAt ? new Intl.DateTimeFormat(
    RadarI18n.uiLanguage(),
    { timeZone, month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }
  ).format(new Date(signal.assessment.eventAt)) : null;
  const communityPrediction = signal.prediction?.kind === "milestone";
  $("signalHeadline").textContent = signal.assessment.eventAt
    ? communityPrediction
      ? msg("communityExpectedResetAround", compactEventTime, "Community estimate: reset around $1")
      : msg("possibleResetAt", compactEventTime, "Possible reset at $1")
    : msg("publicSignalResetSoon", undefined, "Public signals indicate a possible reset soon");
  $("confidenceBadge").textContent = {
    high: msg("confidenceHigh", undefined, "High confidence"),
    medium: msg("confidenceMedium", undefined, "Medium confidence"),
    low: msg("confidenceLow", undefined, "Low confidence")
  }[signal.assessment.confidence] || msg("pendingAssessment", undefined, "Pending assessment");
  $("confidenceBadge").className = "confidence";
  const age = signal.createdAt ? RadarTime.elapsedDuration(signal.createdAt) : msg("justNow", undefined, "just now");
  const sourceLabel = sourceName(signal.source) || signal.author || msg("publicUpdates", undefined, "public updates");
  $("signalMeta").textContent = communityPrediction
    ? msg("experienceModelMeta", [sourceLabel, age], "Experience model · $1 · $2")
    : msg("sourceMeta", [sourceLabel, age], "From $1 · $2");
  $("viewEvidence").disabled = false;
}

function sourceName(source) {
  const keys = {
    "codex-lead": "sourceCodexLead",
    "openai-status": "sourceOpenAIStatus",
    "community-reset-history": "sourceCommunityHistory",
    "github-community": "sourceGitHubCommunity",
    custom: "sourceCustom"
  };
  return source?.id ? msg(keys[source.id], undefined, source.label || "") : "";
}

function forecastDate(value, timeZone) {
  return new Intl.DateTimeFormat(RadarI18n.uiLanguage(), {
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
    ? msg("forecastCommunity", String(forecast.totalProbability), "Next 72 hours ≈$1% · community forecast")
    : forecast.basis === "public-signal"
      ? msg("forecastWeighted", [String(forecast.totalProbability), String(forecast.sourceCount)], "Next 72 hours ≈$1% · $2 weighted sources")
      : msg("forecastNoSignals", String(forecast.totalProbability), "Next 72 hours ≈$1% · no valid signal");
  $("forecastSummary").title = msg("forecastDisclaimer", undefined, "Heuristic probability, not an OpenAI plan or promise");
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
    $("creditsExpiry").textContent = credits.availableCount
      ? msg("someCreditsNoExpiry", undefined, "Some reset credits have no expiry time")
      : msg("noResetCredits", undefined, "No reset credits available");
    return;
  }
  const timeZone = RadarTime.resolveTimeZone(settings);
  $("creditsExpiry").textContent = msg("nearestCreditExpiry", [RadarTime.relativeDuration(nearest), RadarTime.formatDateTime(nearest, timeZone)], "Nearest credit expires $1 · $2");
}

function renderAdvice(advice) {
  const value = advice || {
    tier: "guest",
    title: msg("adviceGuestTitle", undefined, "Public signal radar is running"),
    message: msg("adviceGuestMessage", undefined, "Monitor public reset signals without signing in. Sign in only to add personal quota and reset-credit advice."),
    detail: msg("basicMode", undefined, "Basic mode")
  };
  $("advicePanel").dataset.tier = value.tier;
  $("adviceTitle").textContent = value.tier === "guest" ? value.title : msg("advicePrefix", value.title, "Advice: $1");
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
    ? msg("publicSignalsUnavailable", undefined, "Public signals are temporarily unavailable")
    : data.accountState?.status === "signedOut"
      ? msg("basicModeHealthy", undefined, "Basic mode: public monitoring is healthy")
      : msg("monitoringHealthy", undefined, "Monitoring is healthy");
  $("notificationState").textContent = settings.notifyOfficialReset || settings.notifyCreditExpiry || settings.notifyAdvice
    ? msg("notificationsOn", undefined, "Notifications on")
    : msg("notificationsOff", undefined, "Notifications off");
  $("notificationState").style.color = settings.notifyOfficialReset || settings.notifyCreditExpiry || settings.notifyAdvice
    ? "#7bcf74"
    : "var(--muted)";
  $("lastChecked").textContent = data.lastCheckedAt
    ? msg("checkedAt", RadarTime.formatTime(data.lastCheckedAt, RadarTime.resolveTimeZone(settings)), "Checked $1")
    : msg("notCheckedYet", undefined, "Not checked yet");
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
