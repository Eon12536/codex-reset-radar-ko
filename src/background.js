importScripts(
  "core/settings.js",
  "core/time.js",
  "core/usage.js",
  "core/signals.js",
  "core/advice.js"
);

const ALARM_NAME = "codex-reset-radar-poll";
const USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";
const CREDITS_URL = "https://chatgpt.com/backend-api/wham/rate-limit-reset-credits";
const SESSION_URLS = [
  "https://chatgpt.com/api/auth/session",
  "https://chatgpt.com/backend-api/auth/session"
];
const TOKEN_KEY = "sessionAccessToken";
const TOKEN_EXPIRY_KEY = "sessionAccessTokenExpiresAt";

function sourceUrl(settings) {
  if (settings.sourceUrl) return settings.sourceUrl;
  return `https://api.dayclaw.com/api/source/public/x/${encodeURIComponent(settings.targetHandle)}/items`;
}

async function loadSettings() {
  const { settings } = await chrome.storage.local.get("settings");
  return RadarSettings.sanitize(settings);
}

async function saveSettings(settings) {
  const sanitized = RadarSettings.sanitize(settings);
  await chrome.storage.local.set({ settings: sanitized });
  await ensureAlarm(sanitized);
  return sanitized;
}

async function ensureAlarm(settings) {
  await chrome.alarms.clear(ALARM_NAME);
  await chrome.alarms.create(ALARM_NAME, {
    delayInMinutes: 1,
    periodInMinutes: settings.pollMinutes
  });
}

function tokenExpiry(token) {
  try {
    const payload = token.split(".")[1];
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    return Number(JSON.parse(atob(padded)).exp || 0) * 1000;
  } catch {
    return 0;
  }
}

async function cacheToken(token) {
  if (!token) return;
  await chrome.storage.session.set({
    [TOKEN_KEY]: token,
    [TOKEN_EXPIRY_KEY]: tokenExpiry(token)
  });
}

async function getToken() {
  const stored = await chrome.storage.session.get([TOKEN_KEY, TOKEN_EXPIRY_KEY]);
  if (stored[TOKEN_KEY] && (!stored[TOKEN_EXPIRY_KEY] || stored[TOKEN_EXPIRY_KEY] > Date.now() + 120000)) {
    return stored[TOKEN_KEY];
  }
  await chrome.storage.session.remove([TOKEN_KEY, TOKEN_EXPIRY_KEY]);
  for (const url of SESSION_URLS) {
    try {
      const response = await fetch(url, {
        credentials: "include",
        headers: { accept: "application/json" },
        redirect: "error"
      });
      if (!response.ok) continue;
      const data = await response.json();
      const token = data?.accessToken || data?.access_token || data?.session?.accessToken || null;
      if (token) {
        await cacheToken(token);
        return token;
      }
    } catch {
      // Continue through known session endpoints.
    }
  }
  return null;
}

