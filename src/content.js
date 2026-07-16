(function initContentCapture() {
  const USAGE_PATH = "/backend-api/wham/usage";
  const CREDITS_PATH = "/backend-api/wham/rate-limit-reset-credits";
  let running = false;

  function accessTokenFromBootstrap() {
    try {
      const node = document.getElementById("client-bootstrap");
      if (!node?.textContent) return null;
      const data = JSON.parse(node.textContent);
      return data?.session?.accessToken || data?.session?.access_token || null;
    } catch {
      return null;
    }
  }

  async function fetchJson(path, token) {
    const headers = { accept: "application/json", "oai-language": navigator.language || "zh-CN" };
    if (token) headers.authorization = `Bearer ${token}`;
    const response = await fetch(path, { credentials: "include", headers, redirect: "error" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  }

  async function capture() {
    if (running) return { ok: false, status: "busy" };
    running = true;
    try {
      const token = accessTokenFromBootstrap();
      if (token) await chrome.runtime.sendMessage({ type: "CACHE_SESSION_TOKEN", token });
      const [usageData, creditsData] = await Promise.all([
        fetchJson(USAGE_PATH, token),
        fetchJson(CREDITS_PATH, token).catch(() => null)
      ]);
      const usage = RadarUsage.normalizeUsage(usageData, { source: "content" });
      const credits = creditsData ? RadarUsage.normalizeCredits(creditsData) : null;
      await chrome.runtime.sendMessage({ type: "STORE_ACCOUNT_SNAPSHOT", usage, credits });
      return { ok: Boolean(usage), source: "content" };
    } catch (error) {
      return { ok: false, status: String(error?.message || error), source: "content" };
    } finally {
      running = false;
    }
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== "CAPTURE_ACCOUNT_NOW") return false;
    capture().then(sendResponse);
    return true;
  });

  setTimeout(capture, 1800);
})();
