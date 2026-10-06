const test = require('node:test');
const assert = require('node:assert/strict');
const { makeWorker } = require('./helpers/worker');
const { context: r } = makeWorker();
// The fixture must remain within the seven-day news window as calendar time advances.
r.Date = class extends Date { static now() { return Date.parse('2026-09-30T12:00:00Z'); } };
const post = text => ({ id: '951', author: 'thsottiaux', text, createdAt: '2026-09-28T12:00:00Z',
  url: 'https://x.com/thsottiaux/status/951', source: { id: 'codex-lead', weight: 1 } });

test('all eight country choices convert the same DevDay instant into the selected local date', () => {
  const event = r.RadarEvents.resolve(post('DevDay September 29, 2026.'));
  const original = JSON.stringify(event);
  const expected = {
    'ko-KR': ['Asia/Seoul', /9월 30일.*오전 2:00/, /9월 30일.*오전 11:00/],
    'en-US': ['America/New_York', /Sep 29.*1:00 PM/, /Sep 29.*10:00 PM/],
    'en-GB': ['Europe/London', /29 Sept.*6:00 pm/i, /30 Sept.*3:00 am/i],
    'ja-JP': ['Asia/Tokyo', /9月30日.*午前2:00/, /9月30日.*午前11:00/],
    'zh-CN': ['Asia/Shanghai', /9月30日.*上午1:00/, /9月30日.*上午10:00/],
    'fr-FR': ['Europe/Paris', /29 sept.*7:00 PM/, /30 sept.*4:00 AM/],
    'es-ES': ['Europe/Madrid', /29 sept.*7:00 p.*m/, /30 sept.*4:00 a.*m/],
    'it-IT': ['Europe/Rome', /29 set.*7:00 PM/, /30 set.*4:00 AM/]
  };
  for (const [locale, [zone, start, end]] of Object.entries(expected)) {
    r.RadarI18n.setLocale(locale);
    assert.equal(r.RadarTime.countryZone().zone, zone);
    const lines = r.RadarEvents.describe(event);
    assert.match(lines[0], start, locale);
    assert.match(lines[1], end, locale);
    assert.ok(lines[0].includes(r.RadarI18n.country().timeLabel));
    assert.match(lines[2], /^PT /);
    if (locale !== 'ko-KR') assert.doesNotMatch(lines.join(' '), /한국|Korea|KST/);
    assert.equal(JSON.stringify(event), original);
  }
});

test('reset announcements and completion posts use the selected country without changing the original instant', () => {
  const item = post('Tuesday at 6:30 PM PT');
  r.RadarI18n.setLocale('ko-KR');
  const korea = r.RadarNews.schedule(item);
  assert.match(korea.text, /한국 9\/30\(수\) 오전 10:30/);
  r.RadarI18n.setLocale('en-US');
  const us = r.RadarNews.schedule(item);
  assert.equal(us.instant, korea.instant);
  assert.match(us.text, /US Eastern \(ET\).*Sep 29.*9:30 PM/);
  const report = { ...post('All Codex usage limits have now reset.'), createdAt: '2026-09-29T01:00:00Z' };
  const news = r.RadarNews.list({ reports: [report] }, null, { monitorSignals: true, monitorLeadSource: true });
  assert.equal(news.length, 1);
  assert.match(news[0].timing, /US Eastern \(ET\).*Sep 28.*9:00 PM/);
  assert.doesNotMatch(news[0].timing, /KST|Korea|한국/);
});

test('US and UK use regional daylight saving rules instead of a fixed standard offset', () => {
  for (const [locale, winter, summer] of [['en-US', /7:00 AM/, /8:00 AM/], ['en-GB', /12:00 pm/i, /1:00 pm/i]]) {
    r.RadarI18n.setLocale(locale);
    assert.match(r.RadarNews.schedule(post('2026-01-06 at 12:00 UTC')).text.split('\n')[1], winter);
    assert.match(r.RadarNews.schedule(post('2026-07-07 at 12:00 UTC')).text.split('\n')[1], summer);
  }
});

test('year rollover and unknown times remain correct when switching countries', () => {
  r.RadarI18n.setLocale('ko-KR');
  assert.match(r.RadarNews.schedule(post('2026-12-31 at 11:30 PM UTC')).text, /한국 2027년 1\/1.*오전 8:30/);
  r.RadarI18n.setLocale('en-US');
  assert.match(r.RadarNews.schedule(post('2026-12-31 at 11:30 PM UTC')).text, /US Eastern \(ET\).*Dec 31.*6:30 PM/);
  const unresolved = r.RadarNews.schedule(post('Tuesday'));
  assert.equal(unresolved.instant, undefined);
  assert.match(unresolved.text, /US Eastern \(ET\) Time unconfirmed/);
  assert.doesNotMatch(unresolved.text, /12:00/);
});

test('country selection preserves source interpretation, event expiry and quiet-hour settings', () => {
  const item = post('3am on a tuesday');
  const settings = { monitorSignals: true, monitorLeadSource: true, timezoneMode: 'manual', timezoneOverride: 'Asia/Seoul',
    quietHoursEnabled: true, quietStart: '23:00', quietEnd: '08:00' };
  const end = Date.parse('2026-09-30T02:00:00Z');
  let instant;
  for (const country of r.RadarI18n.COUNTRIES) {
    r.RadarI18n.setLocale(country.locale);
    const schedule = r.RadarNews.schedule(item);
    instant ??= schedule.instant;
    assert.equal(schedule.instant, instant);
    assert.equal(schedule.assumedZone, true);
    assert.equal(r.RadarEvents.pinned(null, null, settings, { now: end - 1 }).length, 1);
    assert.equal(r.RadarEvents.pinned(null, null, settings, { now: end }).length, 0);
    assert.equal(r.RadarTime.isQuietHours(settings, Date.parse('2026-09-29T18:00:00Z')), true);
  }
});
