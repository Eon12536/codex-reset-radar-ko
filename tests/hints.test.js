const test = require('node:test');
const assert = require('node:assert/strict');
global.RadarTime = require('../src/core/time.js');
global.RadarSignals = require('../src/core/signals.js');
const Signals = global.RadarSignals;
const Settings = require('../src/core/settings.js');
const Forecast = require('../src/core/forecast.js');
const {makeWorker,json} = require('./helpers/worker.js');
const makeHint = (text='Maybe we should dust off the reset button tomorrow.', extra={}) => ({id:'123456',text,author:'thsottiaux',createdAt:new Date().toISOString(),source:{id:'codex-lead',weight:1},url:'https://x.com/thsottiaux/status/123456',...extra});

test('known indirect patterns become hints without entering reset forecasts', () => {
  for (const text of ['Maybe we should dust off the reset button tomorrow.', 'Time to refuel Codex soon.', 'Codex could get a fresh start tomorrow.']) {
    const hint=makeHint(text); const result=Signals.classifyHint(hint);
    assert.equal(result.candidate,true,text);assert.equal(result.actionable,false);assert.equal(result.eventAt,null);
    assert.equal(Signals.actionable([hint]).length,0);
    assert.equal(Forecast.build({signals:[{...hint,assessment:result}],timeZone:'Asia/Seoul'}).basis,'baseline');
  }
});

test('gifts, merchandise, unrelated resets, completed actions and negations do not become hints', () => {
  for (const text of [
    '2026 is the year of efficiency and Tuesday is for random swag drops on your door handle',
    'A surprise gift for Codex fans tomorrow.',
    'Maybe dust off the password reset button tomorrow.',
    'Maybe dust off the reset button for Claude tomorrow.',
    'Codex has now been reset. Another round of product news tomorrow.',
    'We will not refuel Codex tomorrow.',
    'Time to refuel the car soon.',
    'The moon wears a silver hat tonight.'
  ]) assert.equal(Signals.classifyHint(makeHint(text)).candidate,false,text);
});

test('hints require the lead feed, matching author and a recent timestamp', () => {
  for(const extra of [{author:'someone_else'},{source:{id:'github-community'}},{createdAt:null},{createdAt:new Date(Date.now()-169*3600000).toISOString()},{createdAt:new Date(Date.now()+3600000).toISOString()}]) assert.equal(Signals.classifyHint(makeHint(undefined,extra)).candidate,false);
  assert.equal(Signals.classifyHint(makeHint('We will reset Codex usage limits later today.')).candidate,false);
});

test('hint list is bounded, ordered and removes a candidate when the same post changes', () => {
  const items=Array.from({length:5},(_,i)=>makeHint(undefined,{id:String(i),createdAt:new Date(Date.now()-i*60000).toISOString()}));
  assert.deepEqual(Signals.hintCandidates(items).map(h=>h.id),['0','1','2']);
  assert.equal(Signals.hintCandidates([items[0],{...items[0],text:'No reset tomorrow.'}]).length,0);
  assert.equal(Signals.hintCandidates(items, { limit: 100 }).length, 5);
  const many = Array.from({ length: 120 }, (_, i) => makeHint(undefined, { id: String(i) }));
  assert.equal(Signals.hintCandidates(many, { limit: 1000 }).length, 100);
});

function workerForHints(notifyHints=false) {
  return makeWorker({stored:{settings:{monitorAccount:false,monitorSignals:true,monitorLeadSource:true,monitorStatusSource:false,monitorHistorySource:false,monitorCommunitySource:false,quietHoursEnabled:false,notifyHints}}, fetcher:async()=>json({items:[{external_id:'123456',content:makeHint().text,published_at:new Date().toISOString(),metadata:{author_user_name:'thsottiaux'}}]})});
}

test('hints display with notifications off by default and never become actionable snapshots', async()=>{
  assert.equal(Settings.sanitize().notifyHints,false);
  const w=workerForHints();await w.context.refreshSignals();
  assert.equal(w.local.hintSnapshot.items.length,1);assert.equal(w.local.signalSnapshot.signal,null);
  assert.equal(w.local.signalSnapshot.activeSignals.length,0);assert.equal(Object.keys(w.notifications).length,0);
});

test('opted-in hint notifications are Korean, deduplicated and removed when disabled', async()=>{
  const w=workerForHints(true);await w.context.refreshSignals();await w.context.refreshSignals();
  assert.deepEqual(Object.keys(w.notifications),['hint:123456']);
  assert.match(w.notifications['hint:123456'].title,/암시 후보.*미확인/);
  assert.match(w.notifications['hint:123456'].message,/리셋 확정이 아닙니다/);
  await w.context.saveSettings({...w.local.settings,notifyHints:false});
  assert.equal(Object.keys(w.notifications).length,0);assert.equal(w.local.hintSnapshot.items.length,1);
});

