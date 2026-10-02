const test = require("node:test");
const assert = require("node:assert/strict");
const { makeWorker, FAKE_TOKEN, RAW_USAGE, json } = require("./helpers/worker");

function usage(five = 40, weekly = 25) {
  const raw = structuredClone(RAW_USAGE);
  raw.plan_type = "plus";
  raw.rate_limit.primary_window.used_percent = five;
  raw.rate_limit.secondary_window.used_percent = weekly;
  return raw;
}
function harness(stored = {}) {
  const source = { token: FAKE_TOKEN, raw: usage(), usageStatus: 200, creditsStatus: 200 };
  const worker = makeWorker({
    stored: { ...stored, settings: { monitorAccount: true, monitorSignals: false, notifyAdvice: false,
      notifyCreditExpiry: false, quietHoursEnabled: false, ...stored.settings } },
    fetcher(url) {
      if (url.endsWith("/auth/session")) return json({ accessToken: source.token });
      if (url.endsWith("/usage")) return json(source.raw, source.usageStatus);
      if (url.endsWith("/rate-limit-reset-credits")) return json({ available_count: 0, credits: [] }, source.creditsStatus);
      throw new Error("Unexpected network request");
    }
  });
  const delivered = [];
  const create = worker.context.chrome.notifications.create;
  worker.context.chrome.notifications.create = async (id, options) => { await create(id, options); delivered.push({ id, ...options }); };
  return { ...worker, source, delivered,
    refresh: () => worker.send({ type: "REFRESH_NOW" }, worker.sender("popup")),
    save: settings => worker.send({ type: "SAVE_SETTINGS", settings: { ...worker.local.settings, ...settings } }, worker.sender("options"))
  };
}
const jwt = (user, account, extra = {}) => "e30." + Buffer.from(JSON.stringify({
  sub: user, "https://api.openai.com/auth": { chatgpt_account_id: account }, ...extra
})).toString("base64url") + ".signature";

test("first successful reading at 100% is a baseline, including an upgrade with cached quota", async () => {
  const h = harness({ accountSnapshot: { usage: { windows: [{ kind: "weekly", remainingPercent: 20 }] } } });
  h.source.raw = usage(0, 0);
  await h.refresh();
  await h.refresh();
  assert.equal(h.delivered.length, 0);
  assert.equal(h.local.recoveryState.windows.weekly.used, 0);
});

test("both quotas recovering together produce one Korean desktop notification and no duplicate", async () => {
  const h = harness();
  await h.refresh();
  h.source.raw = usage(0, 0);
  await h.refresh();
  await h.refresh();
  assert.equal(h.delivered.length, 1);
  assert.match(h.delivered[0].title, /100%로 리셋/);
  assert.match(h.delivered[0].message, /5시간 60% → 100%.*주간 75% → 100%/);
  assert.equal(h.delivered[0].type, "basic");
  assert.equal(h.delivered[0].contextMessage, "Codex 리셋 레이더");
});

test("each quota can recover separately and recover again after new consumption without changing reset time", async () => {
  const h = harness();
  await h.refresh();
  h.source.raw = usage(0, 25); await h.refresh();
  h.source.raw = usage(0, 0); await h.refresh();
  h.source.raw = usage(5, 0); await h.refresh();
  h.source.raw = usage(0, 0); await h.refresh();
  assert.equal(h.delivered.length, 3);
  assert.equal(new Set(h.delivered.map(item => item.id)).size, 3);
  assert.match(h.delivered[0].message, /5시간/);
  assert.doesNotMatch(h.delivered[0].message, /주간/);
  assert.match(h.delivered[1].message, /주간/);
});

test("rounding, partial recovery and a passed reset timestamp do not mean full recovery", async () => {
  const h = harness();
  await h.refresh();
  h.source.raw = usage(0.4, 10);
  h.source.raw.rate_limit.primary_window.reset_at = Math.floor(Date.now() / 1000) - 100;
  await h.refresh();
  assert.equal(h.local.accountSnapshot.usage.windows[0].remainingPercent, 100);
  assert.equal(h.delivered.length, 0);
  h.source.raw = usage(0, 10); await h.refresh();
  assert.equal(h.delivered.length, 1);
  assert.match(h.delivered[0].message, /99.6% → 100%/);
});

