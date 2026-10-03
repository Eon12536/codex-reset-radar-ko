importScripts(
  "core/notification-icon.js",
  "core/translations.js",
  "core/i18n.js",
  "core/settings.js",
  "core/chat-counter.js",
  "core/chat-history.js",
  "core/time.js",
  "core/usage.js",
  "core/recovery.js",
  "core/credit-grants.js",
  "core/signals.js",
  "core/news.js",
  "core/events.js",
  "core/schedule.js",
  "core/sources.js",
  "core/direct-x.js",
  "core/public-alerts.js",
  "core/badge.js",
  "core/forecast.js",
  "core/advice.js",
  "core/security.js"
);

const ALARM_NAME = "codex-reset-radar-poll";
const RESUME_ALARM = "codex-reset-radar-resume";
const PUBLIC_RESUME_ALARM = "codex-reset-radar-public-resume";
const PUBLIC_RETRY_ALARM = "codex-reset-radar-public-retry";
const PUBLIC_DELIVERY_ALARM = "codex-reset-radar-public-delivery";
const BADGE_EXPIRY_ALARM = "codex-reset-radar-badge-expiry";
const USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";
const CREDITS_URL = "https://chatgpt.com/backend-api/wham/rate-limit-reset-credits";
const SESSION_URLS = [
  "https://chatgpt.com/api/auth/session",
  "https://chatgpt.com/backend-api/auth/session"
];
const TOKEN_KEY = "sessionAccessToken";
const TOKEN_EXPIRY_KEY = "sessionAccessTokenExpiresAt";
const msg = (key, substitutions, fallback) => RadarI18n.t(key, substitutions, fallback);
const SECURITY_SCHEMA = 1;
const NOTIFICATION_BUILD = "0.2.67";
let stateEpoch = 0;
let mutations = Promise.resolve();
let readyPromise;
let accountJob;
let signalJob;
const activeRequests = new Set();

function mutate(action) {
  const result = mutations.then(action);
  mutations = result.catch(() => {});
  return result;
}

function invalidateRequests() {
  stateEpoch++;
  for (const controller of activeRequests) controller.abort();
}

function accountNotification(id) {
  return typeof id === "string" && (id.startsWith("expiry:") || id.startsWith("advice:") || id.startsWith("recovery:") || id.startsWith("banked:"));
}

async function purgeAccountState() {
  await chrome.alarms.clear(RESUME_ALARM);
  await chrome.storage.local.remove("resumeCheck");
  await chrome.storage.session.remove([TOKEN_KEY, TOKEN_EXPIRY_KEY]);
  await chrome.storage.local.remove(["accountSnapshot", "accountState", "accountError", "adviceSnapshot", "recoveryState", "recoverySalt", "creditGrantState"]);
  const { pendingNotifications = [], notificationHistory = {}, signalSnapshot } = await chrome.storage.local.get(["pendingNotifications", "notificationHistory", "signalSnapshot"]);
  const settings = await loadSettings();
  const signal = settings.monitorSignals && RadarSignals.isActive(signalSnapshot?.signal) ? signalSnapshot.signal : null;
  const advice = RadarAdvice.make({ usage: null, credits: null, signal });
  await chrome.storage.local.set({
    pendingNotifications: pendingNotifications.filter(item => !accountNotification(item.id)),
    notificationHistory: Object.fromEntries(Object.entries(notificationHistory).filter(([id]) => !accountNotification(id))),
    adviceSnapshot: advice
  });
  const visible = await chrome.notifications.getAll();
  for (const id of Object.keys(visible)) if (accountNotification(id)) await chrome.notifications.clear(id);
  await updateBadge(null, signal, advice);
}

function ensureSecurity() {
  return readyPromise ||= (async () => {
    await RadarI18n.ready;
    await chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
    await chrome.storage.session.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
    const stored = await chrome.storage.local.get(["settings", "securitySchema", "chatCounterSchema", "chatPolicySchema"]);
    const settings = RadarSettings.sanitize(stored.settings);
    // Chat has independent allowances. Keep records, but stop treating an
    // unrelated Codex quota recovery as evidence of a Chat reset.
    if (stored.chatPolicySchema !== 1) settings.syncChatResetWithCodex = false;
    if (stored.securitySchema !== SECURITY_SCHEMA) {
      settings.monitorAccount = false;
      await chrome.storage.local.set({ pendingNotifications: [] });
    }
    // 0.2.21 counted a browser profile without an account identity. Never assign
    // those observations to the next person who signs in, or enable new account reads silently.
    if (stored.chatCounterSchema !== 2) {
      settings.monitorChat = false;
      await chrome.storage.local.remove(["chatCounter", "chatCounters", "chatAccount", "chatCounterSalt"]);
    }
    await chrome.storage.session.remove([TOKEN_KEY, TOKEN_EXPIRY_KEY]);
    await chrome.storage.local.set({ settings, securitySchema: SECURITY_SCHEMA, chatCounterSchema: 2, chatPolicySchema: 1 });
    await cleanChatHistory(settings);
    if (!settings.monitorAccount) await purgeAccountState();
    if (!settings.monitorChat) await chrome.storage.local.remove(["chatCounter", "chatCounters", "chatAccount", "chatCounterSalt", "chatCounterError"]);
    if (!settings.monitorChat) await chrome.storage.session.remove(["chatBindingsV2", "chatPlanTabsV2"]);
    else {
      const session = await chrome.storage.session.get(["chatBindingsV2", "chatPlanTabsV2"]);
      for (const [document, binding] of Object.entries(session.chatBindingsV2 || {}).slice(-200)) {
        if (/^[a-f0-9]{64}$/.test(binding?.key) && /^[a-f0-9-]{36}$/.test(binding?.scope)) chatBindings.set(document, binding);
      }
      for (const [id, request] of Object.entries(session.chatPlanTabsV2 || {})) if (request?.expiresAt > Date.now()) chatPlanTabs.set(Number(id), request);
    }
    await revalidateCachedSignals(stateEpoch);
    try { await configureChatCounter(settings.monitorChat); }
    catch { await chrome.storage.local.set({ chatCounterError: true }); }
  })();
}

async function loadSettings() {
  const { settings } = await chrome.storage.local.get("settings");
  return RadarSettings.sanitize(settings);
}

async function saveSettings(settings, { connectChat = false } = {}) {
  invalidateRequests();
  await ensureSecurity();
  const sanitized = RadarSettings.sanitize(settings);
  let startChat = false;
  const saved = await mutate(async () => {
    const wasCounting = (await loadSettings()).monitorChat;
    startChat = !wasCounting && sanitized.monitorChat;
    await configureChatCounter(sanitized.monitorChat);
    await chrome.storage.local.set({ settings: sanitized });
    await cleanChatHistory(sanitized);
    if (!sanitized.monitorChat) {
      await chrome.storage.local.remove(["chatCounter", "chatCounters", "chatAccount", "chatCounterSalt", "chatCounterError"]);
      chatBindings.clear(); chatPlanTabs.clear();
      await chrome.storage.session.remove(["chatBindingsV2", "chatPlanTabsV2"]);
      if (wasCounting) await injectChatCounter(false);
    }
    else await injectChatCounter();
    if (!sanitized.monitorSignals || !sanitized.monitorLeadSource) {
      await chrome.storage.local.remove("publicResumeCheck");
      await chrome.alarms.clear(PUBLIC_RESUME_ALARM);
      await chrome.alarms.clear(PUBLIC_DELIVERY_ALARM);
    }
    if (!sanitized.monitorSignals || !sanitized.monitorLeadSource || !sanitized.monitorDirectX) {
      await chrome.storage.local.remove(["publicRetryCheck", "directXContextCache"]);
      await chrome.alarms.clear(PUBLIC_RETRY_ALARM);
    }
    if (!sanitized.monitorAccount) await purgeAccountState();
    if (!sanitized.notifyAccountReset) {
      const { recoveryState } = await chrome.storage.local.get("recoveryState");
      if (recoveryState) await chrome.storage.local.set({ recoveryState: { ...recoveryState, events: [] } });
    }
    await reconcileRecoveryNotifications(sanitized, stateEpoch);
    if (!sanitized.notifyBankedReset) {
      const { creditGrantState } = await chrome.storage.local.get("creditGrantState");
      if (creditGrantState) await chrome.storage.local.set({ creditGrantState: { ...creditGrantState,
        events: (creditGrantState.events || []).map(event => ({ ...event, notify: false })) } });
    }
    await reconcileBankedNotifications(sanitized, stateEpoch);
    if (!sanitized.notifyCreditExpiry || !sanitized.notifyAdvice) {
      const disabled = id => (!sanitized.notifyCreditExpiry && id.startsWith('expiry:')) ||
        (!sanitized.notifyAdvice && id.startsWith('advice:'));
      const { pendingNotifications = [] } = await chrome.storage.local.get('pendingNotifications');
      await chrome.storage.local.set({ pendingNotifications: pendingNotifications.filter(item => !disabled(item.id)) });
      for (const id of Object.keys(await chrome.notifications.getAll())) if (disabled(id)) await chrome.notifications.clear(id);
    }
    if (!sanitized.monitorSignals || !sanitized.monitorLeadSource || !sanitized.notifyHints) {
      const { pendingNotifications = [] } = await chrome.storage.local.get("pendingNotifications");
      await chrome.storage.local.set({ pendingNotifications: pendingNotifications.filter(item => !/^(hint|event):/.test(item.id)) });
      for (const id of Object.keys(await chrome.notifications.getAll())) if (/^(hint|event):/.test(id)) await chrome.notifications.clear(id);
    }
    await revalidateCachedSignals(stateEpoch);
    if (!sanitized.monitorSignals || !sanitized.monitorLeadSource) await chrome.storage.local.remove(["hintSnapshot", "scheduleSnapshot"]);
    await ensureAlarm(sanitized);
    return sanitized;
  });
  if (connectChat && startChat) await connectChatAccount();
  return saved;
}

const CHAT_SCRIPT_ID = "radar-chat-counter";
let chatHistoryJob;
async function cleanChatHistory(settings) {
  const { chatCounters = {} } = await chrome.storage.local.get('chatCounters');
  let changed = false;
  for (const profile of Object.values(chatCounters)) {
    if (!settings.syncChatHistory) {
      for (const key of ['history', 'historyEvents', 'historyCache', 'historyClassificationVersion']) if (key in profile) { delete profile[key]; changed = true; }
    } else if (profile.history?.status === 'running') {
      profile.history = { ...profile.history, status: 'error', code: 'network' }; changed = true;
    }
  }
  if (changed) await chrome.storage.local.set({ chatCounters });
}

async function refreshChatHistory({ force = false } = {}) {
  await ensureSecurity();
  if (chatHistoryJob) return chatHistoryJob;
  const settings = await loadSettings();
  if (!settings.monitorChat || !settings.syncChatHistory) return { ok: true, skipped: true };
  if (chatHistoryJob) return chatHistoryJob;
  chatHistoryJob = runChatHistory({ force }).finally(() => { chatHistoryJob = null; });
  return chatHistoryJob;
}

async function runChatHistory({ force = false } = {}) {
  const epoch = stateEpoch;
  const controller = new AbortController(); activeRequests.add(controller);
  const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(120000)]);
  let key;
  const hash = async value => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))), b => b.toString(16).padStart(2, '0')).join('');
  try {
    const account = await refreshChatAccount({ force: true });
    if (account.status !== 'connected') return { ok: false, code: 'auth' };
    key = account.key;
    const stored = await chrome.storage.local.get(['chatCounters', 'chatCounterSalt']);
    const previous = stored.chatCounters?.[key] || {};
    if (!force && previous.history?.checkedAt > Date.now() - 30000) return { ok: true, skipped: true };
    const token = await getToken(signal), identity = RadarChatCounter.identity(token);
    if (!identity || !stored.chatCounterSalt || await RadarRecovery.accountKey(token, null, stored.chatCounterSalt) !== key) throw new Error('changed');
    await mutate(async () => {
      if (epoch !== stateEpoch || !(await loadSettings()).syncChatHistory) throw new Error('stopped');
      const { chatCounters = {} } = await chrome.storage.local.get('chatCounters');
      chatCounters[key] = { ...chatCounters[key], history: { ...previous.history, status: 'running', checkedAt: Date.now() } };
      await chrome.storage.local.set({ chatCounters: boundedChatProfiles(chatCounters, key) });
    });
    let lastRequestAt = 0;
    const read = async url => {
      signal.throwIfAborted();
      const delay = Math.max(0, 700 - (Date.now() - lastRequestAt));
      if (delay) await new Promise(resolve => setTimeout(resolve, delay));
      signal.throwIfAborted(); lastRequestAt = Date.now();
      return RadarSecurity.fetchData(url, { account: true, history: true, accountId: identity.account, token, signal });
    };
    const result = await RadarChatHistory.collect({ read, hash, previous, signal, family: account.family });
    // Do not attach a previous account's records to a newly signed-in account.
    const freshToken = await getToken(signal);
    if (!RadarChatCounter.identity(freshToken) || await RadarRecovery.accountKey(freshToken, null, stored.chatCounterSalt) !== key) throw new Error('changed');
    await mutate(async () => {
      const current = await loadSettings();
      const { chatAccount, chatCounters = {} } = await chrome.storage.local.get(['chatAccount', 'chatCounters']);
      if (epoch !== stateEpoch || !current.monitorChat || !current.syncChatHistory || chatAccount?.key !== key) return;
      // Merge with the current profile so sends and Codex resets during a scan survive.
      chatCounters[key] = { ...chatCounters[key], ...result, updatedAt: Date.now() };
      await chrome.storage.local.set({ chatCounters: boundedChatProfiles(chatCounters, key) });
    });
    return { ok: result.history.status !== 'error', status: result.history.status };
  } catch (error) {
    await mutate(async () => {
      if (!key || epoch !== stateEpoch || !(await loadSettings()).syncChatHistory) return;
      const { chatCounters = {} } = await chrome.storage.local.get('chatCounters');
      if (!chatCounters[key]) return;
      chatCounters[key] = { ...chatCounters[key], history: { ...chatCounters[key].history,
        status: 'error', code: error.message === 'changed' ? 'changed' : 'network', checkedAt: Date.now() } };
      await chrome.storage.local.set({ chatCounters });
    });
    return { ok: false };
  } finally { activeRequests.delete(controller); }
}
async function configureChatCounter(enabled) {
  if (!enabled) {
    if (chrome.scripting?.unregisterContentScripts && await chrome.permissions.contains({ permissions: ["scripting"] })) {
      const registered = await chrome.scripting.getRegisteredContentScripts({ ids: [CHAT_SCRIPT_ID] });
      if (registered.length) await chrome.scripting.unregisterContentScripts({ ids: [CHAT_SCRIPT_ID] });
    }
    return;
  }
  if (!chrome.scripting || !await chrome.permissions.contains({ permissions: ["scripting"] })) throw new Error("Chat permission required");
  const registered = await chrome.scripting.getRegisteredContentScripts({ ids: [CHAT_SCRIPT_ID] });
  if (!registered.length) await chrome.scripting.registerContentScripts([{
    id: CHAT_SCRIPT_ID, matches: ["https://chatgpt.com/*"],
    js: ["src/core/chat-counter.js", "src/chat-counter.js"], runAt: "document_idle", world: "ISOLATED", persistAcrossSessions: true
  }]);
  await chrome.storage.local.remove("chatCounterError");
}

