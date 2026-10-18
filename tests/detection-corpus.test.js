const test = require('node:test');
const assert = require('node:assert/strict');
const corpus = require('./fixtures/detection-corpus.json');
global.RadarTime = require('../src/core/time');
const Signals = require('../src/core/signals');
const Direct = require('../src/core/direct-x');

test('release corpus retains the observed examples and independent negative controls', () => {
  assert.equal(corpus.schema, 1);
  const observed = corpus.cases.filter(example => !corpus.groups[example.group].provenance.startsWith('Synthetic'));
  const controls = corpus.cases.filter(example => corpus.groups[example.group].provenance.startsWith('Synthetic'));
  assert.ok(observed.length >= 8);
  assert.ok(observed.filter(example => example.expected !== 'none').length >= 7);
  assert.ok(controls.length >= 10);
  for (const example of corpus.cases) {
    assert.ok(['signal', 'hint', 'report', 'none'].includes(example.expected));
    assert.ok(corpus.groups[example.group].posts.some(row => row.id === example.targetId));
  }
});

for (const example of corpus.cases) test('release detection gate: ' + example.name, () => {
  const group = corpus.groups[example.group];
  const now = Date.parse(group.observedAt);
  let item = Direct.linkQuotedContexts(Direct.normalize(group.posts, now)).find(item => item.id === example.targetId);
  assert.ok(item, 'The observed target must survive collection normalization');
  if (example.parentId) item = Direct.conversationContext(item, { targetId: item.id,
    rows: [group.posts.find(row => row.id === example.parentId), group.posts.find(row => row.id === item.id)] }, now);
  const assessment = Signals.classify(item, { now });
  const hint = Signals.classifyHint(item, { now });
  const reports = Signals.reports([item], { now });
  const category = assessment.actionable ? 'signal' : reports.length ? 'report' : hint.candidate ? 'hint' : 'none';
  assert.equal(category, example.expected);
  if (example.confidence) assert.equal(assessment.confidence, example.confidence, 'Default alert threshold must still admit this promise');
});
