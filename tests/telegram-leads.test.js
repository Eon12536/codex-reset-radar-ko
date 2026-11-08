const test = require('node:test');
const assert = require('node:assert/strict');
const { makeWorker, json } = require('./helpers/worker');

const NOW = Date.parse('2026-10-27T00:00:00Z');
const id = '2114599388454481930';

test('Telegram parsing extracts only recent canonical X IDs, never channel text or unrelated links', () => {
  const w = makeWorker();
  const parse = w.context.RadarTelegramLeads.parse;
  const html = `<a href="https://x.com/i/status/${id}?s=20">Done</a>
    <a href="https://x.com/thsottiaux/status/${id}">duplicate</a>
    <a href="https://x.com/codex_resets/status/${id}">repost is still only a candidate</a>
    <a href="https://x.com.evil.test/i/status/${id}">evil</a>
    <a href="https://x.com/other/status/${id}">other author</a>
    <a href="https://x.com/i/status/1">old</a>`;
  assert.deepEqual(Array.from(parse(html, NOW)), [id]);
  assert.deepEqual(Array.from(parse(`<a href="https://x.com/codex_resets/status/${id}">wrapper</a>`, NOW)), [id]);
  assert.deepEqual(Array.from(parse(`<a href="https://x.com/codex_resets/status/${id}">wrapper</a>`, NOW, { directOnly: true })), []);
  assert.deepEqual(Array.from(parse('x'.repeat(2 * 1024 * 1024 + 1), NOW)), []);
});

test('full history and Telegram queues both survive merging, interleave, and deduplicate', () => {
  const combine = makeWorker().context.RadarTelegramLeads.combine;
  const historical = Array.from({ length: 40 }, (_, i) => String(2110000000000000000n + BigInt(i)));
  const channel = Array.from({ length: 40 }, (_, i) => String(2116000000000000000n + BigInt(i)));
  const result = combine(channel, historical);
  assert.equal(result.ids.length, 80); assert.equal(result.telegramIds.length, 40);
  assert.equal(result.ids[0], historical[39]); assert.equal(result.ids[1], channel[39]);
  assert.ok(channel.every(id => result.ids.includes(id)));
  const duplicate = combine([channel[0], historical[0], 'bad'], [historical[0]]);
  assert.equal(duplicate.ids.length, 2); assert.equal(duplicate.telegramIds.length, 2);
});

test('forty saved history leads cannot erase a fresh Telegram candidate in the real refresh path', async () => {
  const historic = Array.from({ length: 40 }, (_, i) => String(2110000000000000000n + BigInt(i)));
  const w = makeWorker({ stored: { manualHistoryLeads: historic, settings: { monitorSignals: true, monitorLeadSource: true,
    monitorDirectX: true, monitorAccount: false, semanticEnabled: false, monitorStatusSource: false,
    monitorHistorySource: false, monitorCommunitySource: false } }, fetcher: async url =>
      url === 'https://t.me/s/codex_resets' ? new Response(`<a href="https://x.com/i/status/${id}">x</a>`,
        { headers: { 'content-type': 'text/html' } }) : json({ items: [] }) });
  w.context.Date = class extends Date { static now() { return NOW; } };
  w.context.chrome.permissions.contains = async () => true;
  let received;
  w.context.RadarDirectX = { ...w.context.RadarDirectX, read: async (_signal, options) => {
    received = await options.telegramLeads;
    return { items: [], diagnostics: { timelines: [] } };
  } };
  await w.context.refreshSignals();
  assert.equal(received.ids.length, 41); assert.ok(received.ids.includes(id));
  assert.deepEqual(Array.from(received.telegramIds), [id]);
  assert.equal(w.local.manualHistoryLeads.length, 40);
});

test('Telegram access requires optional permission and never includes credentials', async () => {
  const w = makeWorker({ fetcher: async () => new Response(`<a href="https://x.com/i/status/${id}">x</a>`, { headers: { 'content-type': 'text/html' } }) });
  w.context.Date = class extends Date { static now() { return NOW; } };
  assert.equal((await w.context.RadarTelegramLeads.load()).state, 'permission');
  assert.equal(w.requests.length, 0);
  w.context.chrome.permissions.contains = async p => p.origins?.includes('https://t.me/*');
  const result = await w.context.RadarTelegramLeads.load();
  assert.deepEqual(Array.from(result.ids), [id]);
  assert.equal(w.requests[0].url, 'https://t.me/s/codex_resets');
  assert.equal(w.requests[0].options.credentials, 'omit');
  assert.equal(w.requests[0].options.redirect, 'error');
  assert.equal(w.requests[0].options.referrerPolicy, 'no-referrer');
});