async function injectChatCounter(inject = true) {
  for (const tab of await chrome.tabs.query({ url: "https://chatgpt.com/*" })) {
    if (!RadarChatCounter.chatUrl(tab.url)) continue;
    try {
      if (inject) await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["src/core/chat-counter.js", "src/chat-counter.js"] });
      await chrome.tabs.sendMessage(tab.id, { type: "CHAT_COUNT_SYNC" });
    } catch { /* Navigating or discarded tabs load the registered script next time. */ }
  }
}

let chatAccountJob;
const chatBindings = new Map();
const chatPlanTabs = new Map();
const chatPlanWaiters = new Map();
let chatPlanJob;
const chatDocument = sender => `${sender.tab.id}:${sender.documentId || "top"}`;

function boundedChatProfiles(profiles, activeKey) {
  return Object.fromEntries(Object.entries(profiles).filter(([key]) => /^[a-f0-9]{64}$/.test(key))
    .sort(([a, x], [b, y]) => a === activeKey ? -1 : b === activeKey ? 1 : (y.updatedAt || 0) - (x.updatedAt || 0)).slice(0, 5));
}

async function refreshChatAccount({ force = false } = {}) {
  if (!(await loadSettings()).monitorChat) return { status: "off" };
  if (chatAccountJob) return chatAccountJob;
  const cached = await chrome.storage.local.get("chatAccount");
  if (chatAccountJob) return chatAccountJob;
  if (!force && cached.chatAccount?.checkedAt > Date.now() - 30000) return cached.chatAccount;
  chatAccountJob = (async () => {
    const epoch = stateEpoch;
    const controller = new AbortController(); activeRequests.add(controller);
    try {
      const token = await getToken(controller.signal);
      const identity = RadarChatCounter.identity(token);
      if (!identity) throw new Error("Account identity unavailable");
      const stored = await chrome.storage.local.get("chatCounterSalt");
      const salt = stored.chatCounterSalt || Array.from(crypto.getRandomValues(new Uint8Array(24)), byte => byte.toString(16).padStart(2, "0")).join("");
      const key = await RadarRecovery.accountKey(token, null, salt);
      return await mutate(async () => {
        if (epoch !== stateEpoch || !(await loadSettings()).monitorChat) return { status: "off" };
        const { chatCounters = {} } = await chrome.storage.local.get("chatCounters");
        const profile = chatCounters[key] || {};
        const family = identity.family === "unknown" ? profile.family || "unknown" : identity.family;
        const account = { key, family, status: "connected", checkedAt: Date.now() };
        // Keep dated evidence for a labelled, bounded fallback during page outages.
        // A family/account change cannot apply another account's allowance.
        chatCounters[key] = { ...profile, family, updatedAt: Date.now() };
        await chrome.storage.local.set({ chatAccount: account, chatCounterSalt: salt, chatCounters: boundedChatProfiles(chatCounters, key) });
        return account;
      });
    } catch {
      return await mutate(async () => {
        if (epoch !== stateEpoch || !(await loadSettings()).monitorChat) return { status: "off" };
        const account = { status: "unverified", checkedAt: Date.now() };
        await chrome.storage.local.set({ chatAccount: account });
        return account;
      });
    } finally { activeRequests.delete(controller); }
  })().finally(() => { chatAccountJob = null; });
  return chatAccountJob;
}

async function chatCountStatus(sender) {
  const account = await refreshChatAccount();
  if (account.status !== "connected") return { enabled: false };
  return mutate(async () => {
    const { chatAccount } = await chrome.storage.local.get("chatAccount");
    if (!(await loadSettings()).monitorChat || chatAccount?.status !== "connected" || chatAccount.key !== account.key) return { enabled: false };
    const document = chatDocument(sender);
    let binding = chatBindings.get(document);
    // A tab from a previous login must reload before contributing to the new login.
    if (binding && binding.key !== account.key) return { enabled: false };
    if (!binding) {
      binding = { key: account.key, scope: crypto.randomUUID() };
      if (chatBindings.size >= 200) chatBindings.delete(chatBindings.keys().next().value);
      chatBindings.set(document, binding);
      await chrome.storage.session.set({ chatBindingsV2: Object.fromEntries(chatBindings) });
    }
    return { enabled: true, scope: binding.scope, family: account.family };
  });
}

async function recordChatCount(message, sender) {
  const epoch = stateEpoch;
  const binding = chatBindings.get(chatDocument(sender));
  if (!binding || binding.scope !== message.scope) return { ok: false };
  const account = await refreshChatAccount({ force: true });
  if (account.status !== "connected" || account.key !== binding.key) return { ok: false };
  const bytes = new TextEncoder().encode(message.id);
  const key = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), byte => byte.toString(16).padStart(2, "0")).join("");
  return mutate(async () => {
    const { chatAccount, chatCounters = {} } = await chrome.storage.local.get(["chatAccount", "chatCounters"]);
    if (epoch !== stateEpoch || !(await loadSettings()).monitorChat || chatAccount?.status !== "connected" || chatAccount.key !== binding.key) return { ok: false };
    chatCounters[binding.key] = RadarChatCounter.record(chatCounters[binding.key], { key, model: RadarChatCounter.model(message.model, { family: account.family }) });
    await chrome.storage.local.set({ chatCounters: boundedChatProfiles(chatCounters, binding.key) });
    return { ok: true };
  });
}

async function observeChatPlan(message, sender) {
  const epoch = stateEpoch;
  const request = chatPlanTabs.get(sender.tab.id), binding = chatBindings.get(chatDocument(sender));
  const plan = RadarChatCounter.planFromHeading(message.heading);
  // Only a freshly opened current-plan page may supply evidence. A random open
  // pricing page, past conversation or stale billing tab cannot change a budget.
  if (!request || request.expiresAt < Date.now() || !binding || binding.scope !== message.scope || !plan ||
      new URL(sender.url).hash !== "#settings/Billing") return { ok: false };
  const account = await refreshChatAccount({ force: true });
  const policy = RadarChatCounter.PLANS[plan];
  if (account.status !== "connected" || binding.key !== account.key ||
      (request.key && request.key !== account.key) || (account.family !== "unknown" && account.family !== policy.family)) return { ok: false };
  return mutate(async () => {
    const { chatAccount, chatCounters = {} } = await chrome.storage.local.get(["chatAccount", "chatCounters"]);
    if (epoch !== stateEpoch || !(await loadSettings()).monitorChat || chatAccount?.key !== binding.key) return { ok: false };
    if ((request.choiceRevision || null) !== (chatCounters[binding.key]?.planChoiceRevision || null)) {
      chatPlanWaiters.get(sender.tab.id)?.({ ok: false, code: 'superseded' });
      return { ok: false };
    }
    chatCounters[binding.key] = { ...chatCounters[binding.key], plan, planChoice: null, family: policy.family, planAt: Date.now(), updatedAt: Date.now(), planCheck: { status: 'confirmed', checkedAt: Date.now() } };
    await chrome.storage.local.set({ chatAccount: { ...chatAccount, family: policy.family }, chatCounters: boundedChatProfiles(chatCounters, binding.key) });
    chatPlanTabs.delete(sender.tab.id);
    await chrome.storage.session.set({ chatPlanTabsV2: Object.fromEntries(chatPlanTabs) });
    chatPlanWaiters.get(sender.tab.id)?.({ ok: true, plan });
    return { ok: true };
  });
}

async function connectChatAccount({ active = true } = {}) {
  const epoch = stateEpoch;
  const account = await refreshChatAccount({ force: true });
  if (!(await loadSettings()).monitorChat) return { ok: false };
  const { chatCounters = {} } = await chrome.storage.local.get('chatCounters');
  const tab = await chrome.tabs.create({ url: "https://chatgpt.com/#settings/Billing", active });
  if (epoch !== stateEpoch || !(await loadSettings()).monitorChat) return { ok: false, tabId: tab.id };
  for (const [id, request] of chatPlanTabs) if (request.expiresAt < Date.now()) chatPlanTabs.delete(id);
  chatPlanTabs.set(tab.id, { key: account.key || null, choiceRevision: chatCounters[account.key]?.planChoiceRevision || null, expiresAt: Date.now() + 5 * 60000 });
  await chrome.storage.session.set({ chatPlanTabsV2: Object.fromEntries(chatPlanTabs) });
  return { ok: true, connected: account.status === "connected", tabId: tab.id, accountKey: account.key };
}

async function chooseChatPlan(message) {
  const epoch = stateEpoch;
  const plan = RadarChatCounter.currentPlan(message.plan);
  const account = await refreshChatAccount({ force: true });
  if (account.status !== 'connected' || account.key !== message.accountKey ||
      (plan !== 'auto' && RadarChatCounter.PLANS[plan]?.family !== account.family)) return { ok: false };
  if (plan === 'auto') {
    if (RadarChatCounter.PLANS[account.family]?.family === account.family) {
      return mutate(async () => {
        const { chatAccount, chatCounters = {} } = await chrome.storage.local.get(['chatAccount', 'chatCounters']);
        if (epoch !== stateEpoch || !(await loadSettings()).monitorChat || chatAccount?.key !== account.key ||
            chatAccount.family !== account.family) return { ok: false };
        chatCounters[account.key] = { ...chatCounters[account.key], updatedAt: Date.now(),
          planChoice: null, planChoiceRevision: crypto.randomUUID(), planCheck: null };
        await chrome.storage.local.set({ chatCounters: boundedChatProfiles(chatCounters, account.key) });
        return { ok: true, plan: account.family };
      });
    }
    // Switching to automatic is a verification transaction. Keep the existing
    // choice until a current Billing observation actually replaces it.
    const result = await refreshChatPlan(account.key);
    return mutate(async () => {
      const { chatAccount, chatCounters = {} } = await chrome.storage.local.get(['chatAccount', 'chatCounters']);
      if (epoch !== stateEpoch || !(await loadSettings()).monitorChat || chatAccount?.key !== account.key) return { ok: false };
      const profile = chatCounters[account.key];
      const verified = RadarChatCounter.verifiedPlan(profile, chatAccount.family);
      if (result.ok && verified && !profile.planChoice) return { ok: true, plan: verified };
      if (result.code !== 'superseded' && profile) {
        chatCounters[account.key] = { ...profile, planCheck: { status: 'failed', checkedAt: Date.now() } };
        await chrome.storage.local.set({ chatCounters });
      }
      return { ok: false, code: 'plan-check-failed', preserved: Boolean(RadarChatCounter.planEvidence(profile, chatAccount.family).plan) };
    });
  }
  return mutate(async () => {
    const { chatAccount, chatCounters = {} } = await chrome.storage.local.get(['chatAccount', 'chatCounters']);
    if (epoch !== stateEpoch || !(await loadSettings()).monitorChat || chatAccount?.key !== account.key ||
        RadarChatCounter.PLANS[plan]?.family !== chatAccount.family) return { ok: false };
    chatCounters[account.key] = { ...chatCounters[account.key], updatedAt: Date.now(),
      planChoice: { plan, at: Date.now() }, planChoiceRevision: crypto.randomUUID(), planCheck: null };
    await chrome.storage.local.set({ chatCounters: boundedChatProfiles(chatCounters, account.key) });
    return { ok: true };
  });
}

async function refreshChatPlan(expectedAccountKey = null) {
  if (chatPlanJob) return chatPlanJob;
  chatPlanJob = runChatPlan(expectedAccountKey).finally(() => { chatPlanJob = null; });
  return chatPlanJob;
}

