const test = require('node:test');
const assert = require('node:assert/strict');
const Counter = require('../src/core/chat-counter');

const now = Date.parse('2026-10-02T07:00:00Z');
const event = { key: 'a'.repeat(64), model: 'astra', at: now - 60000 };
const profile = plan => ({ plan, planAt: now, events: [event] });

test('current account type supplies Free, Go, Plus and managed plans without inventing numeric allowances', () => {
  for (const family of ['free', 'go', 'plus', 'enterprise', 'edu']) {
    const data = { settings: { monitorChat: true },
      chatAccount: { status: 'connected', checkedAt: now, key: 'account', family },
      chatCounters: { account: profile('pro100') } };
    const before = structuredClone(data);
    const view = Counter.view(data, now);
    assert.equal(view.plan, family);
    assert.equal(view.label, Counter.PLANS[family].label);
    assert.equal(view.planSource, 'account');
    assert.equal(view.count.astra, 1);
    assert.equal(view.count.remaining, null);
    assert.deepEqual(view.meters, []);
    assert.deepEqual(data, before);
    data.chatAccount.status = 'disconnected';
    assert.equal(Counter.view(data, now).plan, null);
  }
});

test('new Pro 200 and Pro 500 Billing headings identify the tier without inventing a Chat allowance', () => {
  for (const heading of ['ChatGPT Pro $200', 'ChatGPT Pro 200', 'ChatGPT Pro 20x', 'ChatGPT Pro $500', 'ChatGPT Pro 500']) {
    const plan = Counter.planFromHeading(heading);
    assert.ok(['pro200Current', 'pro500'].includes(plan));
    const view = Counter.view({ settings: { monitorChat: true }, chatAccount: { status: 'connected', checkedAt: now, key: 'account', family: 'pro' },
      chatCounters: { account: profile(plan) } }, now);
    assert.equal(view.plan, plan);
    assert.equal(view.count.astra, 1);
    assert.equal(view.count.remaining, null);
    assert.deepEqual(view.meters, []);
    assert.equal(Counter.planFromHeading('Upgrade to ' + heading), null);
  }
});

test('old automatic Pro 200 evidence cannot silently apply grandfathered numeric limits after the tier change', () => {
  for (const age of [60000, 2 * 86400000]) {
    const evidence = Counter.planEvidence({ ...profile('pro200'), planAt: now - age }, 'pro', now);
    assert.equal(evidence.plan, 'pro200Current');
    assert.equal(Counter.summary(profile('pro200'), evidence.plan, now).remaining, null);
    assert.deepEqual(Counter.meters(Counter.summary({}, evidence.plan, now), evidence.plan), []);
  }
});

test('retired Pro 200 selections resolve to the single current tier without changing stored history', () => {
  const state = { ...profile('pro200Current'), planChoice: { plan: 'pro200', at: now } };
  const before = structuredClone(state);
  const evidence = Counter.planEvidence(state, 'pro', now);
  assert.equal(evidence.plan, 'pro200Current');
  assert.equal(evidence.source, 'selected');
  const view = Counter.view({ settings: { monitorChat: true },
    chatAccount: { status: 'connected', checkedAt: now, key: 'account', family: 'pro' },
    chatCounters: { account: state } }, now);
  assert.equal(view.label, 'Pro $200');
  assert.equal(view.count.astra, 1);
  assert.equal(view.count.remaining, null);
  assert.deepEqual(view.meters, []);
  assert.deepEqual(state, before);
  assert.equal(Counter.planEvidence(state, 'business', now).plan, null);
});
