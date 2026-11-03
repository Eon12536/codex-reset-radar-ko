const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function setup() {
  class Element {
    constructor() { this.listeners = {}; this.children = []; this.value = ''; this.open = false; }
    addEventListener(type, fn) { this.listeners[type] = fn; }
    replaceChildren() { this.children = []; }
    append(child) { this.children.push(child); }
    contains(target) { return target === this || target.inside === true; }
    focus() { this.focused = true; }
    fire(type, event = {}) { this.listeners[type]?.({ target: this, ...event }); }
  }
  const ids = ['newsPeriod', 'newsPeriodButton', 'newsYear', 'newsMonth', 'newsPeriodApply', 'newsPeriodClose', 'newsMonthReset'];
  const controls = Object.fromEntries(ids.map(id => [id, new Element()]));
  const document = new Element(); document.createElement = () => new Element();
  const context = vm.createContext({ document, $: id => controls[id], RadarDailyNews: { dayKey: () => '2026-11-02' }, render: () => {} });
  const source = fs.readFileSync(require.resolve('../src/popup/popup.js'), 'utf8');
  vm.runInContext("let selectedNewsMonth = '';\n" + source.slice(source.indexOf('function prepareNewsPeriod()'), source.indexOf('async function acknowledgeDisplayedBadges()')), context);
  return { controls, document, selected: () => vm.runInContext('selectedNewsMonth', context) };
}

test('period panel applies a month and can be closed and reopened', () => {
  const { controls: c, selected } = setup();
  c.newsPeriod.open = true; c.newsPeriod.fire('toggle');
  assert.equal(c.newsYear.value, '2026'); assert.equal(c.newsMonth.value, '11');
  c.newsMonth.value = '10'; c.newsPeriodApply.fire('click');
  assert.equal(selected(), '2026-10'); assert.equal(c.newsPeriod.open, false);
  c.newsPeriod.open = true; c.newsPeriod.fire('toggle');
  assert.equal(c.newsMonth.value, '10');
  c.newsPeriodClose.fire('click'); assert.equal(c.newsPeriod.open, false); assert.equal(c.newsPeriodButton.focused, true);
  c.newsMonthReset.fire('click'); assert.equal(selected(), '');
});

test('escape and clicking outside close the period panel without applying changes', () => {
  const { controls: c, document, selected } = setup();
  c.newsPeriod.open = true; c.newsPeriod.fire('toggle');
  document.fire('keydown', { key: 'Escape', preventDefault() {} });
  assert.equal(c.newsPeriod.open, false); assert.equal(selected(), '');
  c.newsPeriod.open = true; document.fire('click', { target: {} });
  assert.equal(c.newsPeriod.open, false); assert.equal(selected(), '');
});
