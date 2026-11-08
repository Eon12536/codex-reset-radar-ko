const test = require('node:test');
const assert = require('node:assert/strict');
globalThis.RadarSecurity = require('../src/core/security.js');
const release = require('../src/core/model-release.js');

const post = (text, overrides = {}) => ({ id: '2116692529970311254', author: 'openai',
  url: 'https://x.com/openai/status/2116692529970311254', createdAt: '2026-11-01T00:00:00Z',
  source: { id: 'codex-lead' }, text, ...overrides });

test('detects a named model announcement from a verified monitored account', () => {
  assert.equal(release.detect(post('Introducing GPT-5.1 today.'))?.model, 'GPT-5.1');
  assert.equal(release.detect(post('GPT-4o is now available.'))?.model, 'GPT-4o');
});
test('does not turn a rumor, cancellation, ordinary mention, or foreign URL into a launch', () => {
  for (const text of ['GPT-5.1 might launch soon.', 'Will GPT-5.1 launch today?',
    'We cancelled the GPT-5.1 release.', 'Here is a guide to GPT-5.1.']) assert.equal(release.detect(post(text)), null);
  assert.equal(release.detect(post('Introducing GPT-5.1', { url: 'https://example.com/' })), null);
  assert.equal(release.detect(post('Introducing GPT-5.1', { truncated: true })), null);
});
test('preserves archived evidence but hides an edited post that no longer announces a model', () => {
  const original = post('Introducing GPT-5.1 today.');
  const saved = release.merge([], [original]);
  const changed = release.merge(saved, [{ ...original, text: 'We cancelled the GPT-5.1 release.' }]);
  assert.equal(changed.length, 1);
  assert.equal(changed[0].retracted, true);
  assert.equal(release.detect(changed[0]), null);
  assert.equal(release.merge(changed, [original])[0].retracted, undefined);
});
