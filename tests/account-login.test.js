const test = require("node:test");
const assert = require("node:assert/strict");
const Account = require("../src/core/account.js");
const { makeWorker, FAKE_TOKEN, RAW_USAGE, json } = require("./helpers/worker");

function accountWorker({ usageStatus = 200, creditsStatus = 200, ...options } = {}) {
  const source = { usageStatus, creditsStatus };
  const w = makeWorker({ ...options, fetcher(url) {
    if (url.endsWith("/auth/session")) return json({ accessToken: FAKE_TOKEN });
    if (url.endsWith("/usage")) return json(RAW_USAGE, source.usageStatus);
    if (url.endsWith("/rate-limit-reset-credits")) return json({ available_count: 0, credits: [] }, source.creditsStatus);
    if (url.includes("codex-resets.com")) return new Response("", { headers: { "content-type": "text/html" } });
    return json({ items: [] });
  } });
  return { ...w, source, check: page => w.send({ type: "REFRESH_ACCOUNT" }, w.sender(page || "popup")) };
}

test("login buttons on all trusted pages open only the official homepage without enabling account access", async () => {
  for (const page of ["popup", "options", "welcome"]) {
    const w = accountWorker({ stored: { settings: { monitorAccount: false, theme: "dark", pollMinutes: 60 } } });
    const result = await w.send({ type: "OPEN_ACCOUNT_LOGIN" }, w.sender(page));
    assert.equal(result.ok, true);
    assert.equal(w.tabs.length, 1);
    assert.equal(w.tabs[0].url, "https://chatgpt.com/");
    assert.equal(w.local.settings.monitorAccount, false);
    assert.equal(w.local.settings.theme, "dark");
    assert.equal(w.local.settings.pollMinutes, 60);
    assert.equal(w.requests.length, 0);
  }
});

test("login and account-check messages reject foreign origins, frames and arbitrary URLs", async () => {
  const w = accountWorker();
  for (const type of ["OPEN_ACCOUNT_LOGIN", "REFRESH_ACCOUNT"]) {
    for (const sender of [
      { ...w.sender("popup"), url: "https://chatgpt.com/" },
      { ...w.sender("options"), id: "another-extension" },
      { ...w.sender("welcome"), frameId: 1 },
      { ...w.sender("popup"), documentLifecycle: "prerender" }
    ]) assert.equal((await w.send({ type }, sender)).ok, false);
    assert.equal((await w.send({ type, url: "https://attacker.invalid/" }, w.sender("popup"))).ok, false);
  }
  assert.equal(w.tabs.length, 0);
  assert.equal(w.requests.length, 0);
});

test("checking a disabled account does not enable monitoring or fetch private endpoints", async () => {
  const w = accountWorker({ stored: { settings: { monitorAccount: false } } });
  for (const page of ["popup", "options", "welcome"]) {
    assert.equal((await w.check(page)).skipped, true);
  }
  assert.equal(w.requests.length, 0);
  assert.equal(w.local.settings.monitorAccount, false);
});

test("quota 401 requires login and clears stale account data even when credits succeed", async () => {
  const w = accountWorker(); await w.check();
  assert.ok(w.local.recoveryState);
  w.source.usageStatus = 401;
  const result = await w.check("options");
  assert.equal(result.ok, false);
  assert.equal(result.reason, "signedOut");
  assert.equal(w.local.accountState.status, "signedOut");
  assert.equal(w.local.accountSnapshot, undefined);
  assert.equal(w.local.recoveryState, undefined);
  assert.equal(w.local.settings.monitorAccount, true);
});

test("quota 403 is an access problem, not logout, with full or partial endpoint failures", async () => {
  for (const creditsStatus of [200, 403]) {
    const w = accountWorker({ usageStatus: 403, creditsStatus });
    const result = await w.check();
    assert.equal(result.ok, false);
    assert.equal(result.reason, "accessDenied");
    assert.equal(w.local.accountState.status, "error");
    assert.equal(w.local.accountState.reason, "accessDenied");
    assert.equal(w.local.settings.monitorAccount, true);
  }
});