async function runChatPlan(expectedAccountKey = null) {
  const epoch = stateEpoch;
  if (!(await loadSettings()).monitorChat) return { ok: true, skipped: true };
  const account = await refreshChatAccount({ force: true });
  if (account.status !== 'connected') return { ok: false, code: 'auth' };
  if (expectedAccountKey && account.key !== expectedAccountKey) return { ok: false, code: 'changed' };
  if (!['pro', 'business', 'unknown'].includes(account.family)) return { ok: true, status: 'no-fixed-budget' };
  if (!chrome.tabs.get || !chrome.tabs.remove || !await chrome.permissions.contains({ permissions: ['scripting'] })) return { ok: false, code: 'permission' };
  const controller = new AbortController(); activeRequests.add(controller);
  let tabId, timer;
  const mark = async status => mutate(async () => {
    const { chatCounters = {}, chatAccount } = await chrome.storage.local.get(['chatCounters', 'chatAccount']);
    if (epoch !== stateEpoch || chatAccount?.key !== account.key || !(await loadSettings()).monitorChat) return;
    chatCounters[account.key] = { ...chatCounters[account.key], planCheck: { status, checkedAt: Date.now() } };
    await chrome.storage.local.set({ chatCounters });
  });
  try {
    await mark('running');
    const connection = await connectChatAccount({ active: false });
    tabId = connection.tabId;
    if (!connection.ok || !Number.isInteger(tabId) || epoch !== stateEpoch || connection.accountKey !== account.key) {
      await mark('stopped'); return { ok: false, code: 'stopped' };
    }
    const result = await new Promise(resolve => {
      chatPlanWaiters.set(tabId, resolve);
      timer = setTimeout(() => resolve({ ok: false, code: 'timeout' }), 45000);
      controller.signal.addEventListener('abort', () => resolve({ ok: false, code: 'stopped' }), { once: true });
      if (controller.signal.aborted) resolve({ ok: false, code: 'stopped' });
      // Covers the rare case that the content script finished before registration.
      chrome.storage.local.get('chatCounters').then(({ chatCounters }) => {
        if (!chatPlanTabs.has(tabId) && chatCounters?.[account.key]?.planCheck?.status === 'confirmed') resolve({ ok: true });
      }).catch(() => resolve({ ok: false, code: 'storage' }));
    });
    if (!result.ok) await mark(result.code);
    return result;
  } catch { await mark('error'); return { ok: false, code: 'error' }; }
  finally {
    clearTimeout(timer); activeRequests.delete(controller);
    if (Number.isInteger(tabId)) {
      chatPlanWaiters.delete(tabId); chatPlanTabs.delete(tabId);
      await chrome.storage.session.set({ chatPlanTabsV2: Object.fromEntries(chatPlanTabs) });
      const tab = await chrome.tabs.get(tabId).catch(() => null);
      if (tab?.url === 'https://chatgpt.com/#settings/Billing' && !tab.active) await chrome.tabs.remove(tabId).catch(() => {});
    }
  }
}

async function ensureAlarm(settings) {
  await chrome.alarms.clear(ALARM_NAME);
  await chrome.alarms.create(ALARM_NAME, {
    delayInMinutes: 1,
    periodInMinutes: settings.pollMinutes
  });
}

// Merge only appearance inside the mutation queue. Do not interrupt polling,
// reschedule alarms, or write a stale copy of the popup's account preferences.
async function saveTheme(theme) {
  await ensureSecurity();
  return mutate(async () => {
    const settings = { ...await loadSettings(), theme };
    await chrome.storage.local.set({ settings, appearanceTheme: theme });
    return settings;
  });
}

async function getToken(signal) {
  for (const url of SESSION_URLS) {
    try {
      signal.throwIfAborted();
      const data = await RadarSecurity.fetchData(url, { account: true, signal });
      const token = data?.accessToken || data?.access_token || data?.session?.accessToken || null;
      if (RadarSecurity.validToken(token)) return token;
    } catch {
      signal.throwIfAborted();
    }
  }
  return null;
}

function trustedChatGptFetch(url, token, signal) {
  if (![USAGE_URL, CREDITS_URL].includes(url)) throw new Error("Untrusted endpoint");
  return RadarSecurity.fetchData(url, { account: true, token, signal });
}

async function refreshAccount({ quiet = false } = {}) {
  await ensureSecurity();
  await mutations;
  if (accountJob) return accountJob;
  accountJob = runAccountRefresh(quiet).finally(() => { accountJob = null; });
  return accountJob;
}

async function runAccountRefresh(quiet) {
  const epoch = stateEpoch;
  const settings = await loadSettings();
  if (!settings.monitorAccount || epoch !== stateEpoch) return { ok: true, skipped: true };
  const controller = new AbortController();
  activeRequests.add(controller);
  try {
    const token = await getToken(controller.signal);
    controller.signal.throwIfAborted();
    const [usageResult, creditsResult] = await Promise.allSettled([
      trustedChatGptFetch(USAGE_URL, token, controller.signal),
      trustedChatGptFetch(CREDITS_URL, token, controller.signal)
    ]);
    controller.signal.throwIfAborted();
    const usage = usageResult.status === "fulfilled"
      ? RadarUsage.normalizeUsage(usageResult.value, { source: "background" })
      : null;
    const credits = creditsResult.status === "fulfilled"
      ? RadarUsage.normalizeCredits(creditsResult.value)
      : null;
    const usageStatus = usageResult.status === "rejected" ? usageResult.reason?.status : null;
    // A quota 401 requires reauthentication even if the credits endpoint works.
    // A 403/challenge or a credits-only failure is not proof of logout.
    if (usageStatus === 401) {
      await mutate(async () => {
        if (epoch !== stateEpoch || !(await loadSettings()).monitorAccount) return;
        await purgeAccountState();
        if (epoch === stateEpoch) await chrome.storage.local.set({ accountState: { status: "signedOut", at: Date.now() } });
      });
      return { ok: false, unavailable: true, reason: "signedOut" };
    }
    const reason = usageStatus === 403 ? "accessDenied" : "unavailable";
    if (!usage && !credits) {
      const error = new Error("Account data unavailable");
      error.reason = reason;
      throw error;
    }
    return mutate(async () => {
      if (epoch !== stateEpoch || !(await loadSettings()).monitorAccount) return { ok: true, skipped: true };
      const verified = await storeAccountSnapshot(usage, credits, epoch, {
        token: usageStatus === 403 ? null : token,
        rawUsage: usageResult.status === "fulfilled" ? usageResult.value : null,
        rawCredits: creditsResult.status === "fulfilled" ? creditsResult.value : null,
        reason
      });
      return { ok: Boolean(usage), source: "background", ...verified, epoch, ...(!usage ? { reason } : {}) };
    });
  } catch (error) {
    if (epoch !== stateEpoch || controller.signal.aborted) return { ok: true, skipped: true };
    const reason = error.reason === "accessDenied" ? "accessDenied" : "unavailable";
    await mutate(async () => {
      if (epoch !== stateEpoch || !(await loadSettings()).monitorAccount) return;
      const at = Date.now();
      await chrome.storage.local.set({ accountState: { status: "error", reason, at }, accountError: { message: "Account data unavailable", reason, at } });
    });
    return { ok: false, error: "Account data unavailable", reason };
  } finally { activeRequests.delete(controller); }
}

async function storeAccountSnapshot(usage, credits, epoch, identity) {
  const current = await chrome.storage.local.get(["accountSnapshot", "signalSnapshot", "recoveryState", "recoverySalt", "resumeCheck", "creditGrantState"]);
  const settings = await loadSettings();
  let salt = current.recoverySalt;
  if (!salt && identity?.token) salt = Array.from(crypto.getRandomValues(new Uint8Array(24)), byte => byte.toString(16).padStart(2, "0")).join("");
  const key = await RadarRecovery.accountKey(identity?.token, identity?.rawUsage, salt);
  if (epoch !== stateEpoch || !settings.monitorAccount) return;
  // Credits may succeed when quota is temporarily unavailable, but a change
  // of identity/scope must first be verified by a successful quota response.
  const accountVerified = Boolean(key && (usage || current.accountSnapshot?.accountKey === key));
  const reading = credits && accountVerified ? await RadarCreditGrants.inventory(credits, identity.rawCredits, key) : null;
  const grants = reading ? RadarCreditGrants.advance(current.creditGrantState, reading, key, { notify: settings.notifyBankedReset }) : current.creditGrantState;
  // A network/session failure does not erase the last verified comparison.
  // It also cannot deliver notifications until the same identity is verified.
  const recovery = usage && key ? RadarRecovery.advance(current.recoveryState, usage, key, {
    enabled: settings.notifyAccountReset || (settings.monitorChat && settings.syncChatResetWithCodex),
    resumed: Boolean(current.resumeCheck), pollMinutes: settings.pollMinutes
  }) : current.recoveryState;
  const chatResetPatch = {};
  if (usage && key && settings.monitorChat && settings.syncChatResetWithCodex && RadarChatCounter.identity(identity.token)) {
    const fresh = RadarRecovery.currentEvents(recovery).filter(event =>
      !(current.recoveryState?.events || []).some(before => before.id === event.id));
    if (fresh.length) {
      const { chatCounterSalt, chatCounters = {} } = await chrome.storage.local.get(["chatCounterSalt", "chatCounters"]);
      const chatKey = chatCounterSalt && await RadarRecovery.accountKey(identity.token, null, chatCounterSalt);
      const usageAccount = identity.rawUsage?.account_id || identity.rawUsage?.accountId;
      // Bind to the identity of this verified quota response, never whichever
      // Chat account happens to be displayed while the request is in flight.
      if (chatKey && chatCounters[chatKey] && (!usageAccount || usageAccount === RadarChatCounter.identity(identity.token).account)) {
        let profile = chatCounters[chatKey];
        for (const event of fresh) profile = RadarChatCounter.resetAfterCodex(profile, event);
        chatResetPatch.chatCounters = { ...chatCounters, [chatKey]: profile };
      }
    }
  }
  const activeSignal = RadarSignals.isActive(current.signalSnapshot?.signal)
    ? current.signalSnapshot.signal
    : null;
  const snapshot = {
    usage: usage || null,
    credits: credits || null,
    accountKey: accountVerified ? key : null,
    updatedAt: Date.now()
  };
  const advice = RadarAdvice.make({
    usage: snapshot.usage,
    credits: snapshot.credits,
    signal: activeSignal
  });
  if (epoch !== stateEpoch) return false;
  // Commit the quota baseline and local Chat reset together so restart/retry
  // cannot repeat a reset or erase new messages after the first application.
  await chrome.storage.local.set({
    accountSnapshot: snapshot,
    accountState: { status: usage ? "connected" : "error", ...(!usage ? { reason: identity.reason } : {}), at: Date.now() },
    adviceSnapshot: advice,
    accountError: usage ? null : { message: "Account data unavailable", reason: identity.reason, at: Date.now() },
    ...(recovery ? { recoveryState: settings.notifyAccountReset ? recovery : { ...recovery, events: [] } } : {}),
    ...(salt ? { recoverySalt: salt } : {}),
    ...(grants ? { creditGrantState: grants } : {}),
    ...chatResetPatch
  });
  await updateBadge(snapshot, activeSignal, advice);
  await reconcileRecoveryNotifications(settings, epoch);
  await reconcileBankedNotifications(settings, epoch);
  if (reading && epoch === stateEpoch) await maybeNotifyBanked(grants, settings, epoch);
  if (usage && key && epoch === stateEpoch) {
    await maybeNotifyRecovery(recovery, settings, epoch);
    await chrome.storage.local.remove("resumeCheck");
    await chrome.alarms.clear(RESUME_ALARM);
  }
  if (epoch === stateEpoch) await maybeNotifyAdvice(advice, snapshot);
  return { usageVerified: Boolean(usage && key && epoch === stateEpoch), creditsVerified: Boolean(reading && epoch === stateEpoch) };
}

async function clearSignalState() {
  await chrome.storage.local.remove("publicResumeCheck");
  await chrome.alarms.clear(PUBLIC_RESUME_ALARM);
  await chrome.alarms.clear(PUBLIC_DELIVERY_ALARM);
  await chrome.storage.local.remove(["publicRetryCheck", "directXContextCache"]);
  await chrome.alarms.clear(PUBLIC_RETRY_ALARM);
  const settings = await loadSettings();
  const { accountSnapshot } = await chrome.storage.local.get("accountSnapshot");
  const snapshot = { signal: null, activeSignals: [], checkedAt: Date.now(), sources: [], itemCount: 0 };
  const advice = RadarAdvice.make({
    usage: settings.monitorAccount ? accountSnapshot?.usage : null,
    credits: settings.monitorAccount ? accountSnapshot?.credits : null,
    signal: null
  });
  await chrome.storage.local.set({ signalSnapshot: snapshot, hintSnapshot: { items: [], checkedAt: Date.now() }, scheduleSnapshot: { events: [] }, adviceSnapshot: advice, signalError: null });
  await reconcileScheduleNotifications({ events: [] }, settings, stateEpoch);
  await reconcileReportNotifications([], settings, stateEpoch);
  await updateBadge(settings.monitorAccount ? accountSnapshot : null, null, advice);
  return { ok: true, skipped: true };
}

function reclassifiedSignals(cached = [], incoming = []) {
  const now = Date.now();
  const byId = new Map();
  // A newer body replaces the old verdict even when it no longer qualifies.
  for (const item of cached) {
    if (item?.id) byId.set(item.entityId || item.id, {
      ...item,
      // Older installations have no detection timestamp; do not revive old badges.
      firstDetectedAt: item.firstDetectedAt || RadarTime.parseTimestamp(item.createdAt) || now
    });
  }
  for (const item of incoming) {
    if (item?.id) {
      const key = item.entityId || item.id;
      byId.set(key, { ...item, firstDetectedAt: byId.get(key)?.firstDetectedAt || now });
    }
  }
  const reassessed = [...byId.values()].map(item => ({
    ...item,
    assessment: RadarSignals.classify(item, {
      // Re-evaluate language at posting time, then apply the existing present-
      // time grace window. Never inherit a verdict from an older classifier.
      now: Math.min(now, RadarTime.parseTimestamp(item.createdAt) || now)
    })
  }));
  return RadarSignals.mergeActive(reassessed, [], { now });
}

