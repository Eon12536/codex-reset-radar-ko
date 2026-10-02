const test = require('node:test');
const assert = require('node:assert/strict');
global.RadarTime = require('../src/core/time');
const News = require('../src/core/news');
const post = (text, createdAt = '2026-09-21T06:26:15Z', extra = {}) => ({
  text, createdAt, author: 'thsottiaux', source: { id: 'codex-lead' }, ...extra
});

test('provided Tuesday clock uses publication in San Francisco and converts to Korea', () => {
  const result = News.schedule(post('3am on a tuesday'));
  assert.equal(result.text, '미 서부 9/22(화) 오전 3:00\n한국 9/22(화) 오후 7:00 · 추정');
  assert.equal(new Date(result.instant).toISOString(), '2026-09-22T10:00:00.000Z');
  assert.equal(result.assumedZone, true);
  assert.equal(result.dateInferred, true);
  assert.match(result.detail, /실제 체류지는 다를 수/);
  assert.match(result.detail, /출시·리셋 확정을 뜻하지/);
});

test('Korean next day includes the calendar day with an unpadded twelve-hour clock', () => {
  assert.equal(News.schedule(post('Tuesday at 6:30 PM')).text,
    '미 서부 9/22(화) 오후 6:30\n한국 9/23(수) 오전 10:30 · 추정');
});

test('explicit zones take precedence over the Tibo fallback', () => {
  for (const [zone, expected] of [['UTC', '오전 9:00'], ['KST', '오전 12:00'], ['PST', '오후 5:00'], ['PDT', '오후 4:00'], ['JST', '오전 12:00']]) {
    const result = News.schedule(post(`2026-09-22 at 00:00 ${zone}`));
    assert.equal(result.text, `${zone} 9/22(화) 오전 12:00\n한국 9/22(화) ${expected}`);
    assert.equal(result.assumedZone, false);
    assert.equal(result.dateInferred, false);
  }
});

test('PT and the implicit regional default use daylight saving for the target date', () => {
  for (const [date, suffix, hour] of [['2026-07-07', 'PT', '오후 7:00'], ['2026-01-06', 'PT', '오후 8:00'],
    ['2026-01-06', '', '오후 8:00'], ['2026-07-07', 'Pacific Standard Time', '오후 8:00']]) {
    const result = News.schedule(post(`${date} at 3am ${suffix}`));
    assert.ok(result.text.includes(hour), result.text);
  }
});

test('explicit UTC offsets, minutes and year rollover are preserved', () => {
  assert.equal(News.schedule(post('2026-12-31 11:30 PM UTC-08:00')).text,
    'UTC-08:00 2026년 12/31(목) 오후 11:30\n한국 2027년 1/1(금) 오후 4:30');
  assert.equal(News.schedule(post('2026-09-22 11:15 PM GMT+0530')).text,
    'GMT+0530 9/22(화) 오후 11:15\n한국 9/23(수) 오전 2:45');
});

test('tomorrow is anchored to the source date, not the Korean publication date', () => {
  const result = News.schedule(post('Tomorrow at 3am'));
  assert.equal(result.text, '미 서부 9/21(월) 오전 3:00\n한국 9/21(월) 오후 7:00 · 추정');
});

test('a cached weekday does not drift when viewed later', () => {
  const originalNow = Date.now;
  try {
    Date.now = () => Date.parse('2026-09-21T08:00:00Z');
    const first = News.schedule(post('3am on a tuesday'));
    Date.now = () => Date.parse('2026-10-21T08:00:00Z');
    assert.deepEqual(News.schedule(post('3am on a tuesday')), first);
  } finally { Date.now = originalNow; }
});

test('weekday-only hints do not acquire a midnight reset time', () => {
  const result = News.schedule(post('OK fine. But it’s also still coming in Tuesday'));
  assert.equal(result.text, '화요일 · 미 서부 추정\n한국 시각 미정');
  assert.equal(result.instant, undefined);
});

test('missing, invalid and ambiguous dates or zones remain unresolved', () => {
  for (const text of ['3am', '2026-02-29 at 3am', 'Tuesday at 3am IST', 'Tuesday at 3am CST',
    'Tuesday at 3am UTC+25', 'Tuesday at 3am UTC+5.5', 'Tuesday at 3am PT / 6am ET', 'Tuesday at 3am HKT',
    'Tuesday or Wednesday at 3am', 'next week Tuesday at 3am',
    'Not Tuesday at 3am', 'Tuesday between 3am and 4am', 'Tuesday before 3am', 'Tuesday by 3am']) {
    const result = News.schedule(post(text));
    assert.equal(result.instant, undefined, text);
    assert.match(result.text, /한국 날짜·시각 미정/, text);
  }
});

test('missing publication dates do not produce an invented relative date', () => {
  assert.equal(News.schedule(post('Tuesday at 3am', null)).instant, undefined);
  assert.equal(News.schedule(post('2026-09-22 at 3am PT', null)).instant, Date.parse('2026-09-22T10:00:00Z'));
});

test('the US default is only assigned to Tibo; explicit zones also work for other sources', () => {
  for (const extra of [{ author: 'someone' }, { source: { id: 'openai-status' } }]) {
    assert.equal(News.schedule(post('Tuesday at 3am', undefined, extra)).instant, undefined);
    assert.equal(News.schedule(post('2026-09-22 at 3am KST', undefined, extra)).instant, Date.parse('2026-09-21T18:00:00Z'));
  }
});

test('nonexistent and repeated PT wall clocks are not shown as a unique reset moment', () => {
  const gap = News.schedule(post('2026-03-08 at 2:30am PT'));
  const overlap = News.schedule(post('2026-11-01 at 1:30am PT'));
  assert.equal(gap.instant, undefined);
  assert.match(gap.detail, /존재하지 않는/);
  assert.equal(overlap.instant, undefined);
  assert.match(overlap.detail, /두 번 존재/);
  assert.equal(News.schedule(post('2026-11-01 at 1:30am PST')).instant, Date.parse('2026-11-01T09:30:00Z'));
});

test('month-day, explicit year, and weekday qualifiers have stable publication-based dates', () => {
  assert.equal(News.schedule(post('September 22, 2026 at 3am PT')).instant, Date.parse('2026-09-22T10:00:00Z'));
  assert.equal(News.schedule(post('1/1 at 3am PT', '2026-12-31T12:00:00Z')).instant, Date.parse('2027-01-01T11:00:00Z'));
  assert.equal(News.schedule(post('next Tuesday at 3am PT', '2026-09-22T12:00:00Z')).instant, Date.parse('2026-09-29T10:00:00Z'));
  assert.equal(News.schedule(post('this Tuesday at 3am PT', '2026-09-23T12:00:00Z')).instant, Date.parse('2026-09-22T10:00:00Z'));
});
