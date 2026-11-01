const test = require('node:test');
const assert = require('node:assert/strict');
global.RadarTime = require('../src/core/time');
const Semantic = require('../src/core/semantic');
const Queue = require('../src/core/semantic-queue');
const Signals = require('../src/core/signals');
const Direct = require('../src/core/direct-x');
const NOW = Date.parse('2026-10-22T14:00:00Z');
const row = (text = 'Everyone gets a fresh allowance tomorrow.', id = '95001') => ({ id, text, author: 'thsottiaux',
  url: `https://x.com/thsottiaux/status/${id}`, createdAt: '2026-10-22T06:55:54Z', source: { id: 'codex-lead', weight: 1 } });
const clone = value => JSON.parse(JSON.stringify(value));
function fake({ availability = 'available', category = 'forecast', output, fail = false } = {}) {
  const calls = { create: 0, destroy: 0, prompts: [] };
  const api = { availability: async () => availability, create: async options => {
    calls.create++;
    assert.equal(options.signal, undefined);
    return { prompt: async (prompt, config) => {
      calls.prompts.push(JSON.parse(prompt));
      assert.ok(config.responseConstraint);
      if (fail) throw new Error('GPU unavailable');
      if (config.responseConstraint.type === 'boolean') return 'true';
      return output ?? JSON.stringify({ category, evidence: ['cancelled','unrelated'].includes(category) ? '' : JSON.parse(prompt).text });
    }, destroy: () => calls.destroy++ };
  } };
  return { api, calls };
}
const semantic = (item, category = 'forecast', evidence = item.text) => ({ version: 1, key: Semantic.key(item), category, evidence });

test('semantic input has no keyword prefilter and never admits private or forged identities', () => {
  assert.ok(Semantic.input(row('A fresh allowance for all of you tomorrow!')));
  for (const extra of [{ source: { id: 'openai-status' } }, { author: 'someone' }, { truncated: true },
    { url: 'https://evil.test/thsottiaux/status/95001' }, { text: 'x'.repeat(6001) }, { createdAt: 'invalid' }]) {
    assert.equal(Semantic.input({ ...row(), ...extra }), null);
  }
  const external = Signals.normalizeItem({ id: '95001', content: row().text, published_at: row().createdAt,
    semantic: semantic(row()), metadata: { author_user_name: 'thsottiaux', semantic: semantic(row()) } });
  assert.equal(external.semantic, undefined, 'public feed cannot supply a trusted model decision');
});

test('only a verified same-author preceding conversation supplies the omitted subject', () => {
  const parent = { ...row('We have a fresh allowance coming.', '95000'), createdAt: '2026-10-22T06:55:22Z' };
  const target = row('Done');
  const linked = Direct.conversationContext(target, { targetId: target.id, rows: [parent, target] }, NOW);
  assert.equal(Semantic.input(linked).parent.id, parent.id, 'non-keyword parent is not discarded');
  for (const extra of [{ relation: 'adjacent-unverified' }, { author: 'someone' }, { targetId: parent.id },
    { url: 'https://evil.test/95000' }, { createdAt: target.createdAt }, { truncated: true }]) {
    assert.equal(Semantic.input({ ...target, replyContext: { ...linked.semanticContext, ...extra } }).parent, undefined);
  }
});

