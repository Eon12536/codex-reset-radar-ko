const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { makeWorker } = require('./helpers/worker');

class Element {
  constructor(tag) { this.tagName = tag.toUpperCase(); this.children = []; this.dataset = {}; this.attributes = {}; this.className = ''; this.ownText = ''; this.classList = { add: name => { this.className += ' ' + name; } }; }
  set textContent(value) { this.ownText = String(value); this.children = []; }
  get textContent() { return this.ownText + this.children.map(child => child.textContent).join(' '); }
  append(...children) { for (const child of children) { child.parentNode = this; this.children.push(child); } }
  insertBefore(child, reference) { const i = this.children.indexOf(reference); child.parentNode = this; this.children.splice(i < 0 ? this.children.length : i, 0, child); }
  setAttribute(key, value) { this.attributes[key] = value; }
  addEventListener() {}
  get childElementCount() { return this.children.length; }
  get firstChild() { return this.children[0] || null; }
  get nextSibling() { return this.parentNode?.children[this.parentNode.children.indexOf(this) + 1] || null; }
}
const find = (node, className) => [node, ...node.children.flatMap(child => find(child, className))]
  .filter(element => element.className.split(' ').includes(className));

function setup() {
  const w = makeWorker();
  w.context.RadarI18n.setLocale('ko-KR');
  w.context.document = { createElement: tag => new Element(tag) };
  w.context.RadarNewsAvatar = { create: () => new Element('div') };
  const source = fs.readFileSync(require.resolve('../src/popup/popup.js'), 'utf8');
  vm.runInContext(source.slice(source.indexOf('function createDailyNewsCard('), source.indexOf('async function openNews(')), w.context);
  return w.context;
}

function row(id, assessment = {}, extra = {}) {
  return { key: 'codex-lead:' + id, label: 'reset', kindLabel: '리셋 언급', caption: '', timingDetail: '',
    publishedAt: Date.parse('2026-10-23T04:46:19Z'), publishedText: '10월 23일 오후 1:46',
    item: { id, author: 'thsottiaux', source: { id: 'codex-lead' }, text: 'That’s a reset!',
      url: 'https://x.com/thsottiaux/status/' + id, createdAt: '2026-10-23T04:46:19Z', assessment }, ...extra };
}

test('a compact daily card retains its date, summary, five chips, one schedule and every source link', () => {
  const c = setup();
  const items = [row('801'), row('802', { actionable: true }), row('803', { report: 'completed-reset' }), row('809', { candidate: true, rule: 'reset-metaphor' }), row('810', { report: 'credit-grant' })];
  items[0].item.text = 'Maybe reset Codex limits?';
  items[3].item.text = 'Time to refuel Codex soon.';
  const card = c.createDailyNewsCard({ day: '2026-10-25', items, times: [], ...c.RadarDailyNews.summary(items) }, { resetOnly: true });
  assert.match(find(card, 'daily-news-date')[0].textContent, /2026.*10.*25/);
  assert.match(find(card, 'daily-news-summary')[0].textContent, /5건 탐지/);
  const header = find(card, 'news-status-chips')[0];
  assert.equal(header.children.length, 5);
  assert.deepEqual(header.children.map(chip => chip.className.split(' ').at(-1)), ['is-forecast', 'is-completed', 'is-inferred', 'is-grant', 'is-muted']);
  assert.match(header.textContent, /신모델 출시 0/);
  assert.doesNotMatch(header.textContent, /리셋 언급/); assert.match(header.textContent, /리셋 추정 2/); assert.match(header.textContent, /리셋 예고/); assert.match(header.textContent, /리셋 완료/); assert.match(header.textContent, /리셋권 1/);
  const sources = find(card, 'daily-news-sources')[0];
  assert.equal(sources.children.length, 5);
  for (const source of sources.children) {
    assert.equal(source.children.length, 1);
    assert.equal(source.children[0].tagName, 'BUTTON');
    assert.ok(source.children[0].dataset.newsId);
  }
  assert.match(sources.children[4].textContent, /리셋권 지급/);
  assert.match(sources.children[1].textContent, /리셋 예고/);
  assert.equal(find(card, 'news-status-chip').length, 5);
  assert.equal(find(card, 'news-schedule-box').length, 1);
  assert.equal(find(card, 'daily-news-quote').length, 0);
});

test('zero status counts stay labelled and a known daily clock is shown once without repeated unknown boxes', () => {
  const c = setup(), reply = require('./fixtures/tibo-day18-oct23.json').posts[1];
  const time = c.RadarNews.schedule(reply);
  const items = [row('807', { actionable: true }, { timingSchedule: time }), row('808')];
  const card = c.createDailyNewsCard({ day: '2026-10-23', items, ...c.RadarDailyNews.summary(items) }, { resetOnly: true });
  assert.equal(find(card, 'news-status-chip').length, 5);
  assert.match(find(card, 'is-completed')[0].textContent, /0/);
  const box = find(card, 'news-schedule-box')[0];
  assert.match(box.textContent, /10\/24.*3:00.*이전/);
  assert.doesNotMatch(box.textContent, /미확인/);
  assert.equal(box.children.filter(child => child.tagName === 'TIME').length, 1);
});