async function reconcileSignalNotifications(signals, settings, epoch, reviewed = []) {
  const current = new Set((settings.monitorSignals ? signals : []).map(item => "signal:" + item.id));
  const invalid = new Set(reviewed.map(item => "signal:" + item.id).filter(id => !current.has(id)));
  const { pendingNotifications = [] } = await chrome.storage.local.get("pendingNotifications");
  if (epoch !== stateEpoch) return;
  await chrome.storage.local.set({ pendingNotifications: pendingNotifications.filter(pending =>
    !invalid.has(pending.id)
  ) });
  for (const id of invalid) {
    if (epoch !== stateEpoch) return;
    await chrome.alarms.clear("snooze:" + id);
  }
  for (const id of Object.keys(await chrome.notifications.getAll())) {
    if (epoch !== stateEpoch) return;
    if (invalid.has(id)) await chrome.notifications.clear(id);
  }
}

async function revalidateCachedSignals(epoch) {
  const settings = await loadSettings();
  const state = await chrome.storage.local.get(["signalSnapshot", "hintSnapshot", "accountSnapshot", "scheduleSnapshot"]);
  if (epoch !== stateEpoch) return;
  const cached = state.signalSnapshot?.activeSignals || (state.signalSnapshot?.signal ? [state.signalSnapshot.signal] : []);
  const schedule = settings.monitorSignals && settings.monitorLeadSource ? RadarSchedule.reconcile(state.scheduleSnapshot) : { events: [] };
  const suppressed = RadarSchedule.supersededIds(schedule);
  const activeSignals = settings.monitorSignals ? reclassifiedSignals(cached).filter(item => !suppressed.has(item.id)) : [];
  const signal = activeSignals[0] || null;
  const hints = settings.monitorSignals && settings.monitorLeadSource
    ? RadarSignals.hintCandidates([...(state.hintSnapshot?.items || []), ...cached], { limit: 100 }).filter(item => !suppressed.has(item.id)) : [];
  const reports = settings.monitorSignals && settings.monitorLeadSource ? RadarSignals.reports(state.signalSnapshot?.reports || []) : [];
  const eventBaseline = [...(state.hintSnapshot?.events || []), ...(state.hintSnapshot?.items || []), ...cached, ...(state.signalSnapshot?.reports || [])];
  const eventAlerts = settings.monitorSignals && settings.monitorLeadSource ? RadarEvents.alerts(state.hintSnapshot?.eventAlerts, eventBaseline) : { entries: {} };
  if (state.signalSnapshot || state.hintSnapshot || state.scheduleSnapshot) {
    const advice = RadarAdvice.make({ usage: settings.monitorAccount ? state.accountSnapshot?.usage : null,
      credits: settings.monitorAccount ? state.accountSnapshot?.credits : null, signal });
    await chrome.storage.local.set({
      ...(state.signalSnapshot ? { signalSnapshot: { ...state.signalSnapshot, signal, activeSignals, reports } } : {}),
      hintSnapshot: { ...state.hintSnapshot, items: hints, events: settings.monitorSignals && settings.monitorLeadSource ? RadarEvents.reconcile([], eventBaseline) : [], eventAlerts },
      scheduleSnapshot: schedule,
      adviceSnapshot: advice
    });
    await updateBadge(settings.monitorAccount ? state.accountSnapshot : null, signal, advice);
  }
  await reconcileSignalNotifications(activeSignals, settings, epoch, cached);
  await reconcileHintNotifications(hints, settings, epoch);
  await reconcileReportNotifications(reports, settings, epoch, schedule);
  await reconcileScheduleNotifications(schedule, settings, epoch);
  await reconcileEventNotifications(eventAlerts, settings, epoch);
}

async function refreshSignals({ quiet = false } = {}) {
  await ensureSecurity();
  await mutations;
  if (signalJob) return signalJob;
  signalJob = runSignalRefresh(quiet).finally(() => { signalJob = null; });
  return signalJob;
}

async function runSignalRefresh(quiet) {
  const epoch = stateEpoch;
  const settings = await loadSettings();
  if (epoch !== stateEpoch) return { ok: true, skipped: true };
  if (!settings.monitorSignals) return mutate(clearSignalState);
  // Persist the missed-check boundary before any network/partial scan can
  // replace checkedAt. This also survives service-worker termination.
  await preparePublicResume({ onlyIfDelayed: true });
  if (epoch !== stateEpoch) return { ok: true, skipped: true };
  const controller = new AbortController();
  activeRequests.add(controller);
  try {
    const sources = [...RadarSources.enabled(settings)];
    if (settings.monitorLeadSource && settings.monitorDirectX) sources.push({ id: "x-direct", label: "OpenAI · Tibo · VB · X 직접 확인", kind: "x-page", weight: 1 });
    if (!sources.length) return mutate(clearSignalState);
    const results = await Promise.allSettled(sources.map(async (source) => {
      if (source.kind === "x-page") {
        const { directXContextCache = {} } = await chrome.storage.local.get("directXContextCache");
        const direct = await RadarDirectX.read(controller.signal, { contextCache: directXContextCache });
        return { source, items: Array.isArray(direct) ? direct : direct.items, diagnostics: direct.diagnostics || null, contextCache: direct.contextCache };
      }
      const expectsHtml = source.kind === "reset-tracker-html";
      const payload = await RadarSecurity.fetchData(source.url, { signal: controller.signal, html: expectsHtml });
      return { source, items: RadarSources.normalize(payload, source) };
    }));
    const successful = results.filter((result) => result.status === "fulfilled").map((result) => result.value);
    if (!successful.length) throw new Error("All public signal sources are unavailable");
    const items = successful.flatMap((result) => result.items);
    return mutate(async () => {
      if (epoch !== stateEpoch) return { ok: true, skipped: true };
      const currentSettings = await loadSettings();
      if (!currentSettings.monitorSignals) return { ok: true, skipped: true };
      const state = await chrome.storage.local.get(["seenSignalIds", "accountSnapshot", "signalSnapshot", "hintSnapshot", "scheduleSnapshot", "publicResumeCheck", "publicAlertState"]);
      const leadResults = successful.filter(result => ["codex-lead", "x-direct"].includes(result.source.id));
      const latestPostAt = Math.max(0, ...leadResults.flatMap(result => result.items
        .filter(item => String(item.author || "").replace(/^@/, "").toLowerCase().match(/^(thsottiaux|reach_vb|openai)$/))
        .map(item => RadarTime.parseTimestamp(item.createdAt) || 0)
        .filter(at => at <= Date.now() + 300000)));
      const directOk = leadResults.some(result => result.source.id === "x-direct");
      const directIndex = sources.findIndex(source => source.id === "x-direct");
      const directResult = results[directIndex];
      const directError = directResult?.status === "rejected" ? RadarDirectX.failureReason(directResult.reason) : null;
      const directScan = leadResults.find(result => result.source.id === "x-direct")?.diagnostics || null;
      const leadVerified = latestPostAt > 0 && Date.now() - latestPostAt <= 3 * 86400000;
      // A fresh post from one person/feed cannot certify the other timelines.
      const collectionVerified = leadVerified && (!settings.monitorDirectX || (directOk &&
        directScan?.timelines?.length === RadarDirectX.AUTHORS.length * 2 && directScan.timelines.every(t => t.ok) &&
        !directScan.timelines.some(t => ['time-budget', 'scan-limit', 'post-limit'].includes(t.stopReason)) &&
        !directScan.conversationFailures && !directScan.contextPending));
      const catchUp = Boolean(state.publicResumeCheck);
      const seen = new Set(state.seenSignalIds || []);
      const existingSignals = state.signalSnapshot?.activeSignals ||
        (state.signalSnapshot?.signal ? [state.signalSnapshot.signal] : []);
      const publicAlertState = RadarPublicAlerts.observe(state.publicAlertState, items, {
        knownIds: [...seen, ...existingSignals.map(item => item.id), ...(state.hintSnapshot?.items || []).map(item => item.id),
          ...(state.signalSnapshot?.reports || []).map(item => item.id)],
        catchUpSince: catchUp ? state.publicResumeCheck?.since ?? state.signalSnapshot?.checkedAt ?? null : null,
        // Recovery is complete only after collection, not at Chrome startup.
        catchUpUntil: state.publicResumeCheck?.collectedAt || Date.now()
      });
      // Seed old installations from their still-cached evidence, then process
      // the fetched posts in publication order before choosing active signals.
      const schedule = currentSettings.monitorLeadSource ? RadarSchedule.reconcile(state.scheduleSnapshot,
        [...existingSignals, ...(state.hintSnapshot?.items || []), ...items]) : { events: [] };
      const suppressed = RadarSchedule.supersededIds(schedule);
      const activeSignals = reclassifiedSignals(existingSignals, items).filter(item => !suppressed.has(item.id));
      const signal = activeSignals[0] || null;
      const hints = currentSettings.monitorLeadSource ? RadarSignals.hintCandidates([...(state.hintSnapshot?.items || []), ...items].filter(item => !suppressed.has(item.id)), { limit: 100 }) : [];
      const reports = currentSettings.monitorLeadSource ? RadarSignals.reports([...(state.signalSnapshot?.reports || []), ...items]) : [];
      const eventBaseline = [...(state.hintSnapshot?.events || []), ...(state.hintSnapshot?.items || []), ...existingSignals, ...(state.signalSnapshot?.reports || [])];
      const eventAlerts = currentSettings.monitorLeadSource ? RadarEvents.alerts(state.hintSnapshot?.eventAlerts, eventBaseline, items) : { entries: {} };
      const nextSeen = [...new Set([...seen, ...items.map((item) => item.id)])].slice(-300);
      const snapshot = {
        signal,
        activeSignals,
        reports,
        checkedAt: Date.now(),
        leadStatus: { state: !settings.monitorLeadSource ? "off" : leadVerified ? "ok" : latestPostAt ? "stale" : "unavailable",
          latestPostAt: latestPostAt || null, directEnabled: settings.monitorDirectX, directOk,
          directError, directScan, collectionVerified,
          mode: directOk ? "x-page" : "feed" },
        sources: results.map((result, index) => ({
          id: sources[index].id,
          label: sources[index].label,
          weight: sources[index].weight,
          ok: result.status === "fulfilled",
          itemCount: result.status === "fulfilled" ? result.value.items.length : 0
        })),
        itemCount: items.length
      };
      const advice = RadarAdvice.make({
        usage: currentSettings.monitorAccount ? state.accountSnapshot?.usage : null,
        credits: currentSettings.monitorAccount ? state.accountSnapshot?.credits : null,
        signal
      });
      await chrome.storage.local.set({
        signalSnapshot: snapshot,
        publicAlertState,
        // Once a fresh lead source responds, later ordinary posts must not
        // bypass quiet hours just because another timeline is still pending.
        ...(state.publicResumeCheck && leadVerified && !collectionVerified && !state.publicResumeCheck.collectedAt ?
          { publicResumeCheck: { ...state.publicResumeCheck, collectedAt: Date.now() } } : {}),
        ...(leadResults.find(result => result.source.id === 'x-direct')?.contextCache ?
          { directXContextCache: leadResults.find(result => result.source.id === 'x-direct').contextCache } : {}),
        hintSnapshot: { items: hints, events: currentSettings.monitorLeadSource ? RadarEvents.reconcile(eventBaseline, items) : [], eventAlerts, checkedAt: Date.now() },
        scheduleSnapshot: schedule,
        seenSignalIds: nextSeen,
        adviceSnapshot: advice,
        signalError: null
      });
      if (collectionVerified) {
        await chrome.storage.local.remove("publicResumeCheck");
        await chrome.alarms.clear(PUBLIC_RESUME_ALARM);
        await chrome.storage.local.remove("publicRetryCheck");
        await chrome.alarms.clear(PUBLIC_RETRY_ALARM);
      } else if (settings.monitorDirectX && !state.publicResumeCheck && !['login', 'permission'].includes(directError)) {
        await schedulePublicRetry();
      }
      await reconcileSignalNotifications(activeSignals, currentSettings, epoch, [...existingSignals, ...items]);
      await reconcileScheduleNotifications(schedule, currentSettings, epoch);
      for (const change of RadarSchedule.changes(schedule)) await maybeNotifySchedule(change, epoch);
      for (const candidate of activeSignals) {
        if (epoch !== stateEpoch) break;
        await maybeNotifySignal(candidate);
      }
      await reconcileHintNotifications(hints, currentSettings, epoch);
      await reconcileReportNotifications(reports, currentSettings, epoch, schedule);
      for (const report of reports) {
        if (epoch !== stateEpoch) break;
        await maybeNotifyReport(report, currentSettings, epoch, schedule);
      }
      for (const hint of hints) {
        if (epoch !== stateEpoch) break;
        await maybeNotifyHint(hint, epoch);
      }
      await reconcileEventNotifications(eventAlerts, currentSettings, epoch);
      for (const notice of RadarEvents.notices(eventAlerts)) await maybeNotifyEvent(notice, currentSettings, epoch);
      await updateBadge(currentSettings.monitorAccount ? state.accountSnapshot : null, signal, advice);
      return { ok: true, signal: Boolean(signal), leadVerified, collectionVerified, directOk, directError, directScan, catchUp, epoch };
    });
  } catch (error) {
    if (epoch !== stateEpoch || controller.signal.aborted) return { ok: true, skipped: true };
    await mutate(async () => {
      if (epoch !== stateEpoch) return;
      // A failed feed is not a retraction. Retain its still-current evidence,
      // while letting the ordinary timestamp gate remove expired candidates.
      await revalidateCachedSignals(epoch);
      if (epoch === stateEpoch) await chrome.storage.local.set({ signalError: { message: "Public sources unavailable", at: Date.now() } });
      if (epoch === stateEpoch && settings.monitorDirectX && settings.monitorLeadSource) await schedulePublicRetry();
    });
    return { ok: false, error: "Public sources unavailable" };
  } finally { activeRequests.delete(controller); }
}

