const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { makeWorker, json } = require('./helpers/worker');
const DAY = 86400000;
const NOW = Date.parse('2026-10-03T06:00:00Z');

function inZone(offset) {
  // Model hosts east and west of UTC without changing the test runner's zone.
  class HostDate extends Date {
    static now() { return NOW; }
    static parse(value) {
      return Date.parse(typeof value === 'string' && /^\d{4}-\d\d-\d\dT[\d:.]+$/.test(value)
        ? value + offset : value);
    }
  }
  const context = vm.createContext({ Date: HostDate, Intl });
  for (const file of ['time', 'public-alerts']) vm.runInContext(
    fs.readFileSync(require.resolve('../src/core/' + file), 'utf8'), context);
  return { Alerts: context.RadarPublicAlerts, HostDate };
}

test('UTC feed timestamps, epoch seconds and milliseconds have identical freshness in every host zone', () => {
  for (const zone of ['+09:00', '-08:00', '+00:00']) {
    const { Alerts } = inZone(zone);
    for (const age of [1, 15, 20, 23, 25, 30]) {
      const at = NOW - age * 3600000;
      const iso = new Date(at).toISOString();
      for (const createdAt of [iso, iso.slice(0, -1), at, at / 1000]) {
        const item = { id: '123', createdAt };
        const state = Alerts.observe(null, [item], { now: NOW });
        assert.equal(state.entries['123'].publishedAt, at, `${zone}, ${createdAt}`);
        assert.equal(Alerts.allowed(item, state, {}, { now: NOW }), age <= 24, `${zone}, ${createdAt}`);
      }
    }
  }
});

test('cached observations with a formerly wrong zone are corrected without extending their first-observation TTL', () => {
  const { Alerts } = inZone('+09:00');
  const published = NOW - 20 * 3600000;
  const observedAt = NOW - 60000;
  const item = { id: '123', createdAt: new Date(published).toISOString().slice(0, -1) };
  const previous = { entries: { '123': { observedAt, publishedAt: published - 9 * 3600000, expiresAt: 0, catchUp: false } } };
  const corrected = Alerts.observe(previous, [item], { now: NOW });
  assert.equal(corrected.entries['123'].publishedAt, published);
  assert.equal(corrected.entries['123'].expiresAt, observedAt + DAY);
  assert.equal(Alerts.allowed(item, corrected, {}, { now: NOW }), true);
  assert.equal(Alerts.allowed(item, corrected, { 'report:123': NOW }, { now: NOW }), false);
  const later = Alerts.observe(corrected, [item], { now: observedAt + DAY + 1 });
  assert.equal(Alerts.allowed(item, later, {}, { now: observedAt + DAY + 1 }), false);
  const known = Alerts.observe({ entries: { '123': { observedAt, expiresAt: 0 } } }, [item], { now: NOW });
  assert.equal(Alerts.allowed(item, known, {}, { now: NOW }), false);
});

test('timezone correction removes a stale mistaken alert and preserves a legitimate offline catch-up', () => {
  const { Alerts } = inZone('-08:00');
  const oldAt = NOW - 30 * 3600000;
  const item = { id: '123', createdAt: new Date(oldAt).toISOString().slice(0, -1) };
  const previous = { entries: { '123': { observedAt: NOW, publishedAt: oldAt + 8 * 3600000, expiresAt: NOW + DAY, catchUp: false } } };
  const corrected = Alerts.observe(previous, [item], { now: NOW });
  assert.equal(Alerts.allowed(item, corrected, {}, { now: NOW }), false);
  previous.entries['123'].catchUp = true;
  assert.equal(Alerts.allowed(item, Alerts.observe(previous, [item], { now: NOW }), {}, { now: NOW }), true);
});

test('the worker delivers a timezone-less twenty-hour-old reset report exactly once after refresh and restart', async () => {
  const { HostDate } = inZone('+09:00');
  const source = { items: [{ external_id: '123', content: 'We have now reset all Codex usage limits.',
    published_at: new Date(NOW - 20 * 3600000).toISOString().slice(0, -1),
    metadata: { author_user_name: 'thsottiaux' } }] };
  const create = stored => {
    const w = makeWorker({ stored: { settings: { monitorAccount: false, monitorStatusSource: false,
      monitorHistorySource: false, monitorCommunitySource: false, quietHoursEnabled: false }, ...stored },
      fetcher: async () => json(source) });
    w.context.Date = HostDate;
    return w;
  };
  const w = create();
  await w.context.refreshSignals();
  assert.ok(w.notifications['report:123']);
  const first = JSON.stringify(w.local.notificationHistory);
  await w.context.refreshSignals();
  assert.equal(JSON.stringify(w.local.notificationHistory), first);
  const restarted = create(structuredClone(w.local));
  await restarted.events.startup();
  assert.equal(Object.keys(restarted.notifications).length, 0);
});

test('a later cancellation wins over an earlier schedule when feed and direct-X timestamps have different notation', () => {
  for (const zone of ['+09:00', '-08:00']) {
    const { HostDate } = inZone(zone);
    const context = vm.createContext({ Date: HostDate, Intl });
    for (const file of ['time', 'signals', 'news', 'events']) vm.runInContext(
      fs.readFileSync(require.resolve('../src/core/' + file), 'utf8'), context);
    const post = (id, text, at) => ({ id, text, author: 'thsottiaux', createdAt: at,
      source: { id: 'codex-lead', weight: 1 } });
    const scheduled = post('123', 'OpenAI event on October 10 at 10am PT.', new Date(NOW - 2 * 3600000).toISOString());
    const cancelled = post('124', 'OpenAI event has been cancelled.', new Date(NOW - 3600000).toISOString().slice(0, -1));
    for (const incoming of [[scheduled, cancelled], [cancelled, scheduled]]) {
      const groups = context.RadarEvents.groups([], incoming, { now: NOW });
      assert.equal(groups.length, 1);
      assert.equal(groups[0].status, 'cancelled', zone);
      assert.equal(context.RadarEvents.pinned({ }, { events: incoming },
        { monitorSignals: true, monitorLeadSource: true }, { now: NOW }).length, 0);
    }
  }
});
