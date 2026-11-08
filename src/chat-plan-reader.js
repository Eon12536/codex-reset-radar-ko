// Invoked only in the worker-owned billing tab. Return the current plan name,
// never invoice details, renewal dates, payment data or broad page text.
(() => {
  if (!RadarChatCounter.billingUrl(location.href)) return { status: 'wrong-page' };
  const modern = /^\/settings\/billing\/?$/.test(location.pathname);
  let heading;
  if (modern) heading = RadarChatCounter.currentBillingHeading(document);
  else {
    const panel = document.querySelector('[role="tabpanel"][id$="-content-Billing"]:not([hidden])');
    const headings = panel ? [...panel.querySelectorAll('h3')].map(node => node.textContent.trim())
      .filter(text => RadarChatCounter.planFromHeading(text)) : [];
    heading = new Set(headings.map(RadarChatCounter.planFromHeading)).size === 1 ? headings[0] : null;
  }
  return heading ? { status: 'read', url: location.href, heading, modern } : { status: 'card-pending' };
})();
