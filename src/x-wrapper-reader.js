// A repost is a lead, never reset evidence. Resolve only its one visible Tibo
// quote, then let the worker load and validate the original in the owned tab.
(async function resolvePublicQuote() {
  const path = location.pathname;
  const wrapperId = /^\/codex_resets\/status\/([1-9]\d{0,24})\/?$/i.exec(path)?.[1];
  const marker = location.hash;
  const allowed = () => location.origin === 'https://x.com' && location.pathname === path &&
    location.hash === marker && /^#radar-x-reader=[a-f0-9-]{36}$/.test(marker);
  if (!wrapperId || !allowed()) return { originalUrl: null };
  const empty = () => ({ wrapperId, originalUrl: null });
  const canonical = value => {
    try {
      const url = new URL(value, 'https://x.com');
      const id = /^\/thsottiaux\/status\/([1-9]\d{0,24})\/?$/i.exec(url.pathname)?.[1];
      return url.origin === 'https://x.com' && !url.username && !url.password && id && id !== wrapperId
        ? 'https://x.com/thsottiaux/status/' + id : null;
    } catch { return null; }
  };
  const deadline = Date.now() + 8000;
  let card;
  while (allowed() && Date.now() < deadline) {
    const articles = Array.from(document.querySelectorAll('article[data-testid="tweet"]'));
    const target = articles.find(article => Array.from(article.querySelectorAll('time')).some(time => {
      const quote = time.closest('[role="link"]:not(a)');
      if (quote && quote !== article && article.contains(quote)) return false;
      const href = time.closest('a')?.getAttribute('href') || '';
      return new RegExp('^(?:https://x\\.com)?/codex_resets/status/' + wrapperId + '/?(?:[?#].*)?$', 'i').test(href);
    }));
    const cards = Array.from(target?.querySelectorAll('[role="link"]:not(a)') || []).filter(candidate => {
      const identity = candidate.querySelector('[data-testid="User-Name"]')?.textContent || '';
      return /@thsottiaux\b/i.test(identity) && candidate.querySelector('time') && candidate.querySelector('[data-testid="tweetText"]');
    });
    if (cards.length > 1) return empty();
    if (cards.length === 1) { card = cards[0]; break; }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  if (!card || !allowed()) return empty();
  // Only the quote timestamp identifies this post. A link in its body may
  // point to an unrelated older post and must never become the cached mapping.
  const permalink = card.querySelector('time')?.closest('a');
  const originalUrl = permalink && card.contains(permalink) ? canonical(permalink.getAttribute('href')) : null;
  if (originalUrl) return { wrapperId, originalUrl };
  if (!window.navigation?.addEventListener || document.visibilityState !== 'hidden') return empty();
  // X often renders a DIV role=link with no href. Capture the destination of
  // its programmatic navigation and cancel it, keeping the ownership marker.
  // Do not intercept a user's navigation, submit a form or click any controls.
  return new Promise(resolve => {
    let settled = false;
    const finish = originalUrl => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      window.navigation.removeEventListener('navigate', onNavigate);
      resolve({ wrapperId, originalUrl });
    };
    const onNavigate = event => {
      if (!allowed() || document.visibilityState !== 'hidden' || event.userInitiated ||
          !event.cancelable || !['push', 'replace'].includes(event.navigationType) || event.formData || event.downloadRequest) return finish(null);
      event.preventDefault();
      finish(event.defaultPrevented ? canonical(event.destination?.url) : null);
    };
    const timer = setTimeout(() => finish(null), 1200);
    window.navigation.addEventListener('navigate', onNavigate);
    try { card.click(); } catch { finish(null); }
  });
})();
