(() => {
  if (globalThis.radarChatObserver) return;
  globalThis.radarChatObserver = true;
  const tracker = RadarChatCounter.tracker();
  let enabled = false, scope = null, planFamily = null, timer, checking = false, planBusy = false, lastPlanSent = '', lastPlanAttempt = 0;
  const pendingRecords = new Map();
  let draining = false, deliveryCycle = 0, invalidated = false;
  function pruneRecords() {
    for (const [id, entry] of pendingRecords) if (Date.now() - entry.observedAt > 15 * 60000 ||
        (enabled && entry.message.scope !== scope)) pendingRecords.delete(id);
  }
  function stopInvalidated() {
    invalidated = true; enabled = false; scope = null; planFamily = null;
    pendingRecords.clear(); observer.disconnect(); clearTimeout(timer); timer = null; clearInterval(poll);
  }
  async function deliverRecords() {
    if (draining || !enabled || invalidated) return;
    draining = true;
    try {
      pruneRecords();
      // Retry only after a fresh same-account status check. DOM mutations must
      // not spin failed deliveries. Keep metadata in this document only.
      for (const [id, entry] of pendingRecords) {
        if (!enabled || invalidated) break;
        if (Date.now() - entry.observedAt > 15 * 60000) { pendingRecords.delete(id); continue; }
        if (entry.message.scope !== scope || entry.attemptCycle === deliveryCycle) continue;
        entry.attemptCycle = deliveryCycle;
        try {
          const result = await chrome.runtime.sendMessage(entry.message);
          if (result?.ok === true && pendingRecords.get(id) === entry) pendingRecords.delete(id);
        } catch (error) {
          if (/extension context invalidated/i.test(String(error?.message || ''))) stopInvalidated();
        }
      }
    } finally { draining = false; }
  }
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
      pruneRecords();
      if (pendingRecords.size >= 200) pendingRecords.delete(pendingRecords.keys().next().value);
      pendingRecords.set(entry.id, { message: { type: 'CHAT_COUNT_RECORD', scope, ...entry },
        observedAt: Date.now(), attemptCycle: -1 });
    }
    deliverRecords();
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
    if (checking || invalidated) return;
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
      if (!next) {
        observer.disconnect(); clearTimeout(timer); timer = null;
        if (result?.reason !== 'unverified') pendingRecords.clear();
      }
      enabled = next;
      planFamily = result?.family || null;
      scope = next ? result.scope : null;
      pruneRecords();
      if (next) { observePlan(); deliveryCycle++; deliverRecords(); }
    } catch (error) {
      enabled = false; scope = null; planFamily = null;
      observer.disconnect(); clearTimeout(timer); timer = null;
      // A closed message port may recover with the next worker request. Only
      // a replaced/removed extension context makes this document unusable.
      pruneRecords();
      if (/extension context invalidated/i.test(String(error?.message || ''))) stopInvalidated();
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