function confidenceAllowed(confidence, threshold) {
  if (threshold === "all") return true;
  if (threshold === "medium") return confidence === "high" || confidence === "medium";
  return confidence === "high";
}

function reportNotificationOptions(report) {
  return { title: report.assessment.report === 'credit-grant' ? RadarSignals.authorName(report) + ' · Banked reset 지급 공지' : report.assessment.report === 'reset-update' ? RadarSignals.authorName(report) + ' · 리셋 후속 안내' : RadarSignals.resetKind(report) === 'ordinary' ? RadarSignals.authorName(report) + ' · 일반 리셋 완료 공지' : RadarSignals.authorName(report) + ' · 리셋 완료 공지 (종류 미확인)',
    message: `${RadarTime.formatDateTime(report.createdAt, 'Asia/Seoul', 'ko-KR')} 게시 · ${report.assessment.reason}. 원문과 내 계정 잔여량을 확인하세요.`,
    buttons: [{ title: '원문 보기' }] };
}

function reportNotificationEnabled(report, settings, schedule, pending = []) {
  if (!settings.monitorSignals || !settings.monitorLeadSource || !settings.notifyOfficialReset) return false;
  // Prefer the linked schedule notice, which also explains the old forecast.
  // Keep the follow-up route when schedule alerts are disabled or too old.
  return !RadarSchedule.changes(schedule).some(change => change.post.id === report.id &&
    scheduleNotificationEnabled(change, settings) && (Date.now() - RadarTime.parseTimestamp(change.post.createdAt) <= 12 * 3600000 ||
      pending.some(item => item.id === RadarSchedule.notificationId(change))));
}

async function reconcileReportNotifications(reports, settings, epoch, schedule) {
  const { pendingNotifications = [] } = await chrome.storage.local.get('pendingNotifications');
  if (epoch !== stateEpoch) return;
  const valid = new Map(reports.filter(item => reportNotificationEnabled(item, settings, schedule, pendingNotifications)).map(item => ['report:' + item.id, item]));
  await chrome.storage.local.set({ pendingNotifications: pendingNotifications.flatMap(pending => !pending.id.startsWith('report:') ? [pending] :
    valid.has(pending.id) ? [{ ...pending, options: { ...pending.options, ...reportNotificationOptions(valid.get(pending.id)) } }] : []) });
  for (const id of Object.keys(await chrome.notifications.getAll())) {
    if (epoch !== stateEpoch) return;
    if (id.startsWith('report:') && !valid.has(id)) await chrome.notifications.clear(id);
  }
}

function publicResumeBypassesQuiet(item, state, settings) {
  const entry = state?.entries?.[item?.id];
  // Delivery retries retain their original recovery authorization and expiry;
  // a later ordinary poll must not silently turn them into quiet-hours waits.
  return Boolean(settings.notifyPublicOnResume && entry?.catchUp && entry.expiresAt > Date.now());
}

async function maybeNotifyReport(report, settings, epoch, schedule) {
  const id = 'report:' + report.id;
  const { notificationHistory = {}, publicAlertState, pendingNotifications = [] } = await chrome.storage.local.get(['notificationHistory', 'publicAlertState', 'pendingNotifications']);
  if (epoch !== stateEpoch || !reportNotificationEnabled(report, settings, schedule, pendingNotifications) || !RadarPublicAlerts.allowed(report, publicAlertState, notificationHistory)) return;
  await createNotification(id, reportNotificationOptions(report), settings, { bypassQuiet: publicResumeBypassesQuiet(report, publicAlertState, settings) });
}

function scheduleNotificationEnabled(change, settings) {
  return settings.monitorSignals && settings.monitorLeadSource && settings.notifyScheduleChanges &&
    (change.kind === "hint" ? settings.notifyHints : settings.notifyOfficialReset);
}

function scheduleNotificationOptions(change) {
  const association = change.association === "inferred" ? "이전 예고와의 연결은 추정입니다. " : "";
  return {
    title: change.label + (change.association === "inferred" ? " · 연결 추정" : ""),
    message: association + (change.kind === "hint" ? "암시 후보에 대한 변경이며 리셋 확정은 아닙니다. " : "") +
      "이전 시간 예상은 중단했습니다. 변경 글: " + change.post.text.slice(0, 180),
    buttons: [{ title: "변경 글 보기" }, { title: "이전 글 보기" }]
  };
}

async function reconcileScheduleNotifications(schedule, settings, epoch) {
  const { pendingNotifications = [], notificationHistory = {} } = await chrome.storage.local.get(["pendingNotifications", "notificationHistory"]);
  if (epoch !== stateEpoch) return;
  const current = new Map(RadarSchedule.changes(schedule).filter(change => scheduleNotificationEnabled(change, settings) &&
    !schedulePostAlreadyNotified(change, notificationHistory)).map(change => [RadarSchedule.notificationId(change), change]));
  await chrome.storage.local.set({ pendingNotifications: pendingNotifications.flatMap(pending => {
    if (!pending.id.startsWith("schedule:")) return [pending];
    const change = current.get(pending.id);
    return change ? [{ ...pending, options: { ...pending.options, ...scheduleNotificationOptions(change) } }] : [];
  }) });
  for (const id of Object.keys(await chrome.notifications.getAll())) {
    if (epoch !== stateEpoch) return;
    if (id.startsWith("schedule:") && !current.has(id)) await chrome.notifications.clear(id);
  }
}

function schedulePostAlreadyNotified(change, notificationHistory) {
  const keys = RadarPublicAlerts.notificationKeys(change.post.id, Object.keys(notificationHistory));
  // Discovering a prior announcement later must not repeat a delivered post.
  // A later revision of this schedule (including an edit of the original
  // announcement) can still notify once under its own fingerprint.
  return change.post.id !== change.original.id && keys.some(key => !key.startsWith('schedule:') && notificationHistory[key]) &&
    !keys.some(key => key.startsWith('schedule:') && notificationHistory[key]);
}

async function maybeNotifySchedule(change, epoch) {
  const settings = await loadSettings();
  if (epoch !== stateEpoch || !scheduleNotificationEnabled(change, settings)) return;
  if (Date.now() - RadarTime.parseTimestamp(change.post.createdAt) > 12 * 3600000) return;
  const id = RadarSchedule.notificationId(change);
  const { notificationHistory = {}, publicAlertState } = await chrome.storage.local.get(["notificationHistory", "publicAlertState"]);
  if (epoch !== stateEpoch || notificationHistory[id] || !RadarPublicAlerts.allowed(change.post, publicAlertState, {}, { queued: true })) return;
  if (schedulePostAlreadyNotified(change, notificationHistory)) return;
  await createNotification(id, scheduleNotificationOptions(change), settings,
    { bypassQuiet: publicResumeBypassesQuiet(change.post, publicAlertState, settings) });
  const delivered = (await chrome.storage.local.get('notificationHistory')).notificationHistory || {};
  // Keep only the latest 100 schedule revision keys; preserve other dedupes.
  const entries = Object.entries(delivered).filter(([key]) => key.startsWith("schedule:"))
    .sort((a, b) => b[1] - a[1]);
  for (const [key] of entries.slice(100)) delete delivered[key];
  await chrome.storage.local.set({ notificationHistory: delivered });
}

function hintNotificationOptions(hint) {
  const timed = ["product-time", "schedule-time"].includes(hint.assessment.rule);
  return {
    title: RadarSignals.authorName(hint) + (hint.assessment.topic ? " 출시·행사 소식 · 리셋 미확인" : timed ? " 일정 후보 · 리셋 미확인" : " 리셋 암시 후보 · 미확인"),
    message: `${RadarNews.schedule(hint).text.replace(/\n/g, ' → ') || '일정 미정'} · ${hint.assessment.reason}. 리셋 확정이 아닙니다. 원문과 실제 잔여량을 확인하세요.`,
    buttons: [{ title: "원문 보기" }]
  };
}

async function reconcileHintNotifications(hints, settings, epoch) {
  const current = new Map((settings.monitorSignals && settings.monitorLeadSource && settings.notifyHints ? hints : [])
    .filter(hint => hint.assessment?.topic !== 'event')
    .map(hint => ["hint:" + hint.id, hint]));
  const { pendingNotifications = [] } = await chrome.storage.local.get("pendingNotifications");
  if (epoch !== stateEpoch) return;
  await chrome.storage.local.set({
    pendingNotifications: pendingNotifications.flatMap(pending => {
      if (!pending.id.startsWith("hint:")) return [pending];
      const hint = current.get(pending.id);
      return hint ? [{ ...pending, options: { ...pending.options, ...hintNotificationOptions(hint) } }] : [];
    })
  });
  const visible = await chrome.notifications.getAll();
  for (const id of Object.keys(visible)) {
    if (epoch !== stateEpoch) return;
    if (id.startsWith("hint:") && !current.has(id)) await chrome.notifications.clear(id);
  }
}

async function maybeNotifyHint(hint, epoch = stateEpoch) {
  const settings = await loadSettings();
  const assessment = RadarSignals.classifyHint(hint);
  if (epoch !== stateEpoch || !settings.monitorSignals || !settings.monitorLeadSource || !settings.notifyHints || !assessment.candidate || assessment.topic === 'event') return;
  const id = "hint:" + hint.id;
  const { notificationHistory = {}, publicAlertState } = await chrome.storage.local.get(["notificationHistory", "publicAlertState"]);
  if (epoch !== stateEpoch || !RadarPublicAlerts.allowed(hint, publicAlertState, notificationHistory)) return;
  await createNotification(id, hintNotificationOptions({ ...hint, assessment }), settings,
    { bypassQuiet: publicResumeBypassesQuiet(hint, publicAlertState, settings) });
}

function eventNotificationOptions(notice) {
  const label = { scheduled: '행사 일정', changed: '행사 일정 변경', cancelled: '행사 취소·연기' }[notice.kind];
  return { title: notice.event.name + ' · ' + label,
    message: (notice.kind === 'cancelled' ? notice.event.item.text.slice(0, 180) : RadarEvents.describe(notice.event).slice(0, 2).join(' · ')) + ' · 리셋 확정이 아닙니다.',
    buttons: [{ title: '원문 보기' }] };
}

async function reconcileEventNotifications(state, settings, epoch) {
  const notices = new Map((settings.monitorSignals && settings.monitorLeadSource && settings.notifyHints ? RadarEvents.notices(state) : []).map(notice => [notice.id, notice]));
  const { pendingNotifications = [] } = await chrome.storage.local.get('pendingNotifications');
  if (epoch !== stateEpoch) return;
  await chrome.storage.local.set({ pendingNotifications: pendingNotifications.flatMap(pending => {
    if (!pending.id.startsWith('event:')) return [pending];
    const notice = notices.get(pending.id);
    return notice ? [{ ...pending, options: { ...pending.options, ...eventNotificationOptions(notice) } }] : [];
  }) });
  for (const id of Object.keys(await chrome.notifications.getAll())) {
    if (epoch !== stateEpoch) return;
    if (id.startsWith('event:') && !notices.has(id)) await chrome.notifications.clear(id);
  }
}

async function maybeNotifyEvent(notice, settings, epoch) {
  if (epoch !== stateEpoch || !settings.monitorSignals || !settings.monitorLeadSource || !settings.notifyHints) return;
  const { notificationHistory = {}, publicAlertState } = await chrome.storage.local.get(['notificationHistory', 'publicAlertState']);
  if (epoch !== stateEpoch || !RadarPublicAlerts.allowed(notice.event.item, publicAlertState, notificationHistory)) return;
  await createNotification(notice.id, eventNotificationOptions(notice), settings,
    { bypassQuiet: publicResumeBypassesQuiet(notice.event.item, publicAlertState, settings) });
}

function recoveryNotificationOptions(event, settings) {
  const labels = { fiveHour: "5시간", weekly: "주간" };
  const details = event.windows.map(window => {
    const rounded = Math.round(window.previousRemaining * 100) / 100;
    const before = rounded >= 100 ? "100% 미만" : `${rounded}%`;
    const remaining = window.remaining ?? 100;
    return `${labels[window.kind]} ${before} → ${Math.round(remaining * 100) / 100}%`;
  }).join(" · ");
  const at = RadarTime.formatDateTime(event.observedAt, RadarTime.resolveTimeZone(settings));
  return {
    title: event.windows.every(window => (window.remaining ?? 100) === 100)
      ? "Codex 잔여량이 100%로 리셋됐어요" : "Codex 리셋 주기 변경과 잔여량 회복을 확인했어요",
    message: `${event.catchUp ? "다시 확인한 결과: " : ""}${details}. ${at} 조회값입니다.${event.catchUp ? " 정확한 회복 시각은 알 수 없습니다." : ""}`,
    buttons: [{ title: "알림 설정" }]
  };
}

async function reconcileRecoveryNotifications(settings, epoch) {
  const { recoveryState, pendingNotifications = [], notificationHistory = {} } =
    await chrome.storage.local.get(["recoveryState", "pendingNotifications", "notificationHistory"]);
  if (epoch !== stateEpoch) return;
  const current = new Map((settings.monitorAccount && settings.notifyAccountReset ? RadarRecovery.currentEvents(recoveryState) : [])
    .map(event => [event.id, event]));
  await chrome.storage.local.set({
    pendingNotifications: pendingNotifications.flatMap(pending => {
      if (!pending.id.startsWith("recovery:")) return [pending];
      const event = current.get(pending.id);
      return event ? [{ ...pending, options: { ...pending.options, ...recoveryNotificationOptions(event, settings) } }] : [];
    }),
    notificationHistory: Object.fromEntries(Object.entries(notificationHistory)
      .filter(([id]) => !id.startsWith("recovery:") || current.has(id)))
  });
  for (const id of Object.keys(await chrome.notifications.getAll())) {
    if (epoch !== stateEpoch) return;
    if (id.startsWith("recovery:") && !current.has(id)) await chrome.notifications.clear(id);
  }
}