test('each source schedule box uses its verified clock and keeps unresolved mentions unverified in both layouts', () => {
  const c = setup();
  const reply = require('./fixtures/tibo-day18-oct23.json').posts[1];
  const time = c.RadarNews.schedule(reply);
  const verified = row('804', { actionable: true }, { timingSchedule: time });
  const unknown = row('805');
  for (const compact of [false, true]) {
    const forecast = c.createNewsRow(verified, [verified, unknown], compact);
    const box = find(forecast, 'news-schedule-box')[0];
    assert.match(box.textContent, /한국.*10\/24.*3:00.*이전/);
    assert.equal(box.children[1].dateTime, '2026-10-23T18:00:00.000Z');
    const mention = c.createNewsRow(unknown, [verified, unknown], compact);
    assert.match(find(mention, 'news-schedule-box')[0].textContent, /리셋 시각 미확인/);
  }
});

test('unresolved reset timing retains the exact source wording without inventing a timestamp', () => {
  const c = setup(), soon = row('821', { actionable: true });
  soon.item.text = 'We will reset Codex usage limits soon.';
  const info = c.RadarDailyNews.verifiedTime(soon);
  assert.equal(info.verified, false); assert.match(info.text, /원문 시간 표현.*reset Codex usage limits soon/);
  assert.equal(info.at, undefined);
  const card = c.createDailyNewsCard({ day: '2026-10-23', items: [soon], ...c.RadarDailyNews.summary([soon]) }, { resetOnly: true });
  const box = find(card, 'news-schedule-box')[0];
  assert.match(box.textContent, /Tibo.*원문 시간 표현.*soon/);
  assert.match(box.textContent, /리셋 시각 미확인/);
  assert.equal(box.children.filter(child => child.tagName === 'TIME').length, 0);
  const single = find(c.createNewsRow(soon, [soon]), 'news-schedule-box')[0];
  assert.match(single.textContent, /원문 시간 표현.*soon/);
});

test('unrelated event timing, untrusted evidence and truncated bodies never become reset timing text', () => {
  const c = setup();
  for (const text of ['The launch is tomorrow; a reset is under consideration.', 'We shipped yesterday. Reset is under consideration.',
    'Launch tomorrow and reset is under consideration.', 'A reset may happen. The event is next week.']) {
    const item = row('822'); item.item.text = text;
    assert.equal(c.RadarDailyNews.timeExpression(item), '', text);
  }
  const valid = row('823'); valid.item.text = 'Reset should happen sometime this week.';
  assert.match(c.RadarDailyNews.timeExpression(valid), /this week/);
  valid.item.url = 'https://evil.test/status/823'; assert.equal(c.RadarDailyNews.timeExpression(valid), '');
  valid.item.url = 'https://x.com/thsottiaux/status/823'; valid.item.truncated = true;
  assert.equal(c.RadarDailyNews.timeExpression(valid), '');
});

test('verified time remains a time element rather than an unverified quotation', () => {
  const c = setup(), reply = require('./fixtures/tibo-day18-oct23.json').posts[1];
  const verified = row('824', { actionable: true }, { timingSchedule: c.RadarNews.schedule(reply) });
  const card = c.createDailyNewsCard({ day: '2026-10-23', items: [verified], ...c.RadarDailyNews.summary([verified]) }, { resetOnly: true });
  const box = find(card, 'news-schedule-box')[0];
  assert.equal(box.children.filter(child => child.tagName === 'TIME').length, 1);
  assert.doesNotMatch(box.textContent, /원문 시간 표현|미확인/);
});

test('a verified time and a separate unresolved timing quote both remain visible', () => {
  const c = setup(), reply = require('./fixtures/tibo-day18-oct23.json').posts[1];
  const verified = row('825', { actionable: true }, { timingSchedule: c.RadarNews.schedule(reply) });
  const unsure = row('826', { candidate: true }); unsure.item.text = 'Reset may be coming sometime next week.';
  const items = [verified, unsure];
  const box = find(c.createDailyNewsCard({ day: '2026-10-23', items, ...c.RadarDailyNews.summary(items) }, { resetOnly: true }), 'news-schedule-box')[0];
  assert.equal(box.children.filter(child => child.tagName === 'TIME').length, 1);
  assert.match(box.textContent, /원문 시간 표현.*next week/);
});

test('verified schedule helpers preserve the same instant across all selected countries', () => {
  const c = setup(), reply = require('./fixtures/tibo-day18-oct23.json').posts[1];
  for (const country of c.RadarI18n.COUNTRIES) {
    c.RadarI18n.setLocale(country.locale);
    const result = c.RadarDailyNews.verifiedTime({ item: reply });
    assert.equal(result.at, Date.parse('2026-10-23T18:00:00Z'), country.code);
    assert.ok(result.text.includes(country.timeLabel), country.code);
    assert.equal(result.verified, true);
  }
});
