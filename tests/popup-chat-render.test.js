const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../src/popup/popup.js'), 'utf8');
const code = source.slice(source.indexOf('function renderChat('), source.indexOf('function renderChatMeters('));
for (const item of [
  { connected: false, family: 'unknown', plan: null },
  { connected: true, family: 'plus', plan: 'plus' },
  { connected: true, family: 'pro', plan: null },
  { connected: true, family: 'pro', plan: 'pro100' },
  { connected: true, family: 'business', plan: null }
]) test(`chat card renders ${item.family}/${item.plan || 'unconfirmed'} without runtime errors`, () => {
  const elements = new Map();
  const view = { ...item, meters: [], count: { astra: 0, sol: 0, limit: null }, modelCounts: { solStandard: 0, luna: 0 }, label: item.family };
  const context = { RadarChatCounter: { view: () => view }, RadarTime: {}, renderChatMeters: () => {}, msg: () => 'unknown quota',
    $: id => { if (!elements.has(id)) elements.set(id, { dataset: {} }); return elements.get(id); } };
  vm.runInNewContext(code, context);
  assert.doesNotThrow(() => context.renderChat({}, { monitorChat: true, syncChatHistory: true }));
  assert.ok(elements.has('chatCountStatus'));
  if (item.connected && !item.plan && ['pro', 'business'].includes(item.family)) assert.match(elements.get('chatCountBreakdown').textContent, /한도 기준 선택 필요/);
});