async function maybeNotifyRecovery(state, settings, epoch) {
  if (!settings.monitorAccount || !settings.notifyAccountReset) return;
  for (const event of RadarRecovery.currentEvents(state)) {
    const { notificationHistory = {} } = await chrome.storage.local.get("notificationHistory");
    if (epoch !== stateEpoch) return;
    if (notificationHistory[event.id]) continue;
    // The event was persisted with its baseline first. If Chrome rejects the
    // notification, a later successful account poll can retry it.
    try {
      await createNotification(event.id, recoveryNotificationOptions(event, settings), settings,
        { bypassQuiet: Boolean(event.catchUp && settings.notifyRecoveryOnResume) });
    } catch { /* Leave the recovery event undelivered for the next poll. */ }
  }
}

function bankedNotificationOptions(event) {
  return {
    title: msg("bankedArrivalTitle", String(event.added), "Banked reset +$1"),
    message: msg("bankedArrivalMessage", [String(event.added), String(event.availableCount)],
      "$1 new banked reset credit(s) detected in your account · $2 available when checked. Quota refreshes when you use a credit."),
    buttons: [{ title: msg("notificationSettings", undefined, "Notification settings") }]
  };
}

async function reconcileBankedNotifications(settings, epoch) {
  const { creditGrantState, pendingNotifications = [], notificationHistory = {} } =
    await chrome.storage.local.get(["creditGrantState", "pendingNotifications", "notificationHistory"]);
  if (epoch !== stateEpoch) return;
  const current = new Map((settings.monitorAccount && settings.notifyBankedReset ?
    RadarCreditGrants.currentEvents(creditGrantState).filter(event => event.notify) : []).map(event => [event.id, event]));
  await chrome.storage.local.set({
    pendingNotifications: pendingNotifications.flatMap(pending => {
      if (!pending.id.startsWith("banked:")) return [pending];
      const event = current.get(pending.id);
      return event ? [{ ...pending, options: { ...pending.options, ...bankedNotificationOptions(event) } }] : [];
    }),
    notificationHistory: Object.fromEntries(Object.entries(notificationHistory)
      .filter(([id]) => !id.startsWith("banked:") || current.has(id)))
  });
  for (const id of Object.keys(await chrome.notifications.getAll())) {
    if (epoch !== stateEpoch) return;
    if (id.startsWith("banked:") && !current.has(id)) await chrome.notifications.clear(id);
  }
}

async function maybeNotifyBanked(state, settings, epoch) {
  if (!settings.monitorAccount || !settings.notifyBankedReset) return;
  for (const event of RadarCreditGrants.currentEvents(state).filter(event => event.notify)) {
    const { notificationHistory = {} } = await chrome.storage.local.get("notificationHistory");
    if (epoch !== stateEpoch) return;
    if (notificationHistory[event.id]) continue;
    try { await createNotification(event.id, bankedNotificationOptions(event), settings); }
    catch { /* The durable queue is retried after a verified account reading. */ }
  }
}

function notificationOptions(options) {
  const normalized = {
    contextMessage: "Codex 리셋 레이더",
    priority: 2,
    ...options,
    // Only bundled PNG data is used, including when replaying older queues.
    iconUrl: RadarNotificationIcon,
    type: "basic",
    silent: false
  };
  delete normalized.imageUrl;
  delete normalized.appIconMaskUrl;
  if (Array.isArray(normalized.buttons)) normalized.buttons = normalized.buttons.slice(0, 2).map(button => ({ title: button.title }));
  return normalized;
}

function notificationFailure(error) {
  return /Unable to download all specified images/i.test(String(error?.message || "")) ? "image" : "unavailable";
}

async function recordNotificationDelivery(status, id, reason) {
  // Keep real delivery separate: a test must not hide a failed automatic alert.
  try {
    const delivery = {
      status, reason: reason || null, at: Date.now(), version: NOTIFICATION_BUILD,
      test: id === "radar-test"
    };
    await chrome.storage.local.set({ notificationDelivery: delivery,
      ...(delivery.test ? {} : { notificationRealDelivery: delivery }) });
  } catch { /* Diagnostics must never prevent delivery. */ }
}

async function deliverNotification(id, options) {
  try {
    await chrome.notifications.create(id, notificationOptions(options));
    await recordNotificationDelivery("accepted", id);
  } catch (error) {
    await recordNotificationDelivery("failed", id, notificationFailure(error));
    throw error;
  }
}

async function notificationStatus() {
  const [permission, data] = await Promise.all([
    chrome.notifications.getPermissionLevel(),
    chrome.storage.local.get(["settings", "notificationDelivery", "notificationRealDelivery", "pendingNotifications",
      "notificationHistory", "publicAlertState", "signalSnapshot", "hintSnapshot"])
  ]);
  const settings = RadarSettings.sanitize(data.settings);
  const pending = data.pendingNotifications || [];
  const history = data.notificationHistory || {};
  const publicAlerts = { handled: 0, pending: 0, expired: 0, disabled: 0, eligible: 0 };
  const candidates = [...(data.signalSnapshot?.activeSignals || []), ...(data.signalSnapshot?.reports || []),
    ...(data.hintSnapshot?.items || []).filter(item => item.assessment?.topic !== 'event'),
    ...RadarEvents.notices(data.hintSnapshot?.eventAlerts).map(notice => ({ ...notice.event.item, assessment: { candidate: true } }))];
  for (const item of new Map(candidates.map(item => [item.id, item])).values()) {
    const keys = RadarPublicAlerts.notificationKeys(item.id, [...Object.keys(history), ...pending.map(item => item.id)]);
    if (pending.some(item => keys.includes(item.id))) publicAlerts.pending++;
    else if (keys.some(key => history[key])) publicAlerts.handled++;
    else if (!RadarPublicAlerts.allowed(item, data.publicAlertState)) publicAlerts.expired++;
    else if (!settings.monitorSignals || !settings.monitorLeadSource ||
      !(item.assessment?.candidate ? settings.notifyHints : settings.notifyOfficialReset)) publicAlerts.disabled++;
    else publicAlerts.eligible++;
  }
  return { ok: true, version: NOTIFICATION_BUILD, permission, delivery: data.notificationDelivery || null,
    realDelivery: data.notificationRealDelivery || (data.notificationDelivery?.test === false ? data.notificationDelivery : null),
    publicAlerts, publicCheckedAt: data.signalSnapshot?.checkedAt || null,
    hintAlerts: Boolean(settings.monitorSignals && settings.monitorLeadSource && settings.notifyHints),
    quiet: RadarTime.isQuietHours(settings), pending: (data.pendingNotifications || []).length };
}

async function queueNotification(id, options, accountKey = null) {
  const { pendingNotifications = [] } = await chrome.storage.local.get("pendingNotifications");
  if (pendingNotifications.some(item => item.id === id)) {
    await chrome.storage.local.set({ pendingNotifications: pendingNotifications.map(item => item.id === id ? { ...item, options } : item) });
    return false;
  }
  await chrome.storage.local.set({
    pendingNotifications: [...pendingNotifications.filter(item => item.id !== id),
      { id, options, queuedAt: Date.now(), ...(accountKey ? { accountKey } : {}) }].slice(-100)
  });
  return true;
}

async function acknowledgeNotification(id) {
  const { pendingNotifications = [], notificationHistory = {} } = await chrome.storage.local.get(['pendingNotifications', 'notificationHistory']);
  await chrome.storage.local.set({
    notificationHistory: { ...notificationHistory, [id]: Date.now() },
    pendingNotifications: pendingNotifications.filter(item => item.id !== id)
  });
}

async function retryPublicDelivery(id) {
  if (!RadarPublicAlerts.publicId(id)) return;
  // Network collection and desktop delivery have independent lifecycles.
  // Retry a rejected toast even after the wake-up scan has completed, with
  // bounded backoff; ordinary polling can still retry the durable queue later.
  try {
    const { pendingNotifications = [] } = await chrome.storage.local.get('pendingNotifications');
    const pending = pendingNotifications.find(item => item.id === id);
    if (!pending || (pending.deliveryAttempts || 0) >= 5) return;
    const attempts = (pending.deliveryAttempts || 0) + 1;
    await chrome.storage.local.set({ pendingNotifications: pendingNotifications.map(item =>
      item.id === id ? { ...item, deliveryAttempts: attempts } : item) });
    if (attempts < 5) await chrome.alarms.create(PUBLIC_DELIVERY_ALARM,
      { delayInMinutes: [1, 2, 5, 10][attempts - 1] });
  } catch { /* The original durable entry remains for ordinary polling. */ }
}

async function createNotification(id, options, settings, { bypassQuiet = false, accountKey = null } = {}) {
  const fullOptions = notificationOptions(options);
  // Persist before any Chrome call, and keep the original age on retries.
  if (!await queueNotification(id, fullOptions, accountKey)) return;
  if (!bypassQuiet && RadarTime.isQuietHours(settings)) return;
  try {
    await deliverNotification(id, fullOptions);
    await acknowledgeNotification(id);
  }
  catch {
    // The durable queue remains intact, including if acknowledging failed.
    // A data fetch must not be reported as failed because delivery failed.
    await retryPublicDelivery(id);
  }
}

async function testNotification() {
  try {
    if (await chrome.notifications.getPermissionLevel() === "denied") {
      await recordNotificationDelivery("failed", "radar-test", "denied");
      return { ok: false, reason: "denied", version: NOTIFICATION_BUILD };
    }
    await chrome.notifications.clear("radar-test");
    await deliverNotification("radar-test", {
      title: "Codex 리셋 레이더 · 테스트 알림",
      message: "알림 표시 확인용입니다. 실제 리셋 감지 알림이 아닙니다."
    });
    return { ok: true, version: NOTIFICATION_BUILD };
  } catch (error) {
    return { ok: false, reason: notificationFailure(error), version: NOTIFICATION_BUILD };
  }
}

async function maybeNotifySignal(signal) {
  const settings = await loadSettings();
  if (!settings.monitorSignals || !settings.notifyOfficialReset || !confidenceAllowed(signal.assessment.confidence, settings.confidenceThreshold)) return;
  const dedupeKey = `signal:${signal.id}`;
  const { notificationHistory = {}, publicAlertState } = await chrome.storage.local.get(["notificationHistory", "publicAlertState"]);
  if (!RadarPublicAlerts.allowed(signal, publicAlertState, notificationHistory)) return;
  const timeZone = RadarTime.resolveTimeZone(settings);
  const timing = signal.assessment.eventAt
    ? RadarTime.formatDateTime(signal.assessment.eventAt, timeZone)
    : msg("timePending", undefined, "time pending");
  await createNotification(dedupeKey, {
    title: msg("notificationPossibleResetTitle", timing, "Codex quota may reset at $1"),
    message: msg("notificationPossibleResetMessage", undefined, "A high-confidence public signal was detected. Use remaining quota first and hold reset credits."),
    buttons: [
      { title: msg("viewEvidence", undefined, "View evidence") },
      { title: msg("remindLater", undefined, "Remind me later") }
    ]
  }, settings, { bypassQuiet: publicResumeBypassesQuiet(signal, publicAlertState, settings) });
}

function expiryNotificationId(accountKey, nearest) {
  return `expiry:${accountKey.slice(0, 16)}:${Math.floor(nearest / 3600000)}`;
}

function adviceNotificationId(accountKey, tier) {
  return `advice:${accountKey.slice(0, 16)}:${tier}:${Math.floor(Date.now() / 21600000)}`;
}

function expiryNotificationOptions(snapshot, nearest) {
  return {
    title: msg("notificationCreditExpiresTitle", RadarTime.relativeDuration(nearest), "A reset credit expires $1"),
    message: msg("notificationCreditExpiresMessage", String(RadarUsage.findWindow(snapshot.usage, "weekly")?.remainingPercent ?? "--"), "$1% weekly quota remains. Consider using the credit if a long task still needs work today."),
    buttons: [
      { title: msg("viewAdvice", undefined, "View advice") },
      { title: msg("dismissThisTime", undefined, "Dismiss this time") }
    ]
  };
}

function adviceNotificationOptions(advice) {
  return { title: advice.title, message: advice.message,
    buttons: [{ title: msg("viewAdvice", undefined, "View advice") }] };
}

async function maybeNotifyAdvice(advice, snapshot) {
  const settings = await loadSettings();
  if (!settings.monitorAccount || !snapshot.accountKey) return;
  const nearest = RadarUsage.nearestExpiry(snapshot.credits);
  const hours = nearest ? (nearest - Date.now()) / 3600000 : Infinity;
  if (settings.notifyCreditExpiry && snapshot.credits?.availableCount > 0 && hours > 0 && hours <= settings.expiryWarningHours) {
    const key = expiryNotificationId(snapshot.accountKey, nearest);
    const { notificationHistory = {} } = await chrome.storage.local.get("notificationHistory");
    if (!notificationHistory[key]) {
      await createNotification(key, expiryNotificationOptions(snapshot, nearest), settings, { accountKey: snapshot.accountKey });
    }
  }
  if (settings.notifyAdvice && ["blocked", "useIfBlocked"].includes(advice.tier)) {
    const key = adviceNotificationId(snapshot.accountKey, advice.tier);
    const { notificationHistory = {} } = await chrome.storage.local.get("notificationHistory");
    if (!notificationHistory[key]) {
      await createNotification(key, adviceNotificationOptions(advice), settings, { accountKey: snapshot.accountKey });
    }
  }
}

