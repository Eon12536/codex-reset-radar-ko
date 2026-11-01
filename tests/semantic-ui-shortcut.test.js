const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../src/shared/semantic-ui'), 'utf8');
async function view(status, enabled = true) {
  const output = {}, shortcut = { hidden: false, addEventListener() {} };
  let modelCalls = 0;
  const context = vm.createContext({ document: { getElementById: id => ({ semanticStatus: output, openSemanticSettings: shortcut })[id] },
    chrome: { storage: { local: { get: async () => ({ semanticStatus: status, settings: { semanticEnabled: enabled } }) }, onChanged: { addListener() {} } } },
    LanguageModel: { create() { modelCalls++; throw Error('no automatic model preparation'); } } });
  vm.runInContext(source, context);
  await new Promise(resolve => setImmediate(resolve));
  return { output, shortcut, modelCalls };
}
test('ready AI needs no popup settings button, even while the automatic queue is draining', async () => {
  for (const pending of [0, 53]) {
    const result = await view({ state: 'available', classified: 106, pending });
    assert.equal(result.shortcut.hidden, true);
    assert.match(result.output.textContent, /준비됨/);
    assert.equal(result.modelCalls, 0);
  }
});
test('first preparation or an actionable error retains an appropriately labelled settings shortcut', async () => {
  const prepare = await view({ state: 'downloadable', pending: 5 });
  assert.equal(prepare.shortcut.hidden, false);
  assert.equal(prepare.shortcut.textContent, 'AI 모델 준비');
  const error = await view({ state: 'available', lastError: 'GPU unavailable' });
  assert.equal(error.shortcut.hidden, false);
  assert.equal(error.shortcut.textContent, 'AI 상태 확인');
});
test('off or unsupported AI does not suggest that the ready button is required for reset collection', async () => {
  for (const [status, enabled] of [[{ state: 'available' }, false], [{ state: 'unsupported' }, true], [{ state: 'unavailable' }, true]]) {
    const result = await view(status, enabled);
    assert.equal(result.shortcut.hidden, true);
    assert.equal(result.modelCalls, 0);
  }
});