test('unavailable Telegram does not prevent the primary X scan', async () => {
  const w = makeWorker({ stored: { settings: { monitorAccount: false, semanticEnabled: false, monitorStatusSource: false,
    monitorHistorySource: false, monitorCommunitySource: false } }, fetcher: async url => {
      if (url.startsWith('https://t.me/')) throw new Error('offline');
      return json({ items: [] });
    } });
  w.context.chrome.permissions.contains = async () => true;
  let ran = false;
  w.context.RadarDirectX = { ...w.context.RadarDirectX, read: async (_signal, options) => {
    ran = true; assert.equal((await options.telegramLeads).state, 'unavailable');
    return { items: [], diagnostics: { timelines: [] } };
  } };
  await w.context.refreshSignals();
  assert.equal(ran, true);
});

test('a Telegram lead verified by the X reader reaches classification and its normal alert', async () => {
  const w = makeWorker({ stored: { settings: { monitorAccount: false, semanticEnabled: false, monitorStatusSource: false,
    monitorHistorySource: false, monitorCommunitySource: false, quietHoursEnabled: false } }, fetcher: async url =>
      url === 'https://t.me/s/codex_resets' ? new Response(`<a href="https://x.com/i/status/${id}">incorrect completion</a>`,
        { headers: { 'content-type': 'text/html' } }) : json({ items: [] }) });
  w.context.Date = class extends Date { static now() { return NOW; } };
  w.context.chrome.permissions.contains = async () => true;
  w.context.RadarDirectX = { ...w.context.RadarDirectX, read: async (_signal, options) => {
    assert.deepEqual(Array.from((await options.telegramLeads).ids), [id]);
    await options.onTelegramAttempt(id);
    const item = { id, author: 'thsottiaux', text: 'Not enough resets', createdAt: '2026-10-26T06:05:56Z',
      url: `https://x.com/thsottiaux/status/${id}` };
    return { items: w.context.RadarDirectX.normalize([item], NOW), diagnostics: { posts: 1,
      timelines: ['posts', 'replies'].flatMap(kind => ['thsottiaux', 'reach_vb', 'openai'].map(author => ({ author, kind, ok: true, stopReason: 'seven-days' }))) } };
  } };
  await w.context.refreshSignals();
  assert.ok(w.local.hintSnapshot.items.some(item => item.id === id && item.assessment.rule === 'reset-scarcity'));
  assert.ok(w.notifications['hint:' + id]);
  assert.equal(w.local.telegramLeadAttempts[id], NOW);
});

test('an old X-verified Telegram lead becomes display-only history without a fresh notification', async () => {
  const historicId = '2110595484180214059';
  const w = makeWorker({ stored: { settings: { monitorAccount: false, semanticEnabled: false, monitorStatusSource: false,
    monitorHistorySource: false, monitorCommunitySource: false, quietHoursEnabled: false } }, fetcher: async url =>
      url === 'https://t.me/s/codex_resets' ? new Response(`<a href="https://x.com/i/status/${historicId}">x</a>`,
        { headers: { 'content-type': 'text/html' } }) : json({ items: [] }) });
  w.context.Date = class extends Date { static now() { return NOW; } };
  w.context.chrome.permissions.contains = async () => true;
  w.context.RadarDirectX = { ...w.context.RadarDirectX, read: async (_signal, options) => {
    assert.ok((await options.telegramLeads).ids.includes(historicId));
    const item = { id: historicId, author: 'thsottiaux', text: 'Day 10/ Reset', createdAt: '2026-10-15T04:55:51Z',
      url: `https://x.com/thsottiaux/status/${historicId}`, source: { id: 'codex-lead', kind: 'x-page' } };
    assert.equal(await options.onTelegramHistory(item), true);
    return { items: [], diagnostics: { posts: 0, timelines: [] } };
  } };
  await w.context.refreshSignals();
  assert.ok(w.local.resetHistory.items.some(item => item.id === historicId));
  assert.ok(w.context.RadarDailyNews.displayEntries(w.local, w.local.settings).some(row => row.item.id === historicId && row.historical));
  assert.equal(Object.keys(w.notifications).filter(key => key.includes(historicId)).length, 0);
});

