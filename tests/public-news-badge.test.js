const test = require('node:test');
const assert = require('node:assert/strict');
const { makeWorker, json } = require('./helpers/worker');
const DAY = 86400000;
const START = Date.parse('2026-10-02T04:00:00Z');

function worker(text, { stored = {}, settings = {} } = {}) {
  let now = START;
  const source = { items: text ? [{ external_id: '2105843926221660999', content: text,
    published_at: new Date(START - 3600000).toISOString(), metadata: { author_user_name: 'thsottiaux' } }] : [] };
  const w = makeWorker({ stored: { accountSnapshot: { usage: { windows: [{ kind: 'weekly', remainingPercent: 80 }] } },
    ...stored, settings: { monitorAccount: true, monitorStatusSource: false, monitorHistorySource: false,
      monitorCommunitySource: false, quietHoursEnabled: false, ...settings } }, fetcher: async () => json(source) });
  w.context.Date = class extends Date { static now() { return now; } };
  const labels = [], alarms = [];
  w.context.chrome.action.setBadgeText = async ({ text }) => labels.push(text);
  w.context.chrome.alarms.create = async (name, options) => alarms.push({ name, ...options });
  return { ...w, labels, alarms, source, clock(value) { now = value; } };
}

test('completed reset and public Banked grant posts mark the weekly badge independently of a future signal', async () => {
  for (const text of ['Resets all propagated. That will be all. Have a good weekend!',
    'We added a banked reset to all accounts.']) {
    const w = worker(text);
    await w.context.refreshSignals();
    assert.equal(w.local.signalSnapshot.signal, null);
    assert.equal(w.local.signalSnapshot.reports.length, 1);
    assert.equal(w.labels.at(-1), '80%!', text);
  }
});

test('an indirect reset clue marks the badge even when its desktop notification is off', async () => {
  const w = worker('Burn those tokens', { settings: { notifyHints: false } });
  await w.context.refreshSignals();
  assert.equal(w.local.hintSnapshot.items[0]?.assessment.rule, 'token-burn');
  assert.equal(Object.keys(w.notifications).length, 0);
  assert.equal(w.labels.at(-1), '80%!');
});

test('an older strongest forecast cannot hide a newly detected lower-ranked reset announcement', async () => {
  const old = { id: 'older', text: 'We will reset Codex usage limits next week.', author: 'thsottiaux',
    source: { id: 'codex-lead', weight: 1 }, createdAt: START - 2 * DAY, firstDetectedAt: START - 2 * DAY };
  const w = worker('Global reset landing tomorrow.', { stored: { signalSnapshot: { signal: old, activeSignals: [old] } } });
  await w.context.refreshSignals();
  assert.equal(w.local.signalSnapshot.signal.id, 'older');
  assert.equal(w.local.signalSnapshot.activeSignals.length, 2);
  assert.equal(w.labels.at(-1), '80%!');
});

test('reports keep their first-detection deadline across repeated scans and offline expiry', async () => {
  const w = worker('We added a banked reset to all accounts.');
  await w.context.refreshSignals();
  assert.equal(w.labels.at(-1), '80%!');
  w.clock(START + DAY - 1);
  await w.context.refreshSignals();
  assert.equal(w.labels.at(-1), '80%!');
  const before = w.requests.length;
  w.clock(START + DAY);
  await w.events.alarm({ name: 'codex-reset-radar-badge-expiry' });
  assert.equal(w.labels.at(-1), '80%');
  assert.equal(w.requests.length, before);
  assert.equal(w.local.signalSnapshot.reports.length, 1);
  assert.ok(w.alarms.filter(alarm => alarm.name === 'codex-reset-radar-badge-expiry').every(alarm => alarm.when === START + DAY));
  await w.context.refreshSignals();
  assert.equal(w.labels.at(-1), '80%');
});

test('historical reports and legacy cached reports do not create a new detection clock', async () => {
  const w = worker('Resets all propagated.');
  w.source.items[0].published_at = new Date(START - 3 * DAY).toISOString();
  await w.context.refreshSignals();
  assert.equal(w.local.signalSnapshot.reports.length, 1);
  assert.equal(w.labels.at(-1), '80%');
  delete w.local.publicAlertState;
  await w.context.updateBadge(w.local.accountSnapshot, null, null);
  assert.equal(w.labels.at(-1), '80%');
});

test('product and timed event chatter do not create a reset badge marker', async () => {
  for (const text of ['OpenAI DevDay is October 3, 2026 at 10am PT.',
    'Our new product launches tomorrow at 10am PT.']) {
    const w = worker(text);
    await w.context.refreshSignals();
    assert.ok(w.local.hintSnapshot.items.length);
    assert.equal(w.labels.at(-1), '80%', text);
  }
});

test('public monitoring opt-out clears the marker while notification opt-out preserves detected news', async () => {
  const w = worker('Resets all propagated.', { settings: { notifyOfficialReset: false } });
  await w.context.refreshSignals();
  assert.equal(Object.keys(w.notifications).length, 0);
  assert.equal(w.labels.at(-1), '80%!');
  await w.context.saveSettings({ ...w.local.settings, monitorLeadSource: false });
  assert.equal(w.labels.at(-1), '80%');
  const off = worker('Resets all propagated.', { settings: { monitorSignals: false } });
  await off.context.updateBadge(off.local.accountSnapshot, { firstDetectedAt: START, assessment: { actionable: true } }, null);
  assert.equal(off.labels.at(-1), '80%');
});

test('a linked reset timing update also starts a bounded marker without making a new reset claim', async () => {
  const original = { id: '2105000000000000000', author: 'thsottiaux', text: 'We will reset Codex usage limits next week.',
    createdAt: new Date(START - 2 * DAY).toISOString(), source: { id: 'codex-lead', weight: 1 } };
  const w = worker('Codex reset delayed until tomorrow.', { stored: { signalSnapshot: { signal: original, activeSignals: [original] } } });
  await w.context.refreshSignals();
  assert.equal(w.context.RadarSchedule.changes(w.local.scheduleSnapshot).length, 1);
  assert.equal(w.labels.at(-1), '80%!');
});