async function acknowledgeVisibleBadges(receipt) {
  return mutate(async () => {
    const settings = await loadSettings();
    const state = await chrome.storage.local.get(["creditGrantState", "signalSnapshot", "hintSnapshot", "scheduleSnapshot", "publicAlertState", "accountSnapshot", "adviceSnapshot"]);
    const updates = RadarBadge.acknowledge(state, settings, receipt);
    if (Object.keys(updates).length) await chrome.storage.local.set(updates);
    await updateBadge(settings.monitorAccount ? state.accountSnapshot : null,
      settings.monitorSignals ? state.signalSnapshot?.signal : null, state.adviceSnapshot);
    return { ok: true };
  });
}

async function updateBadge(accountSnapshot, signal, advice) {
  const weekly = RadarUsage.findWindow(accountSnapshot?.usage, "weekly");
  const now = Date.now();
  const settings = await loadSettings();
  const state = await chrome.storage.local.get(["creditGrantState", "signalSnapshot", "hintSnapshot", "scheduleSnapshot", "publicAlertState"]);
  const unread = RadarBadge.view({ ...state, accountSnapshot }, settings, { signal, now });
  const freshSignal = unread.publicItems.length > 0;
  const grant = unread.bankedItems.at(-1);
  let text = weekly ? `${weekly.remainingPercent}%` : "";
  let color = "#5fb9ad";
  if (freshSignal || grant) {
    text = weekly ? `${text}!` : grant ? "!" : "신호";
    color = grant ? "#14633e" : "#e7a93b";
  } else if (["blocked", "expiring"].includes(advice?.tier)) {
    color = "#e05f52";
  } else if (weekly && weekly.remainingPercent < 25) {
    color = "#e05f52";
  } else if (weekly && weekly.remainingPercent < 60) {
    color = "#e7a93b";
  }
  await chrome.action.setBadgeText({ text });
  await chrome.action.setBadgeBackgroundColor({ color });
  await chrome.action.setTitle({ title: "Codex 리셋 레이더" + (weekly ? ` · ${weekly.remainingPercent}%` : "") +
    (grant ? " · " + msg("bankedArrivalTitle", String(grant.added), "Banked reset +$1") : "") });
  const deadlines = unread.deadlines;
  if (deadlines.length) await chrome.alarms.create(BADGE_EXPIRY_ALARM, { when: Math.min(...deadlines) });
  else await chrome.alarms.clear(BADGE_EXPIRY_ALARM);
}

async function pollAll(options = {}) {
  const settle = promise => promise.catch(() => ({ ok: false }));
  const [account, signals, chatPlan, chatHistory] = await Promise.all([
    refreshAccount(options).then(async account => {
      await mutate(() => flushPendingNotifications({ recoveryVerified: Boolean(account.usageVerified && account.epoch === stateEpoch), creditsVerified: Boolean(account.creditsVerified && account.epoch === stateEpoch) }));
      return account;
    }),
    refreshSignals(options).then(async signals => {
      await mutate(() => flushPendingNotifications({ publicResumed: Boolean(signals.catchUp && signals.leadVerified && signals.epoch === stateEpoch) }));
      return signals;
    }),
    options.manual ? settle(refreshChatPlan()) : Promise.resolve({ ok: true, skipped: true }),
    settle(refreshChatHistory({ force: Boolean(options.manual) }))
  ]);
  await chrome.storage.local.set({ lastCheckedAt: Date.now() });
  return { ok: account.ok || signals.ok || (!chatHistory.skipped && chatHistory.ok) || (!chatPlan.skipped && chatPlan.ok), account, signals, chatPlan, chatHistory };
}

async function openEvidence(id) {
  await ensureSecurity();
  const { signalSnapshot } = await chrome.storage.local.get("signalSnapshot");
  const signal = id ? (signalSnapshot?.activeSignals || []).find(item => item.id === id) : signalSnapshot?.signal;
  const url = RadarSignals.isActive(signal) ? RadarSecurity.evidenceUrl(signal) : null;
  if (!url) return { ok: false, error: "Blocked evidence link" };
  await chrome.tabs.create({ url });
  return { ok: true };
}

async function openHint(id) {
  await ensureSecurity();
  const settings = await loadSettings();
  if (!settings.monitorSignals || !settings.monitorLeadSource) return { ok: false };
  const { hintSnapshot } = await chrome.storage.local.get("hintSnapshot");
  const hints = RadarSignals.hintCandidates(hintSnapshot?.items || [], { limit: 100 });
  const hint = id ? hints.find(item => item.id === id) : hints[0];
  const url = hint ? RadarSecurity.evidenceUrl(hint) : null;
  if (!url) return { ok: false, error: "Blocked evidence link" };
  await chrome.tabs.create({ url });
  return { ok: true };
}

async function openEvent(id) {
  await ensureSecurity();
  const settings = await loadSettings();
  if (!settings.monitorSignals || !settings.monitorLeadSource) return { ok: false };
  const { hintSnapshot } = await chrome.storage.local.get('hintSnapshot');
  const notice = RadarEvents.notices(hintSnapshot?.eventAlerts).find(notice => notice.id === id);
  const url = RadarSecurity.evidenceUrl(notice?.event.item);
  if (!url) return { ok: false };
  await chrome.tabs.create({ url });
  return { ok: true };
}

async function openReport(id) {
  await ensureSecurity();
  const settings = await loadSettings();
  if (!settings.monitorSignals || !settings.monitorLeadSource) return { ok: false };
  const { signalSnapshot } = await chrome.storage.local.get('signalSnapshot');
  const report = RadarSignals.reports(signalSnapshot?.reports || []).find(item => item.id === id);
  const url = report && RadarSecurity.evidenceUrl(report);
  if (!url) return { ok: false };
  await chrome.tabs.create({ url });
  return { ok: true };
}

async function openSchedule(id, original = false) {
  await ensureSecurity();
  const settings = await loadSettings();
  if (!settings.monitorSignals || !settings.monitorLeadSource) return { ok: false };
  const { scheduleSnapshot } = await chrome.storage.local.get("scheduleSnapshot");
  const changes = RadarSchedule.changes(scheduleSnapshot);
  const change = id ? changes.find(change => RadarSchedule.notificationId(change) === id) : changes[0];
  const url = change ? RadarSecurity.evidenceUrl(original ? change.previous : change.post) : null;
  if (!url) return { ok: false, error: "Blocked evidence link" };
  await chrome.tabs.create({ url });
  return { ok: true };
}

async function clearLocalData() {
  invalidateRequests();
  await ensureSecurity();
  return mutate(async () => {
    const settings = await loadSettings();
    // Preserve appearance without a read-clear-restore race with the popup.
    const stored = await chrome.storage.local.get(null);
    await chrome.storage.local.remove(Object.keys(stored).filter(key =>
      !["settings", "securitySchema", "chatCounterSchema", "appearanceTheme", "uiLocale"].includes(key)));
    chatBindings.clear(); chatPlanTabs.clear();
    await chrome.alarms.clear(PUBLIC_DELIVERY_ALARM);
    await chrome.storage.session.clear();
    await chrome.storage.local.set({ settings, securitySchema: SECURITY_SCHEMA });
    for (const id of Object.keys(await chrome.notifications.getAll())) await chrome.notifications.clear(id);
    await updateBadge(null, null, null);
    return { ok: true };
  });
}

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  await ensureSecurity();
  await ensureAlarm(await loadSettings());
  if ((await loadSettings()).monitorChat) {
    try { await injectChatCounter(); } catch { await chrome.storage.local.set({ chatCounterError: true }); }
  }
  if (reason === "install") await chrome.tabs.create({ url: chrome.runtime.getURL("src/welcome/welcome.html") });
  await preparePublicResume();
  await pollAll({ quiet: true });
});

chrome.runtime.onStartup.addListener(async () => {
  await ensureSecurity();
  await ensureAlarm(await loadSettings());
  await mutate(async () => {
    if ((await loadSettings()).monitorAccount) {
      await chrome.storage.local.set({ resumeCheck: { attempts: 0 } });
      await chrome.alarms.create(RESUME_ALARM, { delayInMinutes: 1 });
    }
  });
  await preparePublicResume();
  await pollAll({ quiet: true });
});

async function preparePublicResume({ onlyIfDelayed = false, scheduledTime = null } = {}) {
  await mutate(async () => {
    const settings = await loadSettings();
    if (!settings.monitorSignals || !settings.monitorLeadSource) return;
    const { signalSnapshot, publicResumeCheck } = await chrome.storage.local.get(['signalSnapshot', 'publicResumeCheck']);
    const lastCheck = signalSnapshot?.checkedAt;
    // Chrome dispatches an overdue alarm on wake without firing onStartup.
    // Allow two minutes of ordinary scheduling jitter before treating it as
    // a missed check; retain the elapsed-gap fallback for manual refreshes.
    const overdue = Number.isFinite(scheduledTime) && Date.now() - scheduledTime > 2 * 60000 &&
      (!lastCheck || lastCheck < scheduledTime);
    const gap = lastCheck && Date.now() - lastCheck > settings.pollMinutes * 2 * 60000;
    if (onlyIfDelayed && ((!overdue && !gap) || (publicResumeCheck && !publicResumeCheck.collectedAt))) return;
    const since = Math.min(publicResumeCheck?.since || Infinity, signalSnapshot?.checkedAt || Date.now() - 86400000);
    await chrome.storage.local.set({ publicResumeCheck: { attempts: 0, since } });
    await chrome.alarms.create(PUBLIC_RESUME_ALARM, { delayInMinutes: 1 });
  });
}

async function schedulePublicRetry() {
  const { publicRetryCheck, publicResumeCheck } = await chrome.storage.local.get(['publicRetryCheck', 'publicResumeCheck']);
  if (publicResumeCheck || (publicRetryCheck && (publicRetryCheck.attempts < 3 || Date.now() - publicRetryCheck.startedAt < 30 * 60000))) return;
  await chrome.storage.local.set({ publicRetryCheck: { attempts: 0, startedAt: Date.now() } });
  await chrome.alarms.create(PUBLIC_RETRY_ALARM, { delayInMinutes: 2 });
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  await ensureSecurity();
  if ([ALARM_NAME, PUBLIC_RETRY_ALARM, PUBLIC_RESUME_ALARM, RESUME_ALARM].includes(alarm.name)) {
    await preparePublicResume({ onlyIfDelayed: true, scheduledTime: alarm.scheduledTime });
  }
  if (alarm.name === BADGE_EXPIRY_ALARM) {
    await mutate(async () => {
      const settings = await loadSettings();
      const { accountSnapshot, signalSnapshot, adviceSnapshot } = await chrome.storage.local.get(["accountSnapshot", "signalSnapshot", "adviceSnapshot"]);
      await updateBadge(settings.monitorAccount ? accountSnapshot : null,
        settings.monitorSignals ? signalSnapshot?.signal : null, adviceSnapshot);
    });
  } else if (alarm.name === PUBLIC_DELIVERY_ALARM) {
    await mutate(() => flushPendingNotifications());
  } else if (alarm.name === PUBLIC_RETRY_ALARM) {
    const { publicRetryCheck } = await chrome.storage.local.get('publicRetryCheck');
    const settings = await loadSettings();
    if (!publicRetryCheck || publicRetryCheck.attempts >= 3 || !settings.monitorSignals || !settings.monitorLeadSource || !settings.monitorDirectX) return;
    await refreshSignals({ quiet: true });
    await mutate(async () => {
      const { publicRetryCheck: pending } = await chrome.storage.local.get('publicRetryCheck');
      if (!pending) return;
      const attempts = (pending.attempts || 0) + 1;
      await chrome.storage.local.set({ publicRetryCheck: { ...pending, attempts } });
      if (attempts < 3) await chrome.alarms.create(PUBLIC_RETRY_ALARM, { delayInMinutes: [2, 5, 10][attempts] });
    });
  } else if (alarm.name === PUBLIC_RESUME_ALARM) {
    const { publicResumeCheck } = await chrome.storage.local.get("publicResumeCheck");
    if (!publicResumeCheck || !(await loadSettings()).monitorSignals) return;
    const result = await refreshSignals({ quiet: true });
    await mutate(async () => {
      await flushPendingNotifications({ publicResumed: Boolean(result.catchUp && result.leadVerified && result.epoch === stateEpoch) });
      const { publicResumeCheck: pending } = await chrome.storage.local.get("publicResumeCheck");
      if (!pending || !(await loadSettings()).monitorSignals) return;
      const attempts = (pending.attempts || 0) + 1;
      await chrome.storage.local.set({ publicResumeCheck: { ...pending, attempts } });
      if (attempts < 5) await chrome.alarms.create(PUBLIC_RESUME_ALARM, { delayInMinutes: [1, 2, 5, 10, 15][attempts] });
    });
  } else if (alarm.name === RESUME_ALARM) {
    const { resumeCheck } = await chrome.storage.local.get("resumeCheck");
    if (!resumeCheck || !(await loadSettings()).monitorAccount) return;
    await pollAll({ quiet: true });
    await mutate(async () => {
      const { resumeCheck: pending } = await chrome.storage.local.get("resumeCheck");
      if (!pending || !(await loadSettings()).monitorAccount) return;
      const attempts = (pending.attempts || 0) + 1;
      await chrome.storage.local.set({ resumeCheck: { attempts } });
      if (attempts < 5) await chrome.alarms.create(RESUME_ALARM, { delayInMinutes: [1, 2, 5, 10, 15][attempts] });
    });
  } else if (alarm.name === ALARM_NAME) {
    await pollAll({ quiet: true });
  } else if (alarm.name.startsWith("snooze:signal:")) {
    await mutate(async () => {
      const settings = await loadSettings();
      if (!settings.monitorSignals || !settings.notifyOfficialReset) return;
      const { signalSnapshot } = await chrome.storage.local.get("signalSnapshot");
      const cached = signalSnapshot?.activeSignals || (signalSnapshot?.signal ? [signalSnapshot.signal] : []);
      if (!reclassifiedSignals(cached).some(signal => alarm.name === "snooze:signal:" + signal.id)) return;
      await createNotification(alarm.name.slice("snooze:".length), {
        title: msg("notificationReminderTitle", undefined, "Codex reset-signal reminder"),
        message: msg("notificationReminderMessage", undefined, "Open the extension for the latest evidence and advice."),
        buttons: [{ title: msg("viewAdvice", undefined, "View advice") }]
      }, settings);
    });
  }
});

