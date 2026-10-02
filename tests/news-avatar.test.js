const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const sharp = require('sharp');
const Signals = require('../src/core/signals');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'src/shared/news-avatar.js'), 'utf8');
const remote = 'https://pbs.twimg.com/profile_images/123/current_normal.jpg';
const post = (author, avatarUrl) => ({ author, avatarUrl, source: { id: 'codex-lead' } });

function page() {
  const images = [];
  class Element {
    constructor(tag) { this.tag = tag; this.children = []; this.events = {}; }
    setAttribute() {}
    append(child) { this.children.push(child); child.parent = this; }
    replaceChildren(...children) { this.children = []; children.forEach(child => this.append(child)); }
    addEventListener(type, handler) { this.events[type] = handler; }
    remove() { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); }
  }
  const document = {
    createElement(tag) { const element = new Element(tag); if (tag === 'img') images.push(element); return element; },
    createTextNode(text) { return { text }; }
  };
  const context = vm.createContext({ document, RadarSignals: Signals });
  vm.runInContext(source, context);
  return { create: context.RadarNewsAvatar.create, images };
}

test('cached news without collected photo URLs displays the matching bundled author photo', async () => {
  for (const [author, name] of [['thsottiaux', 'tibo'], ['@reach_vb', 'vb'], ['OpenAI', 'openai']]) {
    const ui = page(); const avatar = ui.create(post(author));
    assert.equal(ui.images.length, 1);
    assert.equal(ui.images[0].src, `../../assets/profiles/${name}.jpg`);
    assert.ok(avatar.children.includes(ui.images[0]));
    const meta = await sharp(path.join(root, `assets/profiles/${name}.jpg`)).metadata();
    assert.equal(meta.format, 'jpeg'); assert.ok(meta.width >= 24 && meta.height >= 24);
    assert.equal(ui.images[0].width, 24); assert.equal(ui.images[0].height, 24);
  }
  const html = fs.readFileSync(path.join(root, 'src/popup/popup.html'), 'utf8');
  assert.ok(html.indexOf('src="../shared/news-avatar.js"') < html.indexOf('src="popup.js"'));
  assert.ok(html.includes('src="../shared/news-avatar.js"'));
});

test('a pending or failed remote image keeps the bundled photo visible', () => {
  const ui = page(); const avatar = ui.create(post('reach_vb', remote));
  const [base, latest] = ui.images;
  assert.ok(avatar.children.includes(base)); assert.ok(!avatar.children.includes(latest));
  assert.equal(latest.crossOrigin, 'anonymous'); assert.equal(latest.referrerPolicy, 'no-referrer');
  latest.events.error();
  assert.ok(avatar.children.includes(base)); assert.equal(base.src, '../../assets/profiles/vb.jpg');
});

test('a successfully loaded current photo replaces the bundled photo', () => {
  const ui = page(); const avatar = ui.create(post('thsottiaux', remote));
  const [base, latest] = ui.images; latest.events.load();
  assert.deepEqual(avatar.children, [latest]); assert.ok(!avatar.children.includes(base));
});

test('the same author can reuse a collected photo but never an unrelated author or unsafe URL', () => {
  const ui = page();
  ui.create(post('reach_vb', 'https://evil.test/photo.jpg'), [{ item: post('thsottiaux', remote) }]);
  assert.equal(ui.images.length, 1);
  const matching = page();
  matching.create(post('reach_vb'), [{ item: post('@reach_vb', remote) }]);
  assert.equal(matching.images[1].src, remote);
});

test('unknown or untrusted authors are not given a monitored author photo', () => {
  for (const item of [post('other', remote), { ...post('thsottiaux', remote), source: { id: 'untrusted' } }]) {
    const ui = page(); ui.create(item); assert.equal(ui.images.length, 0);
  }
});

test('an unreadable bundled image leaves a readable fallback', () => {
  const ui = page(); const avatar = ui.create(post('reach_vb'));
  ui.images[0].events.error(); assert.equal(avatar.children.length, 1);
  assert.equal(avatar.children[0].text, 'VB');
});