async function trustedChatGptFetch(url, token) {
  const parsed = new URL(url);
  const allowedPaths = new Set([
    "/backend-api/wham/usage",
    "/backend-api/wham/rate-limit-reset-credits"
  ]);
  if (parsed.protocol !== "https:" || parsed.hostname !== "chatgpt.com" || parsed.port ||
      parsed.username || parsed.password || parsed.search || parsed.hash || !allowedPaths.has(parsed.pathname)) {
    throw new Error("Untrusted endpoint");
  }
  const headers = { accept: "application/json", "oai-language": chrome.i18n.getUILanguage() || "zh-CN" };
  if (token) headers.authorization = `Bearer ${token}`;
  const response = await fetch(parsed.href, { credentials: "include", headers, redirect: "error" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  if (!String(response.headers.get("content-type") || "").includes("application/json")) {
    throw new Error("Unexpected content type");
  }
  return response.json();
}

async function refreshAccount({ quiet = false } = {}) {
  const settings = await loadSettings();
  if (!settings.monitorAccount) return { ok: true, skipped: true };
  try {
    const token = await getToken();
    const [usageResult, creditsResult] = await Promise.allSettled([
      trustedChatGptFetch(USAGE_URL, token),
      trustedChatGptFetch(CREDITS_URL, token)
    ]);
    const usage = usageResult.status === "fulfilled"
      ? RadarUsage.normalizeUsage(usageResult.value, { source: "background" })
      : null;
    const credits = creditsResult.status === "fulfilled"
      ? RadarUsage.normalizeCredits(creditsResult.value)
      : null;
    if (!usage && !credits) throw new Error("Account data unavailable");
    await storeAccountSnapshot(usage, credits);
    return { ok: true, source: "background" };
  } catch (error) {
    if (!quiet) await chrome.storage.local.set({
      accountError: { message: String(error?.message || error), at: Date.now() }
    });
    return { ok: false, error: String(error?.message || error) };
  }
}

async function storeAccountSnapshot(usage, credits) {
  const current = await chrome.storage.local.get(["accountSnapshot", "signalSnapshot"]);
  const snapshot = {
    usage: usage || current.accountSnapshot?.usage || null,
    credits: credits || current.accountSnapshot?.credits || null,
    updatedAt: Date.now()
  };
  const advice = RadarAdvice.make({
    usage: snapshot.usage,
    credits: snapshot.credits,
    signal: current.signalSnapshot?.signal || null
  });
  await chrome.storage.local.set({ accountSnapshot: snapshot, adviceSnapshot: advice, accountError: null });
  await updateBadge(snapshot, current.signalSnapshot?.signal || null, advice);
  await maybeNotifyAdvice(advice, snapshot);
}

async function refreshSignals({ quiet = false } = {}) {
  const settings = await loadSettings();
  if (!settings.monitorSignals) return { ok: true, skipped: true };
  try {
    const response = await fetch(sourceUrl(settings), {
      headers: { accept: "application/json" },
      redirect: "error"
    });
    if (!response.ok) throw new Error(`Source HTTP ${response.status}`);
    const payload = await response.json();
    const items = RadarSignals.extractItems(payload);
    const state = await chrome.storage.local.get(["seenSignalIds", "accountSnapshot"]);
    const seen = new Set(state.seenSignalIds || []);
    const newItems = items.filter((item) => !seen.has(item.id));
    const signal = RadarSignals.strongest(newItems);
    const nextSeen = [...new Set([...seen, ...items.map((item) => item.id)])].slice(-300);
    const snapshot = {
      signal,
      checkedAt: Date.now(),
      source: sourceUrl(settings),
      itemCount: items.length
    };
    const advice = RadarAdvice.make({
      usage: state.accountSnapshot?.usage || null,
      credits: state.accountSnapshot?.credits || null,
      signal
    });
    await chrome.storage.local.set({
      signalSnapshot: snapshot,
      seenSignalIds: nextSeen,
      adviceSnapshot: advice,
      signalError: null
    });
    if (signal) await maybeNotifySignal(signal);
    await updateBadge(state.accountSnapshot, signal, advice);
    return { ok: true, signal: Boolean(signal) };
  } catch (error) {
    if (!quiet) await chrome.storage.local.set({
      signalError: { message: String(error?.message || error), at: Date.now() }
    });
    return { ok: false, error: String(error?.message || error) };
  }
}

function confidenceAllowed(confidence, threshold) {
  if (threshold === "all") return true;
  if (threshold === "medium") return confidence === "high" || confidence === "medium";
  return confidence === "high";
}

async function createNotification(id, options, settings) {
  const fullOptions = {
    type: "basic",
    iconUrl: "assets/icons/icon128.png",
    contextMessage: "Codex Reset Radar",
    priority: 2,
    ...options
  };
  if (RadarTime.isQuietHours(settings)) {
    const pending = await chrome.storage.local.get("pendingNotifications");
    await chrome.storage.local.set({
      pendingNotifications: [...(pending.pendingNotifications || []), { id, options: fullOptions }].slice(-10)
    });
    return;
  }
  await chrome.notifications.create(id, fullOptions);
}

async function maybeNotifySignal(signal) {
  const settings = await loadSettings();
  if (!settings.notifyOfficialReset || !confidenceAllowed(signal.assessment.confidence, settings.confidenceThreshold)) return;
  const dedupeKey = `signal:${signal.id}`;
  const { notificationHistory = {} } = await chrome.storage.local.get("notificationHistory");
  if (notificationHistory[dedupeKey]) return;
  const timeZone = RadarTime.resolveTimeZone(settings);
  const timing = signal.assessment.eventAt
    ? RadarTime.formatDateTime(signal.assessment.eventAt, timeZone)
    : "时间待确认";
  await createNotification(dedupeKey, {
    title: `Codex 可能在 ${timing} 重置额度`,
    message: "检测到高可信公开信号。建议先使用剩余额度，暂缓消耗重置券。",
    buttons: [{ title: "查看证据" }, { title: "稍后提醒" }]
  }, settings);
  notificationHistory[dedupeKey] = Date.now();
  await chrome.storage.local.set({ notificationHistory });
}

async function maybeNotifyAdvice(advice, snapshot) {
  const settings = await loadSettings();
  const nearest = RadarUsage.nearestExpiry(snapshot.credits);
  const hours = nearest ? (nearest - Date.now()) / 3600000 : Infinity;
  if (settings.notifyCreditExpiry && hours > 0 && hours <= settings.expiryWarningHours) {
    const key = `expiry:${Math.floor(nearest / 3600000)}`;
    const { notificationHistory = {} } = await chrome.storage.local.get("notificationHistory");
    if (!notificationHistory[key]) {
      await createNotification(key, {
        title: `一张重置券将在 ${RadarTime.relativeDuration(nearest)} 过期`,
        message: `${RadarUsage.findWindow(snapshot.usage, "weekly")?.remainingPercent ?? "--"}% 每周额度剩余；如果今天仍需长任务，可以考虑使用。`,
        buttons: [{ title: "查看建议" }, { title: "忽略本次" }]
      }, settings);
      notificationHistory[key] = Date.now();
      await chrome.storage.local.set({ notificationHistory });
    }
  }
  if (settings.notifyAdvice && ["blocked", "useIfBlocked"].includes(advice.tier)) {
    const key = `advice:${advice.tier}:${Math.floor(Date.now() / 21600000)}`;
    const { notificationHistory = {} } = await chrome.storage.local.get("notificationHistory");
    if (!notificationHistory[key]) {
      await createNotification(key, {
        title: advice.title,
        message: advice.message,
        buttons: [{ title: "查看建议" }]
      }, settings);
      notificationHistory[key] = Date.now();
      await chrome.storage.local.set({ notificationHistory });
    }
  }
}

async function updateBadge(accountSnapshot, signal, advice) {
  const weekly = RadarUsage.findWindow(accountSnapshot?.usage, "weekly");
  let text = weekly ? `${weekly.remainingPercent}` : "";
  let color = "#5fb9ad";
  if (signal?.assessment?.actionable) {
    text = "!";
    color = "#e7a93b";
  } else if (["blocked", "expiring"].includes(advice?.tier)) {
    text = "!";
    color = "#e05f52";
  } else if (weekly && weekly.remainingPercent < 25) {
    color = "#e05f52";
  } else if (weekly && weekly.remainingPercent < 60) {
    color = "#e7a93b";
  }
  await chrome.action.setBadgeText({ text });
  await chrome.action.setBadgeBackgroundColor({ color });
}

async function pollAll(options = {}) {
  const [account, signals] = await Promise.all([
    refreshAccount(options),
    refreshSignals(options)
  ]);
  await chrome.storage.local.set({ lastCheckedAt: Date.now() });
  return { ok: account.ok || signals.ok, account, signals };
}

async function openEvidence() {
  const { signalSnapshot } = await chrome.storage.local.get("signalSnapshot");
  if (signalSnapshot?.signal?.url) await chrome.tabs.create({ url: signalSnapshot.signal.url });
}

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  const settings = await saveSettings((await chrome.storage.local.get("settings")).settings || {});
  await ensureAlarm(settings);
  if (reason === "install") await chrome.tabs.create({ url: chrome.runtime.getURL("src/welcome/welcome.html") });
  await pollAll({ quiet: true });
});