test('semantic result is exact-input-bound, evidence-grounded, fresh, and never actionable or a report', () => {
  const item = row();
  const decorated = { ...item, semantic: semantic(item) };
  assert.deepEqual([Semantic.hint(decorated, { now: NOW }).rule, Semantic.hint(decorated, { now: NOW }).actionable], ['semantic-reset', false]);
  assert.equal(Signals.classifyHint(decorated, { now: NOW }).rule, 'semantic-reset');
  assert.equal(Signals.reports([decorated], { now: NOW }).length, 0);
  for (const change of [{ text: item.text + ' Not happening.' }, { semantic: { ...decorated.semantic, evidence: 'invented quote' } },
    { semantic: { ...decorated.semantic, category: 'cancelled' } }, { semantic: { ...decorated.semantic, version: 0 } }])
    assert.equal(Semantic.hint({ ...decorated, ...change }, { now: NOW }), null);
  assert.equal(Semantic.hint(decorated, { now: NOW + 8 * 86400000 }), null);
  assert.equal(Semantic.hint({ ...decorated, semantic: { ...decorated.semantic,
    key: JSON.stringify({ policy: 'old-policy', input: Semantic.input(item) }) } }, { now: NOW }), null, 'an older interpretation policy cannot freeze future recall');
  const retained = Signals.hintCandidates([decorated], { now: NOW });
  assert.equal(retained[0].semantic.key, decorated.semantic.key, 'rechecking stored hints preserves model evidence');
});

test('model sessions are independent and always destroyed on success or invalid output', async () => {
  const { api, calls } = fake();
  await Semantic.judge(row(), { api }); await Semantic.judge(row('Done', '95002'), { api });
  assert.deepEqual([calls.create, calls.destroy, calls.prompts.length], [4, 4, 4]);
  assert.equal(calls.prompts[1].parent, undefined);
  const bad = fake({ output: '{bad JSON' });
  await assert.rejects(Semantic.judge(row(), { api: bad.api }), /invalid-output/);
  assert.equal(bad.calls.destroy, 2);
  const unsupported = fake({ availability: 'downloadable' });
  await assert.rejects(Semantic.judge(row(), { api: unsupported.api }), /model-downloadable/);
  assert.equal(unsupported.calls.create, 0, 'background inference cannot start downloads');
});

test('pending work survives unavailable models and worker restart; cached results avoid repeated inference', async () => {
  const item = row();
  const first = await Queue.run({ items: [{ ...item, semantic: semantic(item) }], now: NOW, api: fake({ availability: 'downloadable' }).api });
  assert.equal(first.status.pending, 1);
  assert.equal(first.items[0].semantic, undefined, 'external decision stripped');
  const ready = fake();
  const second = await Queue.run({ state: clone(first.state), now: NOW + 1000, api: ready.api });
  assert.deepEqual([second.status.pending, second.status.positive, ready.calls.create], [0, 1, 2]);
  const third = await Queue.run({ state: clone(second.state), items: [item], now: NOW + 2000, api: ready.api });
  assert.equal(ready.calls.create, 2);
  assert.equal(third.items[0].semantic.key, Semantic.key(item));
  const edited = { ...item, text: 'Actually no allowance tomorrow.' };
  const next = await Queue.run({ state: third.state, items: [edited], now: NOW + 3000, api: fake({ category: 'cancelled' }).api });
  assert.equal(next.items[0].semantic.category, 'cancelled');
  assert.equal(next.status.positive, 0);
});

test('model errors remain pending, back off, and successfully retry without caching a negative', async () => {
  const checkpoints = [];
  const failed = await Queue.run({ items: [row()], now: NOW, api: fake({ fail: true }).api, onCheckpoint: async state => checkpoints.push(clone(state)) });
  assert.equal(failed.status.pending, 1); assert.equal(failed.state.entries['95001'].result, null);
  assert.equal(checkpoints.length, 2, 'input and failure both checkpointed');
  const ready = fake();
  await Queue.run({ state: failed.state, now: NOW + 1000, api: ready.api });
  assert.equal(ready.calls.create, 0);
  const retried = await Queue.run({ state: failed.state, now: NOW + 61000, api: ready.api });
  assert.equal(retried.status.pending, 0); assert.equal(ready.calls.create, 2);
});

test('timeout is bounded and never marks unfinished work as unrelated', async () => {
  let destroyed = 0;
  const api = { availability: async () => 'available', create: async () => ({
    prompt: (text, { signal }) => new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })),
    destroy: () => destroyed++ }) };
  const result = await Queue.run({ items: [row()], now: NOW, api, budgetMs: 15 });
  assert.equal(result.status.pending, 1); assert.equal(result.status.classified, 0); assert.equal(destroyed, 1);
});

