(function initTelegramLeads(root) {
  const ORIGIN = 'https://t.me/*';
  const URL = 'https://t.me/s/codex_resets';
  const DAY = 86400000;
  // Channel data is untrusted. Only numerical X status IDs survive; no text,
  // author, timestamps, linked redirects, cookies or account data are used.
  function parse(html, now = Date.now(), { directOnly = false } = {}) {
    if (typeof html !== 'string' || html.length > 2 * 1024 * 1024) return [];
    const found = new Set();
    const href = /\bhref\s*=\s*["']([^"'<>\s]{1,2048})["']/gi;
    let match, examined = 0;
    while ((match = href.exec(html)) && examined++ < 10000) {
      try {
        const url = new root.URL(match[1]);
        if (url.protocol !== 'https:' || !['x.com', 'twitter.com'].includes(url.hostname.toLowerCase()) || url.port || url.username || url.password) continue;
        const path = (directOnly ? /^\/thsottiaux\/status\/([1-9]\d{0,24})\/?$/i : /^\/(?:i(?:\/web)?|thsottiaux|codex_resets)\/status\/([1-9]\d{0,24})\/?$/i).exec(url.pathname);
        if (!path) continue;
        const id = path[1];
        const posted = Number((BigInt(id) >> 22n) + 1288834974657n);
        // Older IDs are leads only. Their actual X body must be verified and
        // goes to display-only history, never into current alerts.
        if (!Number.isFinite(posted) || posted > now + 300000 || posted < now - 365 * DAY) continue;
        found.add(id);
      } catch { /* Reject malformed or oversized links. */ }
    }
    return [...found].sort((a, b) => BigInt(a) > BigInt(b) ? -1 : 1).slice(0, 40);
  }
  // Keep live channel links and user-requested original history links in
  // separate bounded inputs. Interleave them so neither full queue hides the
  // other; actual original author/body must still be verified on X.
  function combine(channel, history) {
    const valid = value => typeof value === 'string' && /^[1-9]\d{0,24}$/.test(value);
    const recent = list => [...new Set((Array.isArray(list) ? list : []).filter(valid))]
      .sort((a, b) => BigInt(a) > BigInt(b) ? -1 : BigInt(a) < BigInt(b) ? 1 : 0).slice(0, 40);
    const telegramIds = recent(channel), historyIds = recent(history), ids = [], seen = new Set();
    const add = id => { if (id && !seen.has(id)) { seen.add(id); ids.push(id); } };
    for (let i = 0; i < Math.max(telegramIds.length, historyIds.length); i++) { add(historyIds[i]); add(telegramIds[i]); }
    return { ids, telegramIds };
  }
  async function load(signal) {
    if (!await root.chrome.permissions.contains({ origins: [ORIGIN] })) return { state: 'permission', ids: [] };
    try {
      const timeout = AbortSignal.timeout(15000);
      const response = await fetch(URL, { method: 'GET', credentials: 'omit', redirect: 'error',
        cache: 'no-store', referrerPolicy: 'no-referrer', signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
      if (!response.ok || !String(response.headers.get('content-type') || '').toLowerCase().includes('text/html')) throw new Error('response');
      if (Number(response.headers.get('content-length')) > 2 * 1024 * 1024) throw new Error('size');
      const reader = response.body?.getReader();
      if (!reader) throw new Error('body');
      const decoder = new TextDecoder(); let text = '', size = 0;
      try {
        while (true) {
          const { done, value } = await reader.read(); if (done) break;
          size += value.byteLength;
          if (size > 2 * 1024 * 1024) { await reader.cancel(); throw new Error('size'); }
          text += decoder.decode(value, { stream: true });
        }
        text += decoder.decode();
      } finally { reader.releaseLock(); }
      return { state: 'ok', ids: parse(text) };
    } catch (error) {
      if (signal?.aborted) throw error;
      return { state: 'unavailable', ids: [] };
    }
  }
  root.RadarTelegramLeads = Object.freeze({ ORIGIN, URL, parse, combine, load });
  if (typeof module !== 'undefined') module.exports = root.RadarTelegramLeads;
})(globalThis);
