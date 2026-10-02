const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');
const { makeWorker, json } = require('./helpers/worker');
const manifest = require('../manifest.json');
const root = path.resolve(__dirname, '..');
const imageError = 'Unable to download all specified images.';

function checkIcon(w, options) {
  assert.match(options.iconUrl, /^data:image\/png;base64,[A-Za-z0-9+/]+=*$/);
  const bytes = Buffer.from(options.iconUrl.slice('data:image/png;base64,'.length), 'base64');
  assert.deepEqual(bytes, fs.readFileSync(path.join(root, 'assets/icons/icon128.png')));
  return bytes;
}

test('notifications embed a decodable PNG without a worker-relative resource request', async () => {
  const w = makeWorker();
  let options;
  w.context.chrome.notifications.create = async (_, value) => { options = value; checkIcon(w, value); };
  await w.context.createNotification('signal:111', { title: '테스트', message: '본문' }, { quietHoursEnabled: false });
  const metadata = await sharp(checkIcon(w, options)).metadata();
  assert.equal(metadata.format, 'png'); assert.equal(metadata.width, 128); assert.equal(metadata.height, 128);
});

test('the worker CSP permits its own image fetch without allowing additional network origins', () => {
  const directive = manifest.content_security_policy.extension_pages.split(';').map(s => s.trim()).find(s => s.startsWith('connect-src '));
  assert.deepEqual(directive.split(/\s+/).slice(1).sort(), ["'self'", 'data:', 'https://chatgpt.com', 'https://api.dayclaw.com', 'https://status.openai.com', 'https://codex-resets.com', 'https://api.github.com'].sort());
});

test('queued notifications from previous versions replace their stale icon URL at delivery', async () => {
  const w = makeWorker({ stored: { pendingNotifications: [{ id: 'signal:111', options: { title: '기존 알림', message: '본문', iconUrl: 'assets/icons/icon128.png' } }] } });
  w.local.signalSnapshot = { activeSignals: [{ id: '111', createdAt: new Date().toISOString() }] };
  await w.context.flushPendingNotifications();
  checkIcon(w, w.notifications['signal:111']);
  assert.equal(w.notifications['signal:111'].type, 'basic');
  assert.equal(w.local.pendingNotifications.length, 0);
});

test('notification failure queues a single retry without rejecting and retries successfully once', async () => {
  const w = makeWorker(); const original = w.context.chrome.notifications.create;
  w.local.signalSnapshot = { activeSignals: [{ id: '111', createdAt: new Date().toISOString() }] };
  w.context.chrome.notifications.create = async () => { throw new Error(imageError); };
  await w.context.createNotification('signal:111', { title: '알림', message: '본문' }, { quietHoursEnabled: false });
  await w.context.createNotification('signal:111', { title: '알림', message: '수정' }, { quietHoursEnabled: false });
  assert.equal(w.local.pendingNotifications.length, 1);
  await w.context.flushPendingNotifications();
  assert.equal(w.local.pendingNotifications.length, 1);
  w.context.chrome.notifications.create = original;
  await w.context.flushPendingNotifications(); await w.context.flushPendingNotifications();
  assert.equal(Object.keys(w.notifications).length, 1);
  assert.equal(w.notifications['signal:111'].message, '수정');
  assert.equal(w.local.pendingNotifications.length, 0);
});

test('an image failure cannot mark a successful public fetch as unavailable or stop remaining candidates', async () => {
  const w = makeWorker({ stored: { settings: { monitorAccount: false, monitorLeadSource: true, monitorStatusSource: false,
    monitorHistorySource: false, monitorCommunitySource: false, notifyHints: true, quietHoursEnabled: false } },
    fetcher: () => json({ items: ['211', '212'].map(id => ({ external_id: id, content: 'Maybe dust off the reset button tomorrow.',
      published_at: new Date().toISOString(), metadata: { author_user_name: 'thsottiaux' } })) }) });
  w.context.chrome.notifications.create = async () => { throw new Error(imageError); };
  const result = await w.context.refreshSignals();
  assert.equal(result.ok, true); assert.equal(w.local.signalError, null);
  assert.equal(w.local.hintSnapshot.items.length, 2);
  assert.equal(w.local.pendingNotifications.length, 2);
  assert.equal(Object.keys(w.local.notificationHistory || {}).length, 0);
});