test('manual history restore uses only direct Tibo links and leaves source settings and old records intact', async () => {
  const historicId = '2110595484180214059', wrapper = '2114599388454481930';
  const w = makeWorker({ stored: { settings: { monitorSignals: true, monitorLeadSource: true, monitorDirectX: true,
    monitorAccount: false, semanticEnabled: false, monitorStatusSource: false, monitorHistorySource: false,
    monitorCommunitySource: false, quietHoursEnabled: false }, resetHistory: { version: 1, items: [{ id: '123' }] } },
    fetcher: async url => url === 'https://codex-resets.com/' ? new Response(
      `<a href="https://x.com/thsottiaux/status/${historicId}">original</a><a href="https://x.com/i/status/${wrapper}">wrapper</a>`,
      { headers: { 'content-type': 'text/html' } }) : json({ items: [] }) });
  w.context.Date = class extends Date { static now() { return NOW; } };
  w.context.chrome.permissions.contains = async p => Boolean(p.permissions?.includes('scripting'));
  w.context.RadarDirectX = { ...w.context.RadarDirectX, read: async (_signal, options) => {
    assert.deepEqual(Array.from((await options.telegramLeads).ids), [historicId]);
    await options.onTelegramHistory({ id: historicId, author: 'thsottiaux', text: 'Day 10/ Reset',
      createdAt: '2026-10-15T04:55:51Z', url: `https://x.com/thsottiaux/status/${historicId}`,
      source: { id: 'codex-lead', kind: 'x-page' } });
    return { items: [], diagnostics: { posts: 0, timelines: [] } };
  } };
  const unauthorized = await w.send({ type: 'RESTORE_RESET_HISTORY' }, w.sender('popup'));
  assert.equal(unauthorized.ok, false);
  const result = await w.send({ type: 'RESTORE_RESET_HISTORY' }, w.sender('options'));
  assert.equal(result.ok, true);
  assert.equal(result.leads, 1);
  assert.equal(w.local.settings.monitorHistorySource, false);
  assert.ok(w.local.resetHistory.items.some(item => item.id === '123'));
  assert.ok(w.local.resetHistory.items.some(item => item.id === historicId));
  assert.equal(Object.keys(w.notifications).filter(key => key.includes(historicId)).length, 0);
});

test('queued historical recovery runs independently and preserves earlier records without alerts', async () => {
  const historicId = '2110595484180214059';
  const w = makeWorker({ stored: { settings: { monitorSignals: true, monitorLeadSource: true, monitorDirectX: true },
    manualHistoryLeads: [historicId], resetHistory: { version: 1, items: [{ id: '123' }] } } });
  w.context.Date = class extends Date { static now() { return NOW; } };
  let reads = 0;
  w.context.RadarDirectX = { ...w.context.RadarDirectX, read: async (_signal, options) => {
    reads++;
    assert.equal(options.historyOnly, true);
    assert.deepEqual(Array.from((await options.telegramLeads).ids), [historicId]);
    await options.onTelegramAttempt(historicId);
    assert.equal(await options.onTelegramHistory({ id: historicId, author: 'thsottiaux', text: 'Day 10/ Reset',
      createdAt: '2026-10-15T04:55:51Z', url: `https://x.com/thsottiaux/status/${historicId}`,
      source: { id: 'codex-lead', kind: 'x-page' } }), true);
    return { diagnostics: { telegram: { attempted: 1, recovered: 1 } } };
  } };
  const result = await w.context.recoverHistoricalCandidates();
  assert.equal(reads, 1);
  assert.equal(result.recovered, 1);
  assert.ok(w.local.resetHistory.items.some(item => item.id === '123'));
  assert.ok(w.local.resetHistory.items.some(item => item.id === historicId));
  assert.equal(Object.keys(w.notifications).length, 0);
  await w.context.recoverHistoricalCandidates();
  assert.equal(reads, 1);
});

test('historical recovery never turns disabled monitoring back on', async () => {
  const w = makeWorker({ stored: { settings: { monitorSignals: false }, manualHistoryLeads: ['2110595484180214059'] } });
  let reads = 0;
  w.context.RadarDirectX = { ...w.context.RadarDirectX, read: async () => { reads++; } };
  const result = await w.context.recoverHistoricalCandidates();
  assert.equal(result.paused, true);
  assert.equal(reads, 0);
  assert.equal(w.local.settings.monitorSignals, false);
  assert.equal(w.local.manualHistoryLeads.length, 1);
});