test("an exhausted blocked quota can recover, but a contradictory blocked full reading is not an alert", async () => {
  const h = harness();
  h.source.raw = usage(100, 100); h.source.raw.rate_limit.allowed = false;
  await h.refresh();
  h.source.raw = usage(0, 0); await h.refresh();
  assert.equal(h.delivered.length, 1);
  h.source.raw = usage(); await h.refresh();
  h.source.raw = usage(0, 0); h.source.raw.rate_limit.allowed = false;
  await h.refresh();
  h.source.raw = usage(0, 0); await h.refresh();
  assert.equal(h.delivered.length, 1);
});

test("window durations identify quotas even when primary and secondary swap", async () => {
  const h = harness(); await h.refresh();
  h.source.raw = usage(0, 25);
  const rate = h.source.raw.rate_limit;
  [rate.primary_window, rate.secondary_window] = [rate.secondary_window, rate.primary_window];
  await h.refresh();
  assert.equal(h.delivered.length, 1);
  assert.match(h.delivered[0].message, /5시간 60% → 100%/);
});

test("temporary failures and absent windows preserve a recent baseline without fabricating recovery", async () => {
  const h = harness(); await h.refresh();
  h.source.usageStatus = 500; await h.refresh();
  assert.equal(h.delivered.length, 0);
  h.source.usageStatus = 200;
  h.source.raw = usage(0, 0); delete h.source.raw.rate_limit.secondary_window;
  await h.refresh();
  h.source.raw = usage(0, 0); await h.refresh();
  assert.equal(h.delivered.length, 2);
  assert.match(h.delivered[1].message, /주간/);
});

test("a baseline survives weekends; only baselines and outbox older than 30 days expire", () => {
  const h = harness(), core = h.context.RadarRecovery, normalize = h.context.RadarUsage.normalizeUsage;
  let state = core.advance(null, normalize(usage()), "account", { now: 1 });
  state = core.advance(state, normalize(usage(0, 0)), "account", { now: 24 * 3600000 + 2 });
  assert.equal(state.events.length, 1);
  assert.equal(state.events[0].catchUp, true);
  state = core.advance(state, normalize(usage()), "account", { now: 24 * 3600000 + 3 });
  state = core.advance(state, normalize(usage(0, 0)), "account", { now: 24 * 3600000 + 4 });
  assert.equal(state.events.length, 2);
  assert.equal(core.currentEvents(state, 32 * 24 * 3600000 + 5).length, 0);
  let stale = core.advance(null, normalize(usage()), "account", { now: 1 });
  stale = core.advance(stale, normalize(usage(0, 0)), "account", { now: 31 * 24 * 3600000 });
  assert.equal(stale.events.length, 0);
});

test("invalid percentages cannot be interpreted as exact zero", () => {
  const h = harness(), core = h.context.RadarRecovery, normalize = h.context.RadarUsage.normalizeUsage;
  for (const invalid of [-1, 101, false, true, " "]) {
    let state = core.advance(null, normalize(usage()), "account", { now: 1 });
    state = core.advance(state, normalize(usage(invalid, 25)), "account", { now: 2 });
    state = core.advance(state, normalize(usage(0, 25)), "account", { now: 3 });
    assert.equal(state.events.length, 0, String(invalid));
  }
});

