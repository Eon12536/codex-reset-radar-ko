const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../src/x-wrapper-reader'), 'utf8');
const wrapperId = '2114592894044766612', originalId = '2114588174249071102';
const originalUrl = 'https://x.com/thsottiaux/status/' + originalId;

async function resolveQuote({ destination = originalUrl, href, bodyHrefs = [], author = '@thsottiaux',
  visible = false, marker = '#radar-x-reader=12345678-1234-1234-1234-123456789abc',
  wrongArticle = false, multiple = false, supported = true, userInitiated = false, hydrateAfter = 0 } = {}) {
  let elapsed = 0, clicks = 0, cancelled = false, handler, removed = 0;
  const location = { origin: 'https://x.com', pathname: '/codex_resets/status/' + wrapperId, hash: marker };
  const card = {
    querySelector(selector) {
      if (selector === '[data-testid="User-Name"]') return { textContent: author };
      if (selector === 'time') return { closest: () => href ? { getAttribute: () => href } : null };
      return {};
    },
    contains: () => true,
    querySelectorAll: () => [...(href ? [href] : []), ...bodyHrefs].map(value => ({ getAttribute: () => value })),
    click() {
      clicks++;
      const event = { userInitiated, cancelable: true, navigationType: 'push', destination: { url: destination },
        preventDefault() { cancelled = true; this.defaultPrevented = true; } };
      handler(event);
    }
  };
  const time = { closest: selector => selector === 'a' ? {
    getAttribute: () => '/codex_resets/status/' + (wrongArticle ? '999' : wrapperId)
  } : null };
  const article = { contains: () => true, querySelectorAll: selector => selector === 'time' ? [time]
    : elapsed >= hydrateAfter ? (multiple ? [card, card] : [card]) : [] };
  class Clock extends Date { static now() { return elapsed; } }
  const timers = new Map(); let serial = 0;
  const context = vm.createContext({ location, URL, Date: Clock,
    document: { visibilityState: visible ? 'visible' : 'hidden', querySelectorAll: () => [article] },
    window: { navigation: supported ? { addEventListener(_name, fn) { handler = fn; }, removeEventListener() { removed++; handler = null; } } : undefined },
    setTimeout: (fn, ms) => { const id = ++serial; timers.set(id, true); queueMicrotask(() => { if (timers.has(id)) { elapsed += ms; fn(); } }); return id; },
    clearTimeout: id => timers.delete(id)
  });
  const result = await vm.runInContext(source, context);
  return { result, clicks, cancelled, removed, elapsed, location };
}

test('the observed href-less X quote reveals only a candidate URL and its navigation is cancelled', async () => {
  const r = await resolveQuote({ hydrateAfter: 1000 });
  assert.equal(r.result.wrapperId, wrapperId);
  assert.equal(r.result.originalUrl, originalUrl);
  assert.equal(r.clicks, 1); assert.equal(r.cancelled, true); assert.equal(r.removed, 1);
  assert.equal(r.location.pathname, '/codex_resets/status/' + wrapperId);
  assert.ok(r.elapsed >= 1000);
  assert.deepEqual(Object.keys(r.result).sort(), ['originalUrl', 'wrapperId']);
});

test('a visible quote href needs no click and strips shared-link parameters', async () => {
  const r = await resolveQuote({ href: originalUrl + '?s=20' });
  assert.equal(r.result.originalUrl, originalUrl); assert.equal(r.clicks, 0);
});

test('links inside quote text are not mistaken for the quoted original', async () => {
  const older = 'https://x.com/thsottiaux/status/2113492187770175603';
  for (const options of [{ bodyHrefs: [older] }, { bodyHrefs: [older, originalUrl] },
    { href: originalUrl, bodyHrefs: [older] }]) {
    const r = await resolveQuote(options);
    assert.equal(r.result.originalUrl, originalUrl);
    assert.equal(r.clicks, options.href ? 0 : 1);
    assert.equal(r.location.pathname, '/codex_resets/status/' + wrapperId);
  }
  const unsupported = await resolveQuote({ bodyHrefs: [older], supported: false });
  assert.equal(unsupported.result.originalUrl, null);
  assert.equal(unsupported.clicks, 0);
});

test('foreign, private and deceptive destinations are cancelled and rejected', async () => {
  for (const destination of ['https://x.com.evil.test/thsottiaux/status/' + originalId,
    'https://x.com@evil.test/thsottiaux/status/' + originalId, 'https://x.com/i/chat',
    'https://x.com/reach_vb/status/' + originalId, 'javascript:alert(1)']) {
    const r = await resolveQuote({ destination });
    assert.equal(r.result.originalUrl, null); assert.equal(r.cancelled, true);
  }
});

test('no marker, selected tabs, ambiguity, other authors and unsupported navigation never cause a click', async () => {
  for (const options of [{ marker: '' }, { visible: true }, { multiple: true }, { wrongArticle: true },
    { author: '@someone' }, { supported: false }]) {
    const r = await resolveQuote(options);
    assert.equal(r.result.originalUrl, null); assert.equal(r.clicks, 0); assert.ok(r.elapsed <= 8000);
  }
});

test('a user navigation is neither cancelled nor treated as the quote destination', async () => {
  const r = await resolveQuote({ userInitiated: true });
  assert.equal(r.result.originalUrl, null); assert.equal(r.cancelled, false); assert.equal(r.removed, 1);
});