chrome.runtime.onStartup.addListener(async () => {
  await ensureAlarm(await loadSettings());
  await pollAll({ quiet: true });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) {
    pollAll({ quiet: true });
    flushPendingNotifications();
  } else if (alarm.name.startsWith("snooze:")) {
    chrome.notifications.create(alarm.name.slice("snooze:".length), {
      type: "basic",
      iconUrl: "assets/icons/icon128.png",
      title: "Codex 重置信号提醒",
      message: "你在一小时前选择了稍后提醒。打开扩展查看最新证据与建议。",
      contextMessage: "Codex Reset Radar",
      buttons: [{ title: "查看建议" }]
    });
  }
});

async function flushPendingNotifications() {
  const settings = await loadSettings();
  if (RadarTime.isQuietHours(settings)) return;
  const { pendingNotifications = [] } = await chrome.storage.local.get("pendingNotifications");
  if (!pendingNotifications.length) return;
  await chrome.storage.local.set({ pendingNotifications: [] });
  for (const pending of pendingNotifications) {
    await chrome.notifications.create(pending.id, pending.options);
  }
}

chrome.notifications.onClicked.addListener(() => chrome.runtime.openOptionsPage());
chrome.notifications.onButtonClicked.addListener(async (notificationId, buttonIndex) => {
  if (notificationId.startsWith("signal:") && buttonIndex === 0) return openEvidence();
  if (notificationId.startsWith("signal:") && buttonIndex === 1) {
    await chrome.alarms.create(`snooze:${notificationId}`, { delayInMinutes: 60 });
    return;
  }
  if (buttonIndex === 0) await chrome.runtime.openOptionsPage();
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "CACHE_SESSION_TOKEN") {
    cacheToken(message.token).then(() => sendResponse({ ok: true }));
    return true;
  }
  if (message?.type === "STORE_ACCOUNT_SNAPSHOT") {
    storeAccountSnapshot(message.usage, message.credits).then(() => sendResponse({ ok: true }));
    return true;
  }
  if (message?.type === "REFRESH_NOW") {
    pollAll({ quiet: false }).then(sendResponse);
    return true;
  }
  if (message?.type === "SAVE_SETTINGS") {
    saveSettings(message.settings).then(sendResponse);
    return true;
  }
  if (message?.type === "OPEN_EVIDENCE") {
    openEvidence().then(() => sendResponse({ ok: true }));
    return true;
  }
  return false;
});