test("salted account fingerprints survive known JWT rotation but separate users, workspaces, response scopes and salts", async () => {
  const key = harness().context.RadarRecovery.accountKey;
  const first = await key(jwt("user-one", "workspace-one", { exp: 1 }), {}, "salt-one");
  assert.equal(first, await key(jwt("user-one", "workspace-one", { exp: 2 }), {}, "salt-one"));
  for (const args of [
    [jwt("user-two", "workspace-one"), {}, "salt-one"],
    [jwt("user-one", "workspace-two"), {}, "salt-one"],
    [jwt("user-one", "workspace-one"), { account_id: "other" }, "salt-one"],
    [jwt("user-one", "workspace-one"), {}, "salt-two"]
  ]) assert.notEqual(first, await key(...args));
  assert.match(first, /^[a-f0-9]{64}$/);
  assert.notEqual(await key("opaque-one", {}, "salt"), await key("opaque-two", {}, "salt"));
  assert.equal(await key(null, {}, "salt"), null);
});

test("account or plan changes establish new baselines; raw credentials and identifiers are not stored", async () => {
  const h = harness();
  h.source.token = jwt("private-user-a", "private-account-a");
  await h.refresh();
  h.source.token = jwt("private-user-b", "private-account-b");
  h.source.raw = usage(0, 0); await h.refresh();
  assert.equal(h.delivered.length, 0);
  h.source.raw = usage(); await h.refresh();
  h.source.raw = usage(0, 0); h.source.raw.plan_type = "pro"; await h.refresh();
  assert.equal(h.delivered.length, 0);
  const saved = JSON.stringify(h.local);
  assert.doesNotMatch(saved, /private-user|private-account|signature/);
  assert.equal(Object.keys(h.session).length, 0);
});

test("logout clears recovery data and a login already full is not a reset", async () => {
  const h = harness(); await h.refresh();
  h.source.usageStatus = 401; h.source.creditsStatus = 401; await h.refresh();
  assert.equal(h.local.recoveryState, undefined);
  assert.equal(h.local.recoverySalt, undefined);
  h.source.usageStatus = 200; h.source.creditsStatus = 200;
  h.source.raw = usage(0, 0); await h.refresh();
  assert.equal(h.delivered.length, 0);
});

test("transient session failures preserve comparison but an explicit logout clears it", async () => {
  for (const mode of ["session", "unauthorized", "session-and-network"]) {
    const h = harness(); await h.refresh();
    if (mode.startsWith("session")) h.source.token = null;
    if (mode === "unauthorized") h.source.usageStatus = 401;
    if (mode === "session-and-network") h.source.usageStatus = h.source.creditsStatus = 500;
    await h.refresh();
    h.source.token = FAKE_TOKEN; h.source.usageStatus = h.source.creditsStatus = 200;
    h.source.raw = usage(0, 0); await h.refresh();
    assert.equal(h.delivered.length, mode === "unauthorized" ? 0 : 1, mode);
  }
});

test("turning only recovery alerts off keeps tracking and does not issue a retroactive alert when re-enabled", async () => {
  const h = harness(); await h.refresh();
  await h.save({ notifyAccountReset: false });
  h.source.raw = usage(0, 0); await h.refresh();
  await h.save({ notifyAccountReset: true }); await h.refresh();
  assert.equal(h.delivered.length, 0);
  h.source.raw = usage(); await h.refresh();
  h.source.raw = usage(0, 0); await h.refresh();
  assert.equal(h.delivered.length, 1);
});

test("quiet hours queue separate recoveries and release them only after fresh successful quota verification", async () => {
  const h = harness(); let quiet = true;
  h.context.RadarTime = { ...h.context.RadarTime, isQuietHours: () => quiet };
  await h.refresh();
  h.source.raw = usage(0, 25); await h.refresh();
  h.source.raw = usage(0, 0); await h.refresh();
  assert.equal(h.delivered.length, 0);
  assert.equal(h.local.pendingNotifications.length, 2);
  quiet = false; h.source.usageStatus = 500; await h.refresh();
  assert.equal(h.delivered.length, 0);
  assert.equal(h.local.pendingNotifications.length, 2);
  h.source.usageStatus = 200; h.source.raw = usage(5, 5); await h.refresh();
  assert.equal(h.delivered.length, 2);
  assert.match(h.delivered[0].message, /조회값입니다/);
  assert.equal(h.local.pendingNotifications.length, 0);
  await h.refresh(); assert.equal(h.delivered.length, 2);
});