test('queued hint notifications respect disabled settings and stale candidates', async()=>{
  const w=workerForHints(true);await w.context.ensureSecurity();
  const hint=makeHint();w.local.hintSnapshot={items:[hint]};
  w.local.pendingNotifications=[{id:'hint:123456',options:{title:'queued'}}];
  w.local.settings.notifyHints=false;await w.context.flushPendingNotifications();
  assert.equal(Object.keys(w.notifications).length,0);
  w.local.settings.notifyHints=true;w.local.hintSnapshot.items[0].createdAt=new Date(Date.now()-169*3600000).toISOString();
  w.local.pendingNotifications=[{id:'hint:123456',options:{title:'stale'}}];
  await w.context.flushPendingNotifications();assert.equal(Object.keys(w.notifications).length,0);
});

test('hint evidence messages require the popup and a safe link; disabled sources erase hints', async()=>{
  const w=workerForHints();await w.context.refreshSignals();
  assert.equal((await w.send({type:'OPEN_HINT'},w.sender('options'))).ok,false);
  assert.equal((await w.send({type:'OPEN_HINT',url:'https://audit-phishing.invalid/'},w.sender('popup'))).ok,false);
  assert.equal((await w.send({type:'OPEN_HINT'},w.sender('popup'))).ok,true);
  assert.equal(w.tabs[0].url,'https://x.com/thsottiaux/status/123456');
  w.local.hintSnapshot.items[0].url='https://audit-phishing.invalid/';
  assert.equal((await w.send({type:'OPEN_HINT'},w.sender('popup'))).ok,false);
  await w.context.saveSettings({...w.local.settings,monitorLeadSource:false});
  assert.equal(w.local.hintSnapshot,undefined);assert.equal((await w.send({type:'OPEN_HINT'},w.sender('popup'))).ok,false);
});

test('quiet hours queue a hint once and deliver it only while its evidence remains current', async()=>{
  const w=workerForHints(true);await w.context.ensureSecurity();
  const now=new Date(); const minute=now.getUTCHours()*60+now.getUTCMinutes();
  const hhmm=offset=>{const m=(minute+offset+1440)%1440;return String(Math.floor(m/60)).padStart(2,'0')+':'+String(m%60).padStart(2,'0');};
  Object.assign(w.local.settings,{quietHoursEnabled:true,timezoneMode:'manual',timezoneOverride:'UTC',quietStart:hhmm(-30),quietEnd:hhmm(30)});
  await w.context.refreshSignals();await w.context.refreshSignals();
  assert.equal(w.local.pendingNotifications.length,1);assert.equal(Object.keys(w.notifications).length,0);
  w.local.settings.quietHoursEnabled=false;await w.context.flushPendingNotifications();
  assert.deepEqual(Object.keys(w.notifications),['hint:123456']);assert.equal(w.local.pendingNotifications.length,0);
  await w.events.notificationButton('hint:123456',0);assert.equal(w.tabs[0].url,'https://x.com/thsottiaux/status/123456');
});

function editableHintWorker() {
  const state = { text: 'An ordinary Codex product update.', fail: false, at: new Date().toISOString() };
  const w = makeWorker({
    stored: { settings: { monitorAccount: false, monitorSignals: true, monitorLeadSource: true,
      monitorStatusSource: false, monitorHistorySource: false, monitorCommunitySource: false,
      quietHoursEnabled: false, notifyHints: true } },
    fetcher: async () => {
      if (state.fail) throw new Error('Feed unavailable');
      return json({ items: [{ external_id: '123456', content: state.text, published_at: state.at,
        metadata: { author_user_name: 'thsottiaux' } }] });
    }
  });
  let count = 0;
  const create = w.context.chrome.notifications.create;
  w.context.chrome.notifications.create = async (id, options) => { count++; await create(id, options); };
  return { w, state, notificationCount: () => count };
}

function enableCurrentQuietHours(w) {
  const now = new Date();
  const minute = now.getUTCHours() * 60 + now.getUTCMinutes();
  const hhmm = offset => {
    const m = (minute + offset + 1440) % 1440;
    return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
  };
  Object.assign(w.local.settings, { quietHoursEnabled: true, timezoneMode: 'manual', timezoneOverride: 'UTC',
    quietStart: hhmm(-30), quietEnd: hhmm(30) });
}

