const test = require('node:test');
const assert = require('node:assert/strict');
global.RadarTime = require('../src/core/time');
global.RadarSignals = require('../src/core/signals');
global.RadarNews = require('../src/core/news');
const Events = require('../src/core/events');
const Settings = require('../src/core/settings');
const Forecast = require('../src/core/forecast');
const { makeWorker } = require('./helpers/worker');
const settings = Settings.sanitize();
const now = Date.parse('2026-09-28T18:00:00Z');
const end = Date.parse('2026-09-30T02:00:00Z');
const post = (text = 'DevDay, 29th September 2026!', extra = {}) => ({ id: '901', author: 'reach_vb', text,
  createdAt: '2026-09-27T12:00:00Z', source: { id: 'codex-lead', weight: 1 }, url: 'https://x.com/reach_vb/status/901', ...extra });

test('official DevDay banner appears with empty or reset-only caches without fabricating tweet evidence', () => {
  for (const snapshot of [null, {reports:[post('Reset should be reflected for everyone - happy weekend!!')]}]) {
    const pins = Events.pinned(snapshot, {items:[]}, settings, {now});
    assert.equal(pins.length,1); assert.equal(pins[0].id,'devday-2026');
    assert.equal(pins[0].officialOnly,true); assert.equal(pins[0].item,null);
    assert.equal(pins[0].endAt,end);
  }
  assert.deepEqual(RadarNews.list(null,{items:[]},settings),[]);
  assert.equal(Events.pinned(null,null,settings,{now:end-1}).length,1);
  assert.equal(Events.pinned(null,null,settings,{now:end}).length,0);
  assert.equal(Events.pinned(null,null,settings,{now:Date.parse('2026-09-20T00:00:00Z')}).length,0);
});

test('an earlier ending or cancellation is not revived by the official fallback', () => {
  const earlier = post('DevDay moved to September 28, 2026 from 1am to 2am PT.',{id:'900',createdAt:'2026-09-28T08:00:00Z'});
  const cached=Events.reconcile([], [earlier], {now});
  assert.equal(cached.length,1);
  assert.equal(Events.pinned(null,{events:cached},settings,{now}).length,0);
  assert.equal(Events.pinned(null,{items:[post('DevDay has ended.')]},settings,{now}).length,0);
});

test('DevDay uses the verified official schedule even when the tweet omits times', () => {
  const event = Events.resolve(post());
  assert.equal(event.keynoteAt, Date.parse('2026-09-29T17:00:00Z'));
  assert.equal(event.endAt, end);
  assert.equal(event.officialUrl, 'https://devday.openai.com/');
  const lines = Events.describe(event).join('\n');
  assert.match(lines, /9월 30일.*오전 2:00/);
  assert.match(lines, /9월 30일.*오전 11:00/);
  assert.match(lines, /PT/);
  assert.doesNotMatch(lines, /오전 02:/);
});

test('the day-month ordering and same-day event time range convert across the Korean date boundary', () => {
  const event = Events.resolve(post('OpenAI livestream on 6th October 2026 from 10am to 7pm PT.'));
  assert.equal(event.startAt, Date.parse('2026-10-06T17:00:00Z'));
  assert.equal(event.endAt, Date.parse('2026-10-07T02:00:00Z'));
  const retained = Events.pinned(null, { items: [event.item] }, settings, { now: event.endAt - 1 });
  assert.equal(retained.length, 1);
  assert.equal(Events.pinned(null, { items: [event.item] }, settings, { now: event.endAt }).length, 0);
});

test('repeated identical zones at both ends preserve a range without accepting competing or malformed zones', () => {
  for (const [zone, start, end] of [
    ['PT', '2026-10-06T17:00:00Z', '2026-10-07T02:00:00Z'],
    ['UTC+05:30', '2026-10-06T04:30:00Z', '2026-10-06T13:30:00Z']
  ]) {
    const event = Events.resolve(post(`OpenAI event October 6, 2026 from 10am ${zone} to 7pm ${zone}.`));
    assert.equal(event.startAt, Date.parse(start), zone);
    assert.equal(event.endAt, Date.parse(end), zone);
    assert.equal(Events.pinned(null, { items: [event.item] }, settings, { now: event.endAt - 1 }).length, 1);
    assert.equal(Events.pinned(null, { items: [event.item] }, settings, { now: event.endAt }).length, 0);
  }
  for (const text of [
    'OpenAI event October 6, 2026 from 10am PT to 7pm ET.',
    'OpenAI event October 6, 2026 from 10am PT to 7pm PST.',
    'OpenAI event October 6, 2026 from 10am UTC+05:30 to 7pm UTC+05:45.',
    'OpenAI event October 6, 2026 from 10am UTC+5 to 7pm UTC+5.5.'
  ]) assert.equal(Events.resolve(post(text)), null, text);
});

test('date-only and start-only events never invent an exact end time', () => {
  for (const text of ['OpenAI event on October 6, 2026.', 'OpenAI event on October 6, 2026 at 10am PT.']) {
    const event = Events.resolve(post(text));
    assert.equal(event.endAt, null);
    assert.match(Events.describe(event).join('\n'), /종료 미정/);
    assert.ok(event.until >= Date.parse('2026-10-07T07:00:00Z'));
  }
  const multi = Events.resolve(post('Developer conference October 6–8, 2026.'));
  assert.equal(multi.endDate.day, 8);
  assert.equal(multi.endAt, null);
});