test("queued recoveries for the old account are removed after an account switch", async () => {
  const h = harness(); let quiet = true;
  h.context.RadarTime = { ...h.context.RadarTime, isQuietHours: () => quiet };
  await h.refresh(); h.source.raw = usage(0, 0); await h.refresh();
  assert.equal(h.local.pendingNotifications.length, 1);
  quiet = false; h.source.token = "ANOTHER_AUDIT_ONLY_TOKEN"; await h.refresh();
  assert.equal(h.local.pendingNotifications.length, 0);
  assert.equal(h.delivered.length, 0);
});

test("disabling account monitoring removes fingerprints, baselines, queued/visible alerts and dedupe history", async () => {
  const h = harness(); await h.refresh();
  h.source.raw = usage(0, 0); await h.refresh();
  await h.save({ monitorAccount: false });
  assert.equal(h.local.recoveryState, undefined);
  assert.equal(h.local.recoverySalt, undefined);
  assert.equal(Object.keys(h.notifications).length, 0);
  assert.equal(h.local.pendingNotifications.length, 0);
  assert.equal(Object.keys(h.local.notificationHistory).length, 0);
});

test("disabling recovery alerts removes queued and visible recovery notifications", async () => {
  for (const quiet of [true, false]) {
    const h = harness(); h.context.RadarTime = { ...h.context.RadarTime, isQuietHours: () => quiet };
    await h.refresh(); h.source.raw = usage(0, 0); await h.refresh();
    await h.save({ notifyAccountReset: false });
    assert.equal(h.local.pendingNotifications.length, 0);
    assert.equal(Object.keys(h.notifications).length, 0);
    assert.equal(h.local.recoveryState.events.length, 0);
  }
});

test("service worker restart retains the baseline and notification dedupe", async () => {
  let h = harness(); await h.refresh();
  h = harness(h.local); h.source.raw = usage(0, 0); await h.refresh();
  assert.equal(h.delivered.length, 1);
  h = harness(h.local); h.source.raw = usage(0, 0); await h.refresh();
  assert.equal(h.delivered.length, 0);
});

test("a rejected desktop notification remains in the outbox and retries once", async () => {
  const h = harness(); await h.refresh();
  const create = h.context.chrome.notifications.create;
  h.context.chrome.notifications.create = async () => { throw new Error("Mock notification failure"); };
  h.source.raw = usage(0, 0); await h.refresh();
  assert.equal(h.local.recoveryState.events.length, 1);
  assert.equal(h.delivered.length, 0);
  h.context.chrome.notifications.create = create;
  await h.refresh(); await h.refresh();
  assert.equal(h.delivered.length, 1);
});

test("clearing local data also clears recovery fingerprints and avoids a false reset on reconnect", async () => {
  const h = harness(); await h.refresh();
  await h.send({ type: "CLEAR_LOCAL_DATA" }, h.sender("options"));
  assert.equal(h.local.recoveryState, undefined);
  assert.equal(h.local.recoverySalt, undefined);
  h.source.raw = usage(0, 0); await h.refresh();
  assert.equal(h.delivered.length, 0);
});

test("recovery event retention is bounded even across repeated manual resets", () => {
  const h = harness(), core = h.context.RadarRecovery, normalize = h.context.RadarUsage.normalizeUsage;
  let state;
  for (let i = 0; i < 30; i++) {
    state = core.advance(state, normalize(usage()), "account", { now: 2 * i + 1 });
    state = core.advance(state, normalize(usage(0, 0)), "account", { now: 2 * i + 2 });
  }
  assert.equal(state.events.length, 8);
  assert.equal(state.sequence, 30);
});

