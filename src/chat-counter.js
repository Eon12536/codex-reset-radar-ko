(() => {
  if (globalThis.radarChatObserver) return;
  globalThis.radarChatObserver = true;
  const tracker = RadarChatCounter.tracker();
  let enabled = false, scope = null, planFamily = null, timer, checking = false, planBusy = false, lastPlanSent = '', lastPlanAttempt = 0;
  const rows = () => Array.from(document.querySelectorAll('[data-message-author-role][data-message-id]'), node => ({
    id: node.getAttribute('data-message-id'), role: node.getAttribute('data-message-author-role'),
    slug: node.getAttribute('data-message-model-slug')
  }));
  const observer = new MutationObserver(() => {
    if (!timer) timer = setTimeout(() => { timer = null; scan(); }, 120);
  });
  function scan() {
    if (!enabled || !RadarChatCounter.chatUrl(location.href)) return;
    observePlan();
    for (const entry of tracker.scan(rows(), location.pathname, Date.now(), planFamily)) {
      chrome.runtime.sendMessage({ type: 'CHAT_COUNT_RECORD', scope, ...entry }).catch(() => {});
    }
  }
  async function observePlan() {
    if (location.hash !== '#settings/Billing' || planBusy) return;
    // Read current subscription headings only, never prices from an upgrade
    // offer or text from a conversation. The worker also requires its fresh tab.
    const panel = document.querySelector('[role="tabpanel"][id$="-content-Billing"]:not([hidden])');
    const headings = panel ? Array.from(panel.querySelectorAll('h3'), node => node.textContent.trim()).filter(text => RadarChatCounter.planFromHeading(text)) : [];
    const heading = new Set(headings.map(RadarChatCounter.planFromHeading)).size === 1 ? headings[0] : null;
    if (!heading || heading === lastPlanSent || Date.now() - lastPlanAttempt < 30000) return;
    planBusy = true; lastPlanAttempt = Date.now();
    try {
      const result = await chrome.runtime.sendMessage({ type: 'CHAT_PLAN_OBSERVED', scope, heading });
      if (result?.ok) lastPlanSent = heading;
    } catch { /* A new explicit connection can retry after a worker reload. */ }
    finally { planBusy = false; }
  }
  async function sync() {
    if (checking) return;
    checking = true;
    try {
      const result = await chrome.runtime.sendMessage({ type: 'CHAT_COUNT_STATUS' });
      const next = Boolean(result?.enabled && result.scope && RadarChatCounter.chatUrl(location.href));
      if (next && (!enabled || scope !== result.scope)) {
        tracker.reset(rows(), location.pathname);
        lastPlanSent = ''; lastPlanAttempt = 0;
        observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true,
          attributeFilter: ['data-message-id', 'data-message-model-slug', 'data-message-author-role'] });
      }
      if (!next) { observer.disconnect(); clearTimeout(timer); timer = null; }
      enabled = next;
      planFamily = result?.family || null;
      scope = next ? result.scope : null;
      if (next) observePlan();
    } catch (error) {
      enabled = false; scope = null; planFamily = null;
      observer.disconnect(); clearTimeout(timer); timer = null;
      // A closed message port may recover with the next worker request. Only
      // a replaced/removed extension context makes this document unusable.
      if (/extension context invalidated/i.test(String(error?.message || ''))) clearInterval(poll);
    }
    finally { checking = false; }
  }
  function arm(event) {
    if (!enabled || !event.isTrusted || !RadarChatCounter.chatUrl(location.href)) return;
    const target = event.target instanceof Element ? event.target : null;
    if (event.type === 'click' && target?.closest('a[href]')) { tracker.reset(rows(), location.pathname); return; }
    const clickSend = event.type === 'click' && target?.closest('[data-testid="send-button"]');
    const enterSend = event.type === 'keydown' && event.key === 'Enter' && !event.shiftKey && !event.isComposing &&
      target?.closest('#prompt-textarea');
    if (clickSend || enterSend) tracker.arm(rows(), location.pathname, Date.now());
  }
  document.addEventListener('click', arm, true);
  document.addEventListener('keydown', arm, true);
  document.addEventListener('visibilitychange', sync);
  chrome.runtime.onMessage.addListener(message => { if (message.type === 'CHAT_COUNT_SYNC') sync(); });
  const poll = setInterval(sync, 30000);
  sync();
})();