test('bounded passes checkpoint every result and do not starve old pending posts', async () => {
  const items = [row('Fresh allowance tomorrow.', '95001'), row('More room for everyone tomorrow.', '95002')];
  const a = await Queue.run({ items, now: NOW, maxItems: 1, api: fake().api });
  assert.equal(a.status.pending, 1);
  const b = await Queue.run({ state: clone(a.state), items, now: NOW + 61000, maxItems: 1, api: fake().api });
  assert.equal(b.status.pending, 0); assert.equal(b.status.classified, 2);
});

test('default pass clears a large backlog of fast rows in one run', async () => {
  const items = Array.from({ length: 112 }, (_, i) => row(`post ${i}`, String(97000 + i)));
  const ready = fake({ category: 'unrelated' });
  const out = await Queue.run({ items, now: NOW, api: ready.api });
  assert.deepEqual([out.status.processed, out.status.classified, out.status.pending], [112, 112, 0]);
  assert.equal(out.status.nextAttemptAt, null);
});

test('maxItems 0 enqueues and serves cache without any inference', async () => {
  const cached = row('Fresh allowance tomorrow.', '95001');
  const first = await Queue.run({ items: [cached], now: NOW, maxItems: 1, api: fake().api });
  const idle = fake();
  const out = await Queue.run({ state: clone(first.state), items: [cached, row('More room tomorrow.', '95002')], now: NOW + 1000, maxItems: 0, api: idle.api });
  assert.deepEqual([idle.calls.create, out.status.processed, out.status.pending, out.status.classified], [0, 0, 1, 1]);
  assert.ok(out.state.entries['95002']);
  assert.equal(out.items.find(i => i.id === '95001').semantic.key, Semantic.key(cached));
  assert.ok(out.status.nextAttemptAt >= NOW + 1000 && out.status.nextAttemptAt < NOW + 61000, 'unattempted row is due now');
});

test('explicit maxItems 1 processes exactly one row, newest unattempted before failed retries', async () => {
  const failed = await Queue.run({ items: [row('old', '95001')], now: NOW, api: fake({ fail: true }).api });
  const ready = fake({ category: 'unrelated' });
  const fresh = { ...row('new', '95002'), createdAt: '2026-10-22T07:00:00Z' };
  const out = await Queue.run({ state: clone(failed.state), items: [fresh], now: NOW + 61000, maxItems: 1, api: ready.api });
  assert.equal(out.status.processed, 1);
  assert.ok(out.state.entries['95002'].result);
  assert.equal(out.state.entries['95001'].attempts, 1);
});

test('nextAttemptAt reports the failed-entry cooldown', async () => {
  const failed = await Queue.run({ items: [row()], now: NOW, api: fake({ fail: true }).api });
  const tried = failed.state.entries['95001'].lastTriedAt;
  assert.ok(tried >= NOW && tried < NOW + 1000, 'attempt stamped with injected now plus elapsed');
  assert.equal(failed.status.nextAttemptAt, tried + 60000);
  const second = await Queue.run({ state: clone(failed.state), now: tried + 60000, api: fake({ fail: true }).api });
  assert.equal(second.status.nextAttemptAt, second.state.entries['95001'].lastTriedAt + 120000);
});

test('an unrelated relevance answer never creates a category session or an AI alert', async () => {
  let created = 0, destroyed = 0;
  const api = { availability: async () => 'available', create: async () => {
    created++; return { prompt: async () => 'false', destroy: () => destroyed++ };
  } };
  const item = row('Done');
  const result = await Semantic.judge(item, { api });
  assert.equal(result.category, 'unrelated');
  assert.deepEqual([created, destroyed], [1, 1]);
  assert.equal(Semantic.hint({ ...item, semantic: result }, { now: NOW }), null);
});