test("Chrome startup catches recovery after three offline days even during extension quiet hours", async () => {
  let h = harness(); await h.refresh();
  for (const baseline of Object.values(h.local.recoveryState.windows)) baseline.observedAt -= 3 * 86400000;
  h = harness(h.local);
  h.context.RadarTime = { ...h.context.RadarTime, isQuietHours: () => true };
  h.source.raw = usage(0, 0);
  await h.events.startup();
  assert.equal(h.delivered.length, 1);
  assert.match(h.delivered[0].message, /다시 확인한 결과/);
  assert.equal(h.local.resumeCheck, undefined);
  await h.events.startup();
  assert.equal(h.delivered.length, 1);
});

test("startup retry survives missing network and re-verifies before delivering; retry count is bounded", async () => {
  const h = harness(); await h.refresh();
  const alarms = [];
  h.context.chrome.alarms.create = async (name, options) => alarms.push({ name, ...options });
  h.source.token = null; h.source.usageStatus = h.source.creditsStatus = 500;
  await h.events.startup();
  assert.equal(h.delivered.length, 0);
  assert.ok(h.local.recoveryState.windows.weekly);
  for (let i = 0; i < 5; i++) await h.events.alarm({ name: "codex-reset-radar-resume" });
  assert.equal(alarms.filter(alarm => alarm.name === "codex-reset-radar-resume").length, 5);
  assert.equal(h.delivered.length, 0);
  h.source.token = FAKE_TOKEN; h.source.usageStatus = h.source.creditsStatus = 200;
  h.source.raw = usage(0, 0);
  await h.events.alarm({ name: "codex-reset-radar-poll" });
  assert.equal(h.delivered.length, 1);
  assert.equal(h.local.resumeCheck, undefined);
});

test("startup releases a previously queued recovery only for verified identity, and respects catch-up preference", async () => {
  for (const sameAccount of [true, false]) {
    const h = harness();
    h.context.RadarTime = { ...h.context.RadarTime, isQuietHours: () => true };
    await h.refresh(); h.source.raw = usage(0, 0); await h.refresh();
    assert.equal(h.local.pendingNotifications.length, 1);
    if (!sameAccount) h.source.token = "OTHER_ACCOUNT_TOKEN";
    await h.events.startup();
    assert.equal(h.delivered.length, sameAccount ? 1 : 0);
  }
  const h = harness({ settings: { notifyRecoveryOnResume: false } });
  await h.refresh(); h.source.raw = usage(0, 0);
  h.context.RadarTime = { ...h.context.RadarTime, isQuietHours: () => true };
  await h.events.startup();
  assert.equal(h.delivered.length, 0);
  assert.equal(h.local.pendingNotifications.length, 1);
});

test("already used quota after offline reset reports observed remaining, never claims 100 percent", async () => {
  const h = harness(); await h.refresh();
  const past = Date.now() - 86400000;
  h.local.recoveryState.windows.weekly = { used: 90, observedAt: past - 86400000, resetAt: past };
  h.source.raw = usage(40, 20);
  await h.refresh();
  assert.equal(h.delivered.length, 1);
  assert.match(h.delivered[0].title, /주기 변경/);
  assert.match(h.delivered[0].message, /주간 10% → 80%/);
  assert.doesNotMatch(h.delivered[0].message + h.delivered[0].title, /100%/);
});

test("a postponed timestamp or consumption without observed quota recovery is not a reset", async () => {
  for (const used of [25, 60]) {
    const h = harness(); await h.refresh();
    h.local.recoveryState.windows.weekly.resetAt = Date.now() - 1000;
    h.local.recoveryState.windows.weekly.observedAt = Date.now() - 10000;
    h.source.raw = usage(40, used); await h.refresh();
    assert.equal(h.delivered.length, 0);
  }
});

test("a missing token with a full response never emits until identity is verified", async () => {
  const h = harness(); await h.refresh();
  h.source.token = null; h.source.raw = usage(0, 0); await h.refresh();
  assert.equal(h.delivered.length, 0);
  h.source.token = "DIFFERENT_ACCOUNT_TOKEN"; await h.refresh();
  assert.equal(h.delivered.length, 0);
});