async function flushPendingNotifications({ recoveryVerified = false, creditsVerified = false, publicResumed = false } = {}) {
  const settings = await loadSettings();
  const quiet = RadarTime.isQuietHours(settings);
  const { pendingNotifications = [], publicAlertState } = await chrome.storage.local.get(["pendingNotifications", "publicAlertState"]);
  async function release(pending) {
    if ((RadarPublicAlerts.publicId(pending.id) || /^(expiry|advice):/.test(pending.id)) &&
      pending.queuedAt && Date.now() - pending.queuedAt >= 86400000) return false;
    let bypassQuiet = false;
    if (accountNotification(pending.id) && !settings.monitorAccount) return false;
    if (/^(expiry|advice):/.test(pending.id)) {
      const expiry = pending.id.startsWith('expiry:');
      if (!(expiry ? settings.notifyCreditExpiry : settings.notifyAdvice) || !pending.accountKey) return false;
      // A public scan or failed account read must not release private guidance
      // from an earlier account or an inventory that may already be spent.
      if (!creditsVerified || (!expiry && !recoveryVerified)) return true;
      const { accountSnapshot, adviceSnapshot } = await chrome.storage.local.get(['accountSnapshot', 'adviceSnapshot']);
      if (pending.accountKey !== accountSnapshot?.accountKey) return false;
      if (expiry) {
        const nearest = RadarUsage.nearestExpiry(accountSnapshot.credits);
        const hours = nearest ? (nearest - Date.now()) / 3600000 : Infinity;
        if (!nearest || !(accountSnapshot.credits?.availableCount > 0) || hours <= 0 || hours > settings.expiryWarningHours ||
          pending.id !== expiryNotificationId(accountSnapshot.accountKey, nearest)) return false;
        pending.options = { ...pending.options, ...expiryNotificationOptions(accountSnapshot, nearest) };
      } else {
        if (!['blocked', 'useIfBlocked'].includes(adviceSnapshot?.tier) ||
          pending.id !== adviceNotificationId(accountSnapshot.accountKey, adviceSnapshot.tier)) return false;
        pending.options = { ...pending.options, ...adviceNotificationOptions(adviceSnapshot) };
      }
    }
    if (pending.id.startsWith("banked:")) {
      if (!settings.notifyBankedReset) return false;
      const { creditGrantState, accountSnapshot } = await chrome.storage.local.get(["creditGrantState", "accountSnapshot"]);
      const event = RadarCreditGrants.currentEvents(creditGrantState).find(event => event.id === pending.id && event.notify);
      if (!event) return false;
      if (!creditsVerified || accountSnapshot?.accountKey !== event.accountKey) return true;
      pending.options = { ...pending.options, ...bankedNotificationOptions(event) };
    }
    if (pending.id.startsWith("recovery:")) {
      if (!settings.notifyAccountReset) return false;
      const { recoveryState } = await chrome.storage.local.get("recoveryState");
      const event = RadarRecovery.currentEvents(recoveryState).find(event => event.id === pending.id);
      if (!event) return false;
      // A failed account query must not release a queued notification for an
      // account which may have changed while the browser was quiet/offline.
      if (!recoveryVerified) { return true; }
      bypassQuiet = Boolean(event.catchUp && settings.notifyRecoveryOnResume);
      pending.options = { ...pending.options, ...recoveryNotificationOptions(event, settings) };
    }
    if (pending.id.startsWith("signal:") && (!settings.monitorSignals || !settings.notifyOfficialReset)) return false;
    if (pending.id.startsWith("signal:")) {
      const { signalSnapshot } = await chrome.storage.local.get('signalSnapshot');
      const item = (signalSnapshot?.activeSignals || [signalSnapshot?.signal]).find(item => item && pending.id === 'signal:' + item.id);
      if (!RadarPublicAlerts.allowed(item, publicAlertState, {}, { queued: true })) return false;
      const { scheduleSnapshot } = await chrome.storage.local.get("scheduleSnapshot");
      if (RadarSchedule.supersededIds(scheduleSnapshot).has(pending.id.slice(7))) return false;
      if (publicResumed) {
        const { signalSnapshot } = await chrome.storage.local.get("signalSnapshot");
        if (!reclassifiedSignals(signalSnapshot?.activeSignals || []).some(item => pending.id === "signal:" + item.id)) return false;
      }
      bypassQuiet = publicResumeBypassesQuiet(item, publicAlertState, settings);
    }
    if (pending.id.startsWith("schedule:")) {
      const { scheduleSnapshot, notificationHistory = {} } = await chrome.storage.local.get(["scheduleSnapshot", "notificationHistory"]);
      const change = RadarSchedule.changes(scheduleSnapshot).find(change => RadarSchedule.notificationId(change) === pending.id);
      if (!change || !scheduleNotificationEnabled(change, settings) || schedulePostAlreadyNotified(change, notificationHistory) || !RadarPublicAlerts.allowed(change.post, publicAlertState, {}, { queued: true })) return false;
      pending.options = { ...pending.options, ...scheduleNotificationOptions(change) };
      bypassQuiet = publicResumeBypassesQuiet(change.post, publicAlertState, settings);
    }
    if (pending.id.startsWith("hint:")) {
      if (!settings.monitorSignals || !settings.monitorLeadSource || !settings.notifyHints) return false;
      const { hintSnapshot } = await chrome.storage.local.get("hintSnapshot");
      const hint = RadarSignals.hintCandidates(hintSnapshot?.items || [], { limit: 100 }).find(item => pending.id === "hint:" + item.id);
      if (hint?.assessment?.topic === 'event') return false;
      if (!RadarPublicAlerts.allowed(hint, publicAlertState, {}, { queued: true })) return false;
      pending.options = { ...pending.options, ...hintNotificationOptions(hint) };
      bypassQuiet = publicResumeBypassesQuiet(hint, publicAlertState, settings);
    }
    if (pending.id.startsWith('event:')) {
      if (!settings.monitorSignals || !settings.monitorLeadSource || !settings.notifyHints) return false;
      const { hintSnapshot } = await chrome.storage.local.get('hintSnapshot');
      const notice = RadarEvents.notices(hintSnapshot?.eventAlerts).find(notice => notice.id === pending.id);
      if (!notice || !RadarPublicAlerts.allowed(notice.event.item, publicAlertState, {}, { queued: true })) return false;
      pending.options = { ...pending.options, ...eventNotificationOptions(notice) };
      bypassQuiet = publicResumeBypassesQuiet(notice.event.item, publicAlertState, settings);
    }
    if (pending.id.startsWith('report:')) {
      if (!settings.monitorSignals || !settings.monitorLeadSource || !settings.notifyOfficialReset) return false;
      const { signalSnapshot, scheduleSnapshot } = await chrome.storage.local.get(['signalSnapshot', 'scheduleSnapshot']);
      const report = RadarSignals.reports(signalSnapshot?.reports || []).find(item => pending.id === 'report:' + item.id);
      if (!report || !reportNotificationEnabled(report, settings, scheduleSnapshot, pendingNotifications) || !RadarPublicAlerts.allowed(report, publicAlertState, {}, { queued: true })) return false;
      pending.options = { ...pending.options, ...reportNotificationOptions(report) };
      bypassQuiet = publicResumeBypassesQuiet(report, publicAlertState, settings);
    }
    if (quiet && !bypassQuiet) { return true; }
    pending.options = notificationOptions(pending.options);
    try {
      // A crash after Chrome accepted but before local acknowledgement must
      // not replace a still-visible notification and ring it a second time.
      const visible = await chrome.notifications.getAll();
      if (!Object.hasOwn(visible, pending.id)) await deliverNotification(pending.id, pending.options);
      await acknowledgeNotification(pending.id);
    } catch { await retryPublicDelivery(pending.id); }
    return true;
  }
  for (const pending of pendingNotifications) {
    // Keep entries durable throughout validation and delivery.
    if (await release(pending)) continue;
    const latest = await chrome.storage.local.get('pendingNotifications');
    await chrome.storage.local.set({ pendingNotifications: (latest.pendingNotifications || []).filter(item => item.id !== pending.id) });
  }
}

chrome.notifications.onClicked.addListener(id => id.startsWith('event:') ? openEvent(id) : id.startsWith('report:') ? openReport(id.slice(7)) : id.startsWith("schedule:") ? openSchedule(id) : id.startsWith("hint:") ? openHint(id.slice(5)) : id.startsWith("signal:") ? openEvidence(id.slice(7)) : chrome.runtime.openOptionsPage());
chrome.notifications.onButtonClicked.addListener(async (notificationId, buttonIndex) => {
  if (notificationId.startsWith('event:') && buttonIndex === 0) return openEvent(notificationId);
  if (notificationId.startsWith('report:') && buttonIndex === 0) return openReport(notificationId.slice(7));
  if (notificationId.startsWith("schedule:") && [0, 1].includes(buttonIndex)) return openSchedule(notificationId, buttonIndex === 1);
  if (notificationId.startsWith("hint:") && buttonIndex === 0) return openHint(notificationId.slice(5));
  if (notificationId.startsWith("signal:") && buttonIndex === 0) return openEvidence(notificationId.slice(7));
  if (notificationId.startsWith("signal:") && buttonIndex === 1) {
    await chrome.alarms.create("snooze:" + notificationId, { delayInMinutes: 60 });
    return;
  }
  if (buttonIndex === 0) await chrome.runtime.openOptionsPage();
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!RadarSecurity.allowedMessage(message, sender, chrome.runtime)) {
    sendResponse({ ok: false, error: "Unauthorized request" });
    return false;
  }
  const handle = async () => {
    // Diagnostic actions must also work when unrelated account/feed startup fails.
    if (message.type === "TEST_NOTIFICATION") return testNotification();
    if (message.type === "NOTIFICATION_STATUS") return notificationStatus();
    await ensureSecurity();
    if (message.type === "ACK_VISIBLE_BADGES") return acknowledgeVisibleBadges(message.receipt);
    if (message.type === "CHAT_COUNT_STATUS") return chatCountStatus(sender);
    if (message.type === "SET_CHAT_PLAN_CHOICE") return chooseChatPlan(message);
    if (message.type === "CHAT_COUNT_RECORD") return recordChatCount(message, sender);
    if (message.type === "CHAT_PLAN_OBSERVED") return observeChatPlan(message, sender);
    if (message.type === "REFRESH_CHAT_ACCOUNT") return { ok: (await refreshChatAccount({ force: true })).status === "connected" };
    if (message.type === "OPEN_CHAT_CONNECTION") return connectChatAccount();
    if (message.type === "SYNC_CHAT_HISTORY") return refreshChatHistory();
    if (message.type === "ENABLE_CHAT_COUNTER") {
      await saveSettings({ ...await loadSettings(), monitorChat: true });
      return connectChatAccount();
    }
    if (message.type === "SAVE_SETTINGS") {
      const settings = await saveSettings(message.settings, { connectChat: true });
      return { ok: true, settings };
    }
    if (message.type === "SAVE_THEME") return { ok: true, settings: await saveTheme(message.theme) };
    if (message.type === "CLEAR_LOCAL_DATA") return clearLocalData();
    if (message.type === "ENABLE_ACCOUNT") {
      await saveSettings({ ...await loadSettings(), monitorAccount: true });
      return { ok: true };
    }
    if (message.type === "REFRESH_NOW") return pollAll({ quiet: false, manual: true });
    if (message.type === "REFRESH_SIGNALS") {
      const result = await refreshSignals({ quiet: false });
      await mutate(() => flushPendingNotifications({ publicResumed: Boolean(result.catchUp && result.leadVerified && result.epoch === stateEpoch) }));
      return result;
    }
    if (message.type === "REFRESH_ACCOUNT") {
      const account = await refreshAccount({ quiet: false });
      await mutate(() => flushPendingNotifications({ recoveryVerified: Boolean(account.usageVerified && account.epoch === stateEpoch), creditsVerified: Boolean(account.creditsVerified && account.epoch === stateEpoch) }));
      return account;
    }
    if (message.type === "OPEN_ACCOUNT_LOGIN") {
      // Never accept a caller-provided URL or change account-monitoring consent.
      await chrome.tabs.create({ url: "https://chatgpt.com/" });
      return { ok: true };
    }
    if (message.type === "OPEN_EVIDENCE") return openEvidence();
    if (message.type === "OPEN_HINT") return openHint();
    if (message.type === "OPEN_NEWS") {
      const data = await chrome.storage.local.get(["signalSnapshot", "hintSnapshot"]);
      const entries = RadarNews.list(data.signalSnapshot, data.hintSnapshot, await loadSettings());
      const news = message.id === undefined ? entries[0] : entries.find(entry => entry.key === message.id);
      const url = RadarSecurity.evidenceUrl(news?.item);
      if (!url) return { ok: false };
      await chrome.tabs.create({ url });
      return { ok: true };
    }
    if (message.type === "OPEN_SCHEDULE_ORIGINAL") return openSchedule(null, true);
    if (message.type === "OPEN_SCHEDULE_UPDATE") return openSchedule();
    return { ok: false };
  };
  handle().then(sendResponse, () => sendResponse({ ok: false, error: "Request could not be completed" }));
  return true;
});