test("credits-only authorization failure does not hide working quota or imply logout", async () => {
  for (const creditsStatus of [401, 403]) {
    const w = accountWorker({ creditsStatus });
    assert.equal((await w.check()).ok, true);
    assert.equal(w.local.accountState.status, "connected");
    assert.ok(w.local.accountSnapshot.usage);
    assert.equal(w.local.accountSnapshot.credits, null);
  }
});

test("a quiet polling failure exposes a reconnect action even when older quota is cached", async () => {
  const w = accountWorker(); await w.check();
  w.source.usageStatus = w.source.creditsStatus = 500;
  await w.context.refreshAccount({ quiet: true });
  const view = Account.view(w.local);
  assert.equal(view.hasUsage, true);
  assert.equal(view.needsCheck, true);
  assert.match(view.message, /마지막 조회값/);
  assert.equal(view.action, "ChatGPT 열기");
});

test("rechecking after login restores quota without waiting for the polling alarm or changing settings", async () => {
  const w = accountWorker({ usageStatus: 401 });
  await w.check();
  const before = structuredClone(w.local.settings);
  w.source.usageStatus = 200;
  const result = await w.check("options");
  assert.equal(result.ok, true);
  assert.equal(w.local.accountState.status, "connected");
  assert.equal(w.local.accountError, null);
  assert.equal(w.local.accountSnapshot.usage.windows[0].remainingPercent, 60);
  assert.deepEqual(w.local.settings, before);
  assert.equal(w.requests.some(request => !request.url.startsWith("https://chatgpt.com/")), false);
  assert.equal(Account.view(w.local).needsCheck, false);
});

test("public-feed success cannot mask a failed account login or quota read in the UI", () => {
  for (const reason of ["signedOut", "accessDenied", "unavailable"]) {
    const text = Account.refreshMessage({ ok: true, account: { ok: false, reason }, signals: { ok: true } });
    assert.doesNotMatch(text, /확인했습니다/);
    assert.match(text, /로그인|접근|조회하지 못/);
  }
  assert.match(Account.refreshMessage({ ok: true, skipped: true }), /조회.*켜/);
  assert.match(Account.refreshMessage({ ok: true }), /잔여량을 확인했습니다/);
});

test("account UI distinguishes opt-in, expired login, unavailable quota and a healthy connection", () => {
  assert.equal(Account.view({ settings: { monitorAccount: false } }).action, "계정 연결");
  const signedOut = Account.view({ settings: { monitorAccount: true }, accountState: { status: "signedOut" } });
  assert.equal(signedOut.action, "ChatGPT 로그인");
  assert.equal(signedOut.needsCheck, true);
  assert.match(signedOut.message, /같은 Chrome 프로필/);
  assert.equal(Account.view({ settings: { monitorAccount: true } }).needsCheck, true);
  const healthy = Account.view({ settings: { monitorAccount: true }, accountState: { status: "connected" }, accountSnapshot: { usage: {} } });
  assert.equal(healthy.needsCheck, false);
  assert.equal(healthy.action, "ChatGPT 열기");
});

test("an OFF action still cancels a pending reconnect request", async () => {
  let ready, release;
  const started = new Promise(resolve => { ready = resolve; });
  const released = new Promise(resolve => { release = resolve; });
  const w = makeWorker({ fetcher: async url => {
    if (url.endsWith("/auth/session")) { ready(); await released; return json({ accessToken: FAKE_TOKEN }); }
    return json(RAW_USAGE);
  } });
  const checking = w.send({ type: "REFRESH_ACCOUNT" }, w.sender("options"));
  await started;
  await w.send({ type: "SAVE_SETTINGS", settings: { monitorAccount: false } }, w.sender("options"));
  release(); await checking;
  assert.equal(w.local.accountSnapshot, undefined);
  assert.equal(w.local.recoveryState, undefined);
  assert.equal(w.local.settings.monitorAccount, false);
});