test('a body or conversation change forces a new interpretation and cannot reuse old positive evidence', async () => {
  const item = row('Done');
  const parent = { ...row('Day 13/ Le limit reset', '95000'), createdAt: '2026-10-22T06:55:22Z', relation: 'conversation-before', targetId: item.id };
  const linked = { ...item, replyContext: parent };
  const first = await Queue.run({ items: [linked], now: NOW, api: fake({ category: 'completed' }).api });
  const changed = { ...linked, replyContext: { ...parent, text: 'I will email my accountant the documents.' } };
  const unavailable = await Queue.run({ state: first.state, items: [changed], now: NOW + 1000, api: fake({ availability: 'unavailable' }).api });
  assert.equal(unavailable.items[0].semantic, undefined);
  assert.equal(unavailable.status.pending, 1);
});

test('large public posts cannot exhaust shared extension storage without an explicit overflow status', async () => {
  const items = Array.from({ length: 400 }, (_, index) => row('x'.repeat(5900), String(96000 + index)));
  const out = await Queue.run({ items, now: NOW, api: fake({ availability: 'unsupported' }).api });
  assert.ok(out.status.overflow > 0);
  assert.ok(Buffer.byteLength(JSON.stringify(out.state), 'utf8') < 2 * 1024 * 1024);
  assert.equal(out.status.classified, 0);
});

test('native error name, detail and failing stage survive cooldown and numeric DOM codes', async () => {
  const api = { availability: async () => 'available', create: async () => {
    const e = new Error('No responsible document for this operation'); e.name = 'NotAllowedError'; e.code = 0; throw e;
  } };
  const first = await Queue.run({ items: [row()], now: NOW, api });
  assert.equal(first.status.lastError, 'NotAllowedError');
  assert.equal(first.status.errorPhase, 'scope-create');
  assert.match(first.status.errorDetail, /responsible document/);
  const waiting = await Queue.run({ state: clone(first.state), now: NOW + 1000, api: fake().api });
  assert.equal(waiting.status.processed, 0);
  assert.equal(waiting.status.lastError, 'NotAllowedError', 'cooldown is not a successful retry');
});

test('shared batch budget does not consume the next post entire per-item timeout', async () => {
  const api = { availability: async () => 'available', create: async () => ({
    prompt: async (input, config) => {
      await new Promise(resolve => setTimeout(resolve, 14));
      return config.responseConstraint.type === 'boolean' ? 'false' : '{}';
    }, destroy() {} }) };
  const result = await Queue.run({ items: [row('a','95001'), row('b','95002')], now: NOW, api, budgetMs: 1000, itemTimeoutMs: 200 });
  assert.equal(result.status.classified, 2);
  assert.equal(result.status.lastError, null);
});

test('user cancellation restores attempts and cooldown instead of charging a failed inference', async () => {
  const controller = new AbortController();
  const api = { availability: async () => 'available', create: async () => ({
    prompt: async (input, { signal }) => new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => reject(new Error('aborted')), { once:true });
      controller.abort();
    }), destroy() {} }) };
  const out = await Queue.run({ items:[row()], now:NOW, api, signal:controller.signal });
  assert.equal(out.state.entries['95001'].attempts, 0);
  assert.equal(out.state.entries['95001'].lastTriedAt, 0);
  assert.equal(out.status.lastError, null);
});

test('repeated failures back off without permanent exclusion and never block untouched posts', async () => {
  const first = await Queue.run({ items:[row()], now:NOW, api:fake({fail:true}).api });
  const second = await Queue.run({ state:clone(first.state), now:NOW+61000, api:fake({fail:true}).api });
  const ready = fake();
  const third = await Queue.run({ state:clone(second.state), items:[row('Fresh quota tomorrow.','95002')], now:NOW+122000, api:ready.api });
  assert.equal(third.state.entries['95001'].attempts, 2, 'second failure needs a longer cooldown');
  assert.equal(third.state.entries['95002'].result.category, 'forecast');
  const recovered = await Queue.run({ state:clone(third.state), now:NOW+182000, api:ready.api });
  assert.equal(recovered.status.pending, 0);
  assert.equal(recovered.status.lastError, null);
});
