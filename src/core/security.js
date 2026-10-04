(function initSecurity(root) {
  const ACCOUNT_ENDPOINTS = new Set([
    "https://chatgpt.com/api/auth/session",
    "https://chatgpt.com/backend-api/auth/session",
    "https://chatgpt.com/backend-api/wham/usage",
    "https://chatgpt.com/backend-api/wham/rate-limit-reset-credits"
  ]);
  const PAGES = {
    SAVE_SETTINGS: ["src/options/options.html"],
    SAVE_THEME: ["src/popup/popup.html"],
    ACK_VISIBLE_BADGES: ["src/popup/popup.html"],
    TEST_NOTIFICATION: ["src/options/options.html"],
    NOTIFICATION_STATUS: ["src/options/options.html"],
    CLEAR_LOCAL_DATA: ["src/options/options.html"],
    RESUME_CHECK_TABS: ["src/options/options.html"],
    ENABLE_ACCOUNT: ["src/welcome/welcome.html"],
    OPEN_ACCOUNT_LOGIN: ["src/popup/popup.html", "src/options/options.html", "src/welcome/welcome.html"],
    REFRESH_ACCOUNT: ["src/popup/popup.html", "src/options/options.html", "src/welcome/welcome.html"],
    REFRESH_NOW: ["src/popup/popup.html"],
    REFRESH_SIGNALS: ["src/popup/popup.html", "src/options/options.html"],
    OPEN_EVIDENCE: ["src/popup/popup.html"],
    OPEN_HINT: ["src/popup/popup.html"],
    OPEN_NEWS: ["src/popup/popup.html"],
    ENABLE_CHAT_COUNTER: ["src/popup/popup.html"],
    REFRESH_CHAT_ACCOUNT: ["src/popup/popup.html", "src/options/options.html"],
    OPEN_CHAT_CONNECTION: ["src/popup/popup.html", "src/options/options.html"],
    SET_CHAT_PLAN_CHOICE: ["src/popup/popup.html"],
    SYNC_CHAT_HISTORY: ["src/popup/popup.html", "src/options/options.html"],
    OPEN_SCHEDULE_ORIGINAL: ["src/popup/popup.html"],
    OPEN_SCHEDULE_UPDATE: ["src/popup/popup.html"]
  };

  function allowedMessage(message, sender, runtime) {
    if (!message || typeof message !== "object" || Array.isArray(message)) return false;
    if (sender?.id !== runtime.id || (sender.frameId !== undefined && sender.frameId !== 0) ||
        (sender.documentLifecycle && sender.documentLifecycle !== "active")) return false;
    if (["CHAT_COUNT_STATUS", "CHAT_COUNT_RECORD", "CHAT_PLAN_OBSERVED"].includes(message.type)) {
      if (!root.RadarChatCounter?.chatUrl(sender.url) || !Number.isInteger(sender.tab?.id)) return false;
      const keys = message.type === "CHAT_COUNT_STATUS" ? ["type"] : message.type === "CHAT_PLAN_OBSERVED" ? ["type", "scope", "heading"] : ["type", "model", "id", "scope"];
      if (Object.keys(message).some(key => !keys.includes(key))) return false;
      if (message.type === "CHAT_COUNT_STATUS") return true;
      if (typeof message.scope !== "string" || !/^[a-f0-9-]{36}$/.test(message.scope)) return false;
      if (message.type === "CHAT_PLAN_OBSERVED") return typeof message.heading === "string" && message.heading.length <= 80 && Boolean(root.RadarChatCounter.planFromHeading(message.heading));
      return Boolean(root.RadarChatCounter.model(message.model, { family: 'pro' }) &&
        typeof message.id === "string" && /^[a-zA-Z0-9_-]{1,128}$/.test(message.id));
    }
    const pages = PAGES[message.type];
    if (!Array.isArray(pages) || !pages.some(page => sender.url === runtime.getURL(page))) return false;
    const allowedKeys = message.type === "RESUME_CHECK_TABS" ? ["type", "confirmed"] : message.type === "ACK_VISIBLE_BADGES" ? ["type", "receipt"] : message.type === 'SET_CHAT_PLAN_CHOICE' ? ['type', 'plan', 'accountKey'] : message.type === "SAVE_SETTINGS" ? ["type", "settings"] : message.type === "SAVE_THEME" ? ["type", "theme"] : message.type === "OPEN_NEWS" ? ["type", "id"] : ["type"];
    if (Object.keys(message).some(key => !allowedKeys.includes(key))) return false;
    if (message.type === "RESUME_CHECK_TABS") return message.confirmed === true;
    if (message.type === "ACK_VISIBLE_BADGES") return Boolean(root.RadarBadge?.validReceipt(message.receipt));
    if (message.type === 'SET_CHAT_PLAN_CHOICE') return typeof message.accountKey === 'string' && /^[a-f0-9]{64}$/.test(message.accountKey) &&
      (message.plan === 'auto' || Object.hasOwn(root.RadarChatCounter.PLANS, message.plan));
    if (message.type === "OPEN_NEWS" && Object.hasOwn(message, "id")) return typeof message.id === "string" && /^[a-zA-Z0-9:_-]{1,256}$/.test(message.id);
    if (message.type === "SAVE_THEME") return ["light", "dark", "system"].includes(message.theme);
    return message.type !== "SAVE_SETTINGS" || Boolean(message.settings && typeof message.settings === "object" && !Array.isArray(message.settings));
  }

  function validToken(value) {
    return typeof value === "string" && /^[\x21-\x7e]{16,16384}$/.test(value);
  }

  async function fetchData(url, { account = false, token = null, signal, html = false, history = false, accountId = null } = {}) {
    const allowed = history ? account && !html && validToken(token) && typeof accountId === 'string' &&
      /^[a-zA-Z0-9_-]{1,256}$/.test(accountId) && root.RadarChatHistory?.allowedUrl(url) :
      account ? ACCOUNT_ENDPOINTS.has(url) : root.RadarSources.DEFINITIONS.some(source => source.url === url);
    if (!allowed || (!account && token) || (token !== null && !validToken(token))) throw new Error("Blocked request");
    const headers = { accept: html ? "text/html" : "application/json" };
    if (account) headers["oai-language"] = "ko-KR";
    if (token) headers.authorization = `Bearer ${token}`;
    if (history) headers['ChatGPT-Account-ID'] = accountId;
    const deadline = AbortSignal.timeout(15000);
    const response = await fetch(url, {
      method: "GET", headers, credentials: account ? "include" : "omit",
      redirect: "error", referrerPolicy: "no-referrer", cache: "no-store",
      signal: signal ? AbortSignal.any([signal, deadline]) : deadline
    });
    if (!response.ok) {
      const error = new Error("Request failed");
      error.status = response.status;
      throw error;
    }
    const type = String(response.headers.get("content-type") || "").toLowerCase();
    if (!type.includes(html ? "text/html" : "application/json")) throw new Error("Unexpected response type");
    const limit = history ? 8 * 1024 * 1024 : account ? 1024 * 1024 : 2 * 1024 * 1024;
    if (Number(response.headers.get("content-length")) > limit) {
      await response.body?.cancel();
      throw new Error("Response too large");
    }
    const reader = response.body?.getReader();
    if (!reader) throw new Error("Missing response body");
    const decoder = new TextDecoder();
    let length = 0, text = "";
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > limit) { await reader.cancel(); throw new Error("Response too large"); }
        text += decoder.decode(value, { stream: true });
      }
      text += decoder.decode();
    } finally { reader.releaseLock(); }
    return html ? text : JSON.parse(text);
  }

  function evidenceUrl(signal) {
    if (typeof signal?.url !== "string" || signal.url.length > 2048) return null;
    try {
      const url = new URL(signal.url);
      if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
      const source = signal.source?.id;
      const xHost = url.hostname === "x.com" || url.hostname === "twitter.com";
      if (xHost && ["codex-lead", "community-reset-history"].includes(source)) {
        const match = /^\/(thsottiaux|i\/web|[a-zA-Z0-9_]{1,15})\/status\/(\d{1,25})\/?$/.exec(url.pathname);
        if (!match || (source === "codex-lead" && !["thsottiaux", "reach_vb", "openai", "i/web"].includes(match[1].toLowerCase()))) return null;
        return `https://x.com/${source === "codex-lead" ? (match[1] === "i/web" ? (/^@?openai$/i.test(signal.author || "") ? "openai" : /^@?reach_vb$/i.test(signal.author || "") ? "reach_vb" : "thsottiaux") : match[1]) : match[1]}/status/${match[2]}`;
      }
      if (source === "openai-status" && url.hostname === "status.openai.com" && /^\/incidents\/[a-zA-Z0-9-]+\/?$/.test(url.pathname)) return `https://status.openai.com${url.pathname}`;
      if (source === "github-community" && url.hostname === "github.com" && /^\/openai\/codex\/issues\/\d+\/?$/.test(url.pathname)) return `https://github.com${url.pathname}`;
      if (source === "community-reset-history" && url.hostname === "codex-resets.com" && url.pathname === "/") return "https://codex-resets.com/";
    } catch { /* Reject malformed URLs. */ }
    return null;
  }

  root.RadarSecurity = Object.freeze({ allowedMessage, validToken, fetchData, evidenceUrl });
  if (typeof module !== "undefined") module.exports = root.RadarSecurity;
})(globalThis);
