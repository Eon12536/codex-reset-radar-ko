const test = require('node:test');
const assert = require('node:assert/strict');
const { makeWorker } = require('./helpers/worker.js');

test('weekly badge includes the percent unit at zero, partial and full quota', async () => {
  const w = makeWorker();
  const labels = [];
  w.context.chrome.action.setBadgeText = async ({text}) => labels.push(text);
  for (const remainingPercent of [0,1,31,99,100]) {
    await w.context.updateBadge({usage:{windows:[{kind:'weekly',remainingPercent}]}},null,null);
  }
  await w.context.updateBadge(null,null,null);
  assert.deepEqual(labels,['0%','1%','31%','99%','100%','']);
});

test('signals append a marker while urgent advice preserves known weekly quota', async () => {
  const w = makeWorker();
  const labels=[];
  w.context.chrome.action.setBadgeText = async ({text}) => labels.push(text);
  const snapshot={usage:{windows:[{kind:'weekly',remainingPercent:31}]}};
  const signal={firstDetectedAt:Date.now(),assessment:{actionable:true}};
  await w.context.updateBadge(snapshot,signal,null);
  await w.context.updateBadge(snapshot,null,{tier:'blocked'});
  await w.context.updateBadge(snapshot,null,{tier:'expiring'});
  await w.context.updateBadge({usage:{windows:[{kind:'weekly',remainingPercent:100}]}},signal,null);
  await w.context.updateBadge({usage:{windows:[{kind:'weekly',remainingPercent:0}]}},signal,null);
  await w.context.updateBadge(snapshot,{assessment:{actionable:false}},null);
  await w.context.updateBadge(null,signal,null);
  assert.deepEqual(labels,['31%!','31%','31%','100%!','0%!','31%','신호']);
});

test('badge expires exactly 24 hours after detection, not the predicted reset time', async () => {
  const w=makeWorker();
  const start=Date.parse('2026-09-23T00:00:00Z');
  let now=start;
  w.context.Date=class extends Date { static now(){return now;} };
  const labels=[],alarms=[];
  w.context.chrome.action.setBadgeText=async ({text})=>labels.push(text);
  w.context.chrome.alarms.create=async (name,options)=>alarms.push({name,...options});
  const snapshot={usage:{windows:[{kind:'weekly',remainingPercent:80}]}};
  const signal={firstDetectedAt:start,assessment:{actionable:true,eventAt:start+7*86400000}};
  await w.context.updateBadge(snapshot,signal,null);
  now=start+86400000-1;
  await w.context.updateBadge(snapshot,signal,null);
  now++;
  await w.context.updateBadge(snapshot,signal,null);
  assert.deepEqual(labels,['80%!','80%!','80%']);
  assert.ok(alarms.every(alarm=>alarm.when===start+86400000));
});

test('ordinary quota advice cannot leave an unexplained exclamation mark when weekly usage is unknown', async () => {
  const w = makeWorker(), labels = [];
  w.context.chrome.action.setBadgeText = async ({ text }) => labels.push(text);
  for (const tier of ['blocked', 'expiring']) await w.context.updateBadge(null, null, { tier });
  assert.deepEqual(labels, ['', '']);
});

test('repeat collection and restart preserve detection time; a new post gets a new clock', () => {
  const start=Date.parse('2026-09-23T00:00:00Z');
  const w=makeWorker();
  let now=start;
  w.context.Date=class extends Date { static now(){return now;} };
  const post={id:'post-1',text:'We will reset Codex usage limits next week',createdAt:start,source:{id:'codex-lead',weight:1}};
  const first=w.context.reclassifiedSignals([], [post]);
  assert.equal(first[0].firstDetectedAt,start);
  now+=86400000;
  const repeated=w.context.reclassifiedSignals(first,[post]);
  assert.equal(repeated[0].firstDetectedAt,start);
  const restarted=makeWorker();
  restarted.context.Date=w.context.Date;
  const restored=restarted.context.reclassifiedSignals(JSON.parse(JSON.stringify(repeated)),[post,{...post,id:'post-2',createdAt:now}]);
  assert.equal(restored.find(x=>x.id==='post-1').firstDetectedAt,start);
  assert.equal(restored.find(x=>x.id==='post-2').firstDetectedAt,now);
  assert.equal(restarted.context.reclassifiedSignals([post])[0].firstDetectedAt,start);
});

test('expiry alarm clears the badge offline without removing the news', async () => {
  const w=makeWorker();
  await w.context.ensureSecurity();
  const start=Date.now()-86400000;
  const signal={id:'post-1',firstDetectedAt:start,assessment:{actionable:true}};
  w.local.accountSnapshot={usage:{windows:[{kind:'weekly',remainingPercent:80}]}};
  w.local.signalSnapshot={signal,activeSignals:[signal]};
  const labels=[];
  w.context.chrome.action.setBadgeText=async ({text})=>labels.push(text);
  const before=w.requests.length;
  await w.events.alarm({name:'codex-reset-radar-badge-expiry'});
  assert.equal(labels.at(-1),'80%');
  assert.equal(w.requests.length,before);
  assert.equal(w.local.signalSnapshot.signal.id,'post-1');
});