test('test notification is explicit, trusted-options-only, and never queued as a real signal', async () => {
  const w = makeWorker({ stored: { settings: { monitorAccount: false, monitorSignals: false, quietHoursEnabled: true } } });
  w.context.chrome.notifications.getPermissionLevel = async () => 'granted';
  const result = await w.send({ type: 'TEST_NOTIFICATION' }, w.sender('options'));
  assert.equal(result.ok, true); checkIcon(w, w.notifications['radar-test']);
  assert.match(w.notifications['radar-test'].title, /테스트/);
  assert.equal(w.requests.length, 0);
  assert.equal((w.local.pendingNotifications || []).length, 0);
  assert.equal((await w.send({ type: 'TEST_NOTIFICATION' }, w.sender('popup'))).ok, false);
  assert.equal((await w.send({ type: 'TEST_NOTIFICATION', iconUrl: 'https://evil.test/icon.png' }, w.sender('options'))).ok, false);
});

test('test notification reports permission and image failures without an unhandled rejection or retry', async () => {
  const w = makeWorker();
  w.context.chrome.notifications.getPermissionLevel = async () => 'denied';
  assert.equal((await w.send({ type: 'TEST_NOTIFICATION' }, w.sender('options'))).reason, 'denied');
  w.context.chrome.notifications.getPermissionLevel = async () => 'granted';
  w.context.chrome.notifications.create = async () => { throw new Error(imageError); };
  assert.equal((await w.send({ type: 'TEST_NOTIFICATION' }, w.sender('options'))).reason, 'image');
  assert.equal((w.local.pendingNotifications || []).length, 0);
});

test('notification normalization removes legacy auxiliary image URLs', async () => {
  const w = makeWorker();
  await w.context.createNotification('signal:legacy', { title: '알림', message: '본문', type: 'image',
    iconUrl: 'missing.png', imageUrl: 'https://example.invalid/a.png', appIconMaskUrl: 'missing-mask.png',
    buttons: [{ title: '확인', iconUrl: 'missing-button.png' }] }, { quietHoursEnabled: false });
  const options = w.notifications['signal:legacy'];
  checkIcon(w, options); assert.equal(options.type, 'basic');
  assert.equal(options.imageUrl, undefined); assert.equal(options.appIconMaskUrl, undefined);
  assert.equal(options.buttons[0].iconUrl, undefined); assert.equal(options.silent, false);
});

test('diagnostic messages do not depend on account/feed startup and do not reveal notification content', async () => {
  const w = makeWorker();
  w.context.chrome.storage.local.setAccessLevel = async () => { throw new Error('unrelated startup failure'); };
  w.context.chrome.notifications.getPermissionLevel = async () => 'granted';
  const result = await w.send({ type: 'TEST_NOTIFICATION' }, w.sender('options'));
  assert.equal(result.ok, true); assert.equal(result.version, manifest.version);
  const status = await w.send({ type: 'NOTIFICATION_STATUS' }, w.sender('options'));
  assert.equal(status.ok, true); assert.equal(status.version, manifest.version);
  assert.equal(status.delivery.status, 'accepted'); assert.equal(status.delivery.test, true);
  assert.equal(status.delivery.title, undefined); assert.equal(status.delivery.id, undefined);
  assert.equal(w.requests.length, 0);
  assert.equal((await w.send({ type: 'NOTIFICATION_STATUS' }, w.sender('popup'))).ok, false);
  assert.equal((await w.send({ type: 'NOTIFICATION_STATUS', url: 'https://evil.test' }, w.sender('options'))).ok, false);
});

test('normal delivery failure is recorded separately from the pending alert body', async () => {
  const w = makeWorker();
  w.context.chrome.notifications.create = async () => { throw new Error(imageError); };
  await w.context.createNotification('signal:secretid', { title: 'private-title', message: 'private-message' }, { quietHoursEnabled: false });
  assert.equal(w.local.notificationDelivery.status, 'failed');
  assert.equal(w.local.notificationDelivery.reason, 'image');
  assert.doesNotMatch(JSON.stringify(w.local.notificationDelivery), /secretid|private-title|private-message/);
  assert.equal(w.local.pendingNotifications.length, 1);
});