test('known events do not lend their dates to a different edition, city, or announced day', () => {
  for (const text of ['DevDay 2027.', 'DevDay Exchange in Tokyo soon.', 'DevDay on October 6, 2026.']) {
    const event = Events.resolve(post(text));
    assert.notEqual(event?.officialUrl, 'https://devday.openai.com/', text);
  }
  assert.equal(Events.resolve(post('DevDay recap from last week.')), null);
  assert.equal(Events.resolve(post('DevDay soon', {author:'someone'})), null);
  assert.equal(Events.resolve(post('Lunch tomorrow.')), null);
  assert.equal(Events.resolve(post('Maybe DevDay on September 29?')), null);
  assert.equal(Events.resolve(post('DevDay on 2026-02-30.')), null);
});

test('one event stays pinned past the tweet age limit and until its ending, without changing resets', () => {
  const old = post('Join us at DevDay on September 29, 2026.', {createdAt:'2026-09-01T12:00:00Z'});
  assert.equal(RadarSignals.classifyHint(old, {now}).candidate, false);
  const cached = Events.reconcile([], [old], {now});
  assert.equal(Events.reconcile(cached, [], {now:now+86400000}).length, 1);
  assert.equal(Events.pinned(null, {events:cached}, settings, {now:end-1}).length, 1);
  assert.equal(Events.pinned(null, {events:cached}, settings, {now:end}).length, 0);
  assert.equal(RadarSignals.classify(old, {now}).actionable, false);
  assert.equal(Forecast.build({signal:null,signals:[],timeZone:'Asia/Seoul',now}).basis, 'baseline');
});

test('duplicate announcements collapse and the latest cancellation prevents re-pinning older posts', () => {
  const a = post();
  const b = post('Can’t wait for DevDay.', {id:'902',author:'thsottiaux',createdAt:'2026-09-28T10:00:00Z'});
  const c = post('DevDay is postponed.', {id:'903',author:'OpenAI',createdAt:'2026-09-28T11:00:00Z'});
  assert.equal(Events.pinned(null,{items:[a,b]},settings,{now}).length,1);
  const cached = Events.reconcile([a,b],[c],{now});
  assert.equal(cached[0].id,'903');
  assert.equal(Events.pinned(null,{events:cached,items:[a,b]},settings,{now}).length,0);
  assert.equal(Events.pinned(null,{items:[a,{...c,text:'DevDay has ended.'}]},settings,{now}).length,0);
});

test('multi-day ranges and numeric timezone offsets preserve real ending boundaries', () => {
  const event = Events.resolve(post('Developer conference October 6, 2026 10am to October 8, 2026 7pm PT.'));
  assert.equal(event.endAt,Date.parse('2026-10-09T02:00:00Z'));
  const offset = Events.resolve(post('OpenAI event on October 6, 2026 from 10am to 7pm UTC+05:30.'));
  assert.equal(offset.startAt,Date.parse('2026-10-06T04:30:00Z'));
  assert.equal(offset.endAt,Date.parse('2026-10-06T13:30:00Z'));
  assert.equal(Events.resolve(post('OpenAI event on 2026-03-08 from 2:30am to 3:30am PT.')),null);
});

test('a revised DevDay date wins over the bundled schedule', () => {
  const revised = post('DevDay moved to October 1, 2026 from 10am to 5pm PT.', {id:'904',createdAt:'2026-09-28T11:00:00Z'});
  const event = Events.pinned(null,{items:[post(),revised]},settings,{now})[0];
  assert.equal(event.item.id,'904');
  assert.equal(event.startAt,Date.parse('2026-10-01T17:00:00Z'));
  assert.equal(event.endAt,Date.parse('2026-10-02T00:00:00Z'));
  assert.equal(event.officialUrl,undefined);
});

test('monitoring switches hide event banners and unexpected/future timestamps are ignored', () => {
  assert.equal(Events.pinned(null,{items:[post()]},{...settings,monitorSignals:false},{now}).length,0);
  assert.equal(Events.pinned(null,{items:[post()]},{...settings,monitorLeadSource:false},{now}).length,0);
  assert.equal(Events.reconcile([], [post(undefined,{createdAt:'2027-01-01T00:00:00Z'})], {now}).length,0);
});

test('worker restart and an empty refresh retain event evidence beyond normal hint lifetime', async () => {
  const realNow = Date.now();
  const future = new Date(realNow + 20 * 86400000).toISOString().slice(0,10);
  const old = post(`OpenAI livestream on ${future} from 10am to 7pm PT.`,{createdAt:new Date(realNow-10*86400000).toISOString()});
  const worker = makeWorker({stored:{settings:{monitorAccount:false,monitorSignals:true,monitorLeadSource:true},hintSnapshot:{items:[old]}}});
  await worker.context.revalidateCachedSignals(0);
  assert.equal(worker.local.hintSnapshot.items.length,0);
  assert.equal(worker.local.hintSnapshot.events[0].id,old.id);
  await worker.context.refreshSignals({quiet:true});
  assert.equal(worker.local.hintSnapshot.events[0].id,old.id);
  const result = await worker.send({type:'OPEN_NEWS',id:'codex-lead:'+old.id},worker.sender('popup'));
  assert.equal(result.ok,true);
  assert.equal(worker.tabs.at(-1).url,old.url);
  assert.equal(Object.keys(worker.notifications).length,0);
});