test('an edited post can first become a hint, but reappearing after retraction never alerts twice', async () => {
  const { w, state, notificationCount } = editableHintWorker();
  await w.context.refreshSignals();
  assert.equal(w.local.hintSnapshot.items.length, 0);
  assert.equal(notificationCount(), 0);
  state.text = makeHint().text;
  await w.context.refreshSignals();
  await w.context.refreshSignals();
  assert.equal(w.local.hintSnapshot.items.length, 1);
  assert.equal(notificationCount(), 1);
  assert.ok(w.notifications['hint:123456']);
  w.notifications['signal:unrelated'] = { title: 'Keep unrelated notification' };
  state.text = 'No reset tomorrow.';
  await w.context.refreshSignals();
  assert.equal(w.local.hintSnapshot.items.length, 0);
  assert.equal(w.notifications['hint:123456'], undefined);
  assert.ok(w.notifications['signal:unrelated']);
  state.text = makeHint().text;
  await w.context.refreshSignals();
  assert.equal(w.local.hintSnapshot.items.length, 1);
  assert.equal(notificationCount(), 1);
  assert.equal(w.notifications['hint:123456'], undefined);
});

test('queued hints use the latest edited reason and retractions remove only their own queue entries', async () => {
  const { w, state, notificationCount } = editableHintWorker();
  await w.context.ensureSecurity();
  enableCurrentQuietHours(w);
  await w.context.refreshSignals();
  state.text = makeHint().text;
  await w.context.refreshSignals();
  const firstMessage = w.local.pendingNotifications[0].options.message;
  w.local.pendingNotifications.push({ id: 'signal:unrelated', options: { title: 'Keep unrelated queue' } });
  state.text = 'Time to refuel Codex soon.';
  await w.context.refreshSignals();
  assert.equal(w.local.pendingNotifications.length, 2);
  const pending = w.local.pendingNotifications.find(item => item.id === 'hint:123456');
  assert.notEqual(pending.options.message, firstMessage);
  assert.ok(pending.options.message.includes(w.local.hintSnapshot.items[0].assessment.reason));
  state.text = 'No reset tomorrow.';
  await w.context.refreshSignals();
  assert.deepEqual(w.local.pendingNotifications, [{ id: 'signal:unrelated', options: { title: 'Keep unrelated queue' } }]);
  state.text = makeHint().text;
  await w.context.refreshSignals();
  // This restored candidate was never delivered while quiet. It may be queued
  // again; an earlier retracted queue entry is not proof of a sent alert.
  assert.equal(w.local.pendingNotifications.length, 2);
  assert.equal(w.local.notificationHistory?.['hint:123456'], undefined);
  assert.equal(notificationCount(), 0);
});

test('a failed lead feed preserves current hints but still expires their visible and queued notifications', async () => {
  const { w, state } = editableHintWorker();
  state.text = makeHint().text;
  await w.context.refreshSignals();
  state.fail = true;
  assert.equal((await w.context.refreshSignals({ quiet: true })).ok, false);
  assert.equal(w.local.hintSnapshot.items.length, 1);
  assert.ok(w.notifications['hint:123456']);
  w.local.hintSnapshot.items[0].createdAt = new Date(Date.now() - 169 * 3600000).toISOString();
  w.local.pendingNotifications = [
    { id: 'hint:123456', options: { title: 'Expired hint' } },
    { id: 'signal:unrelated', options: { title: 'Keep unrelated queue' } }
  ];
  await w.context.refreshSignals({ quiet: true });
  assert.equal(w.local.hintSnapshot.items.length, 0);
  assert.equal(w.notifications['hint:123456'], undefined);
  assert.deepEqual(w.local.pendingNotifications, [{ id: 'signal:unrelated', options: { title: 'Keep unrelated queue' } }]);
});

test('previously missed hints within seven days can notify on their first collection', async () => {
  const w = workerForHints(true);
  await w.context.ensureSecurity();
  const now = Date.now();
  w.context.fetch = async () => json({ items: [0, 1, 2].map(index => ({
    external_id: String(123450 + index), content: makeHint().text,
    published_at: new Date(now - (index === 2 ? 13 * 3600000 : index * 60000)).toISOString(),
    metadata: { author_user_name: 'thsottiaux' }
  })) });
  await w.context.refreshSignals();
  assert.equal(w.local.hintSnapshot.items.length, 3);
  assert.deepEqual(Object.keys(w.notifications).sort(), ['hint:123450', 'hint:123451', 'hint:123452']);
});
