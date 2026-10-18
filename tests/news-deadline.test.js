const test = require('node:test');
const assert = require('node:assert/strict');
const { makeWorker } = require('./helpers/worker');
const { context: r } = makeWorker();
const post = (text = 'Global reset landing by EOD PST time. Enjoy', createdAt = '2026-10-13T01:03:59Z', extra = {}) => ({
  text, createdAt, author: 'thsottiaux', source: { id: 'codex-lead' }, ...extra
});

test('the October 13 EOD promise shows its source-day deadline, never an execution instant', () => {
  r.RadarI18n.setLocale('ko-KR');
  const result = r.RadarNews.schedule(post());
  assert.equal(result.deadlineAt, Date.parse('2026-10-13T08:00:00Z'));
  assert.equal(result.instant, undefined);
  assert.equal(result.text, 'PST 10/12(월) 하루 종료까지\n한국 10/13(화) 오후 5:00 전 · 기한');
  assert.match(result.detail, /게시/);
  assert.match(result.detail, /실행 시각/);
  assert.match(result.detail, /UTC−8/);
  assert.equal(r.RadarNews.schedule(post('Day 8/ Reset')).deadlineAt, undefined);
});

test('literal PST and regional PT deadlines retain different daylight-saving offsets', () => {
  assert.equal(r.RadarNews.schedule(post('Reset by EOD PT')).deadlineAt, Date.parse('2026-10-13T07:00:00Z'));
  assert.equal(r.RadarNews.schedule(post('Reset by EOD PDT')).deadlineAt, Date.parse('2026-10-13T07:00:00Z'));
  assert.equal(r.RadarNews.schedule(post('Reset by end of day PT', '2026-11-01T12:00:00Z')).deadlineAt,
    Date.parse('2026-11-02T08:00:00Z'));
});

test('relative EOD dates use publication; explicit dates work without a publication timestamp', () => {
  assert.equal(r.RadarNews.schedule(post('Reset by EOD tomorrow PST')).deadlineAt, Date.parse('2026-10-14T08:00:00Z'));
  assert.equal(r.RadarNews.schedule(post('Reset by EOD 2026-12-31 UTC', null)).deadlineAt, Date.parse('2027-01-01T00:00:00Z'));
  for (const [text, createdAt, extra] of [
    ['Reset by EOD PST', null], ['Reset by EOD 2026-02-29 PST', undefined],
    ['Reset by EOD', undefined, { author: 'OpenAI', source: { id: 'openai' } }]
  ]) {
    const result = r.RadarNews.schedule(post(text, createdAt, extra));
    assert.equal(result.deadlineAt, undefined);
    assert.equal(result.instant, undefined);
    assert.match(result.text, /기한.*미정/);
  }
});

test('country changes only reformat the deadline; later viewing cannot move it', () => {
  const originalNow = r.Date;
  try {
    r.Date = class extends Date { static now() { return Date.parse('2026-12-30T00:00:00Z'); } };
    for (const country of r.RadarI18n.COUNTRIES) {
      r.RadarI18n.setLocale(country.locale);
      const result = r.RadarNews.schedule(post());
      assert.equal(result.deadlineAt, Date.parse('2026-10-13T08:00:00Z'));
      assert.ok(result.text.includes(country.timeLabel), result.text);
      assert.equal(result.instant, undefined);
      if (country.locale === 'en-US') assert.match(result.text, /Oct 13.*4:00 AM/);
    }
  } finally { r.Date = originalNow; r.RadarI18n.setLocale('ko-KR'); }
});

test('negations, business hours, competing dates/zones and unrelated EOD clauses do not invent deadlines', () => {
  for (const text of ["Reset won't land by EOD PST", 'No reset by EOD PST', 'Reset by EOD PST?',
    'Reset by EOD PST if we can', 'Maybe reset by EOD PST', 'Reset after EOD PST', 'Reset by EOD business hours PST',
    'Reset by EOD Tuesday or Wednesday PST', 'Reset by EOD 2026-10-13 or 2026-10-14 PST',
    'Reset by EOD PST or ET', 'Reset by EOD next week PST',
    'Reset soon. Submit feedback by EOD PST', 'Reset by EOD PST at 3pm', 'Reset by EOD 2026-10-13T15:00Z']) {
    const result = r.RadarNews.schedule(post(text));
    assert.equal(result.deadlineAt, undefined, text);
  }
});

test('the collected promise renders a deadline in the actual news list without changing classification', () => {
  const originalDate = r.Date;
  try {
    r.Date = class extends Date { static now() { return Date.parse('2026-10-13T02:00:00Z'); } };
    const item = { ...post(), id: '2109812360596865224', url: 'https://x.com/thsottiaux/status/2109812360596865224' };
    item.assessment = r.RadarSignals.classify(item);
    const before = JSON.stringify(item);
    const news = r.RadarNews.list({ activeSignals: [item] }, null, { monitorSignals: true, monitorLeadSource: true });
    assert.equal(news.length, 1);
    assert.match(news[0].timing, /10\/13.*오후 5:00 전 · 기한/);
    assert.equal(item.assessment.eventAt, null);
    assert.equal(item.assessment.untimedPromise, true);
    assert.equal(JSON.stringify(item), before);
  } finally { r.Date = originalDate; }
});
