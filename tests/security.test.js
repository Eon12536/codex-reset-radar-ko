const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { makeWorker, FAKE_TOKEN, RAW_USAGE, json } = require("./helpers/worker.js");
const Settings = require("../src/core/settings.js");
const manifest = require("../manifest.json");

function deferred() { let resolve; const promise = new Promise(r=>{resolve=r;}); return {promise,resolve}; }

test("package removes page injection and broad tab access; account access defaults off", () => {
  assert.equal(manifest.content_scripts,undefined);
  assert.equal(manifest.web_accessible_resources,undefined);
  assert.ok(!manifest.permissions.includes("tabs"));
  assert.ok(!fs.existsSync(path.resolve(__dirname,"../src/content.js")));
  assert.equal(Settings.sanitize().monitorAccount,false);
  assert.match(manifest.content_security_policy.extension_pages,/object-src 'none'/);
});

test("upgrade clears legacy tokens and requires account opt-in again", async () => {
  const w = makeWorker({stored:{securitySchema:undefined,settings:{monitorAccount:true},accountSnapshot:{usage:{secret:"legacy"}},pendingNotifications:[{id:"advice:old",options:{message:"old"}}]}});
  w.notifications["advice:old"] = {};
  await w.context.ensureSecurity();
  assert.equal(w.local.settings.monitorAccount,false);
  assert.equal(w.local.accountSnapshot,undefined);
  assert.equal(w.session.sessionAccessToken,undefined);
  assert.equal(Object.keys(w.notifications).length,0);
  assert.equal(w.access.local,"TRUSTED_CONTEXTS");
  assert.equal(w.access.session,"TRUSTED_CONTEXTS");
});

test("OFF makes no account request and purges snapshots, tokens, queued and visible advice", async () => {
  const w=makeWorker(); await w.context.ensureSecurity(); await w.context.refreshAccount();
  assert.ok(w.local.accountSnapshot);
  w.notifications["expiry:old"]={};
  w.local.pendingNotifications=[{id:"advice:old",options:{}},{id:"signal:keep",options:{}}];
  w.local.notificationHistory={"expiry:old":1,"advice:old":2,"signal:keep":3};
  await w.context.saveSettings({...w.local.settings,monitorAccount:false});
  const count=w.requests.length;
  await w.context.refreshAccount();
  assert.equal(w.requests.length,count);
  assert.equal(w.local.accountSnapshot,undefined);
  assert.equal(w.local.accountState,undefined);
  assert.equal(w.session.sessionAccessToken,undefined);
  assert.equal(w.notifications["expiry:old"],undefined);
  assert.deepEqual(w.local.pendingNotifications.map(n=>n.id),["signal:keep"]);
  assert.deepEqual(w.local.notificationHistory,{"signal:keep":3});
});

test("successful account polling never caches or persists login credentials", async () => {
  const w=makeWorker(); const result=await w.context.refreshAccount();
  assert.equal(result.ok,true);
  assert.equal(w.local.accountSnapshot.usage.windows[0].remainingPercent,60);
  assert.ok(!JSON.stringify({local:w.local,session:w.session}).includes(FAKE_TOKEN));
  const authenticated=w.requests.filter(r=>r.options.headers.authorization);
  assert.equal(authenticated.length,2);
  assert.ok(authenticated.every(r=>r.url.startsWith("https://chatgpt.com/backend-api/wham/")));
});

test("OFF aborts in-flight requests and rejects late replies even after OFF then ON", async () => {
  const started=deferred(), release=deferred(); let requestSignal;
  const w=makeWorker({fetcher:async(url,options)=>{
    if(url.endsWith("/auth/session")) {requestSignal=options.signal;started.resolve();await release.promise;return json({accessToken:FAKE_TOKEN});}
    return json(RAW_USAGE);
  }});
  const running=w.context.refreshAccount(); await started.promise;
  await w.context.saveSettings({...w.local.settings,monitorAccount:false});
  await w.context.saveSettings({...w.local.settings,monitorAccount:true});
  assert.equal(requestSignal.aborted,true);
  release.resolve(); await running;
  assert.equal(w.local.accountSnapshot,undefined);
  assert.equal(w.requests.length,1);
});

test("OFF wins a race with a snapshot write already in progress", async () => {
  const writing=deferred(), release=deferred();
  const w=makeWorker({storageHook:async(area,op,data)=>{if(area==="local"&&op==="set"&&data?.accountSnapshot){writing.resolve();await release.promise;}}});
  const running=w.context.refreshAccount(); await writing.promise;
  const disabling=w.context.saveSettings({...w.local.settings,monitorAccount:false});
  release.resolve(); await Promise.all([running,disabling]);
  assert.equal(w.local.accountSnapshot,undefined);
  assert.equal(w.local.settings.monitorAccount,false);
  assert.ok(!JSON.stringify(w.local.adviceSnapshot).includes("60%"));
});

test("clearing data also cancels pending account replies", async () => {
  const started=deferred(), release=deferred();
  const w=makeWorker({fetcher:async()=>{started.resolve();await release.promise;return json({accessToken:FAKE_TOKEN});}});
  const running=w.context.refreshAccount(); await started.promise;
  await w.context.clearLocalData(); release.resolve(); await running;
  assert.equal(w.local.accountSnapshot,undefined);
  assert.equal(w.session.sessionAccessToken,undefined);
});

test("a delayed public refresh cannot restore account advice after account access is disabled", async () => {
  const started=deferred(), release=deferred();
  const w=makeWorker({stored:{accountSnapshot:{usage:{windows:[{kind:"weekly",remainingPercent:7}]},credits:{availableCount:2}}},fetcher:async(url)=>{
    started.resolve();await release.promise;
    return url.includes("codex-resets.com") ? new Response("",{headers:{"content-type":"text/html"}}) : json({items:[]});
  }});
  const running=w.context.refreshSignals();await started.promise;
  await w.context.saveSettings({...w.local.settings,monitorAccount:false});
  release.resolve();await running;
  assert.equal(w.local.accountSnapshot,undefined);
  assert.equal(w.local.adviceSnapshot.tier,"guest");
});

test("partial account responses do not reuse snapshots from a previous account", async () => {
  const w=makeWorker({stored:{accountSnapshot:{usage:{windows:[{kind:"weekly",remainingPercent:99}]}}},fetcher:async(url)=>{
    if(url.endsWith('/auth/session'))return json({accessToken:FAKE_TOKEN});
    if(url.endsWith('/usage'))return json({},401);
    return json({available_count:0,credits:[]});
  }});
  await w.context.refreshAccount();
  assert.equal(w.local.accountSnapshot,undefined);
  assert.equal(w.local.accountState.status,"signedOut");
});

test("messages from websites, content scripts, other extensions, frames and legacy token senders are rejected", async () => {
  const w=makeWorker();
  const message={type:"SAVE_SETTINGS",settings:{monitorAccount:true}};
  for(const sender of [{id:w.runtime.id,url:"https://chatgpt.com/",frameId:0}, {...w.sender("options"),id:"another"}, {...w.sender("options"),frameId:1}, {...w.sender("options"),documentLifecycle:"prerender"}, w.sender("popup"), {}]) {
    assert.equal((await w.send(message,sender)).ok,false);
  }
  for(const type of ["CACHE_SESSION_TOKEN","STORE_ACCOUNT_SNAPSHOT","__proto__"]) assert.equal((await w.send({type,token:FAKE_TOKEN},w.sender("options"))).ok,false);
  assert.equal(w.requests.length,0);
});

test("legitimate settings and welcome messages work without a tab frameId", async () => {
  const w=makeWorker({stored:{settings:{monitorAccount:false},securitySchema:1}});
  const sender={...w.sender("options")};delete sender.frameId;
  assert.equal((await w.send({type:"SAVE_SETTINGS",settings:{monitorAccount:false,pollMinutes:15}},sender)).ok,true);
  assert.equal(w.local.settings.pollMinutes,15);
  assert.equal((await w.send({type:"ENABLE_ACCOUNT"},w.sender("welcome"))).ok,true);
  assert.equal(w.local.settings.monitorAccount,true);
});

test("settings discard unknown fields, custom endpoints and invalid types", () => {
  const value=Settings.sanitize(JSON.parse('{"__proto__":{"polluted":true},"token":"secret","sourceUrl":"https://evil.invalid","monitorAccount":"true","quietStart":"99:99","pollMinutes":1}'));
  assert.equal(value.monitorAccount,false);
  assert.equal(value.sourceUrl,"");assert.equal(value.token,undefined);assert.equal(value.polluted,undefined);
  assert.equal(value.quietStart,"23:00");assert.equal(value.pollMinutes,30);
});

test("public requests omit cookies, credentials, referrers and tokens", async () => {
  const w=makeWorker();await w.context.refreshSignals();
  assert.equal(w.requests.length,4);
  for(const {options} of w.requests){assert.equal(options.credentials,"omit");assert.equal(options.referrerPolicy,"no-referrer");assert.equal(options.headers.authorization,undefined);assert.equal(options.redirect,"error");assert.equal(options.method,"GET");}
});

test("unexpected account destinations and tokens attached to public requests are blocked before fetch", async () => {
  const w=makeWorker();
  for(const url of ["http://chatgpt.com/backend-api/wham/usage","https://chatgpt.com.evil.invalid/backend-api/wham/usage","https://chatgpt.com/backend-api/conversations","https://user:pass@chatgpt.com/backend-api/wham/usage","https://chatgpt.com/backend-api/wham/usage?next=x"]){await assert.rejects(w.context.RadarSecurity.fetchData(url,{account:true,token:FAKE_TOKEN}),/Blocked/);}
  await assert.rejects(w.context.RadarSecurity.fetchData(w.context.RadarSources.DEFINITIONS[0].url,{token:FAKE_TOKEN}),/Blocked/);
  assert.equal(w.requests.length,0);
});

test("HTML in JSON responses and oversized chunked responses are rejected", async () => {
  const badType=makeWorker({fetcher:async()=>new Response('<html>bad</html>',{headers:{'content-type':'text/html'}})});
  await assert.rejects(badType.context.RadarSecurity.fetchData('https://chatgpt.com/api/auth/session',{account:true}),/response type/);
  const large=makeWorker({fetcher:async()=>new Response('x'.repeat(1024*1024+1),{headers:{'content-type':'application/json'}})});
  await assert.rejects(large.context.RadarSecurity.fetchData('https://chatgpt.com/api/auth/session',{account:true}),/too large/);
});

test("valid evidence links are canonicalized; phishing domains, schemes, credentials and wrong source paths are blocked", async () => {
  const w=makeWorker();const safe=w.context.RadarSecurity.evidenceUrl;
  assert.equal(safe({source:{id:'codex-lead'},url:'https://twitter.com/thsottiaux/status/12345?s=20'}),'https://x.com/thsottiaux/status/12345');
  assert.equal(safe({source:{id:'openai-status'},url:'https://status.openai.com/incidents/abc123'}),'https://status.openai.com/incidents/abc123');
  assert.equal(safe({source:{id:'github-community'},url:'https://github.com/openai/codex/issues/42'}),'https://github.com/openai/codex/issues/42');
  for(const url of ['javascript:alert(1)','data:text/html,test','https://audit-phishing.invalid/sign-in','https://x.com.evil.invalid/thsottiaux/status/123','https://x.com@evil.invalid/thsottiaux/status/123','https://user:pass@x.com/thsottiaux/status/123','https://x.com:8443/thsottiaux/status/123','https://x.com/attacker/status/123','https://x.com/thsottiaux/status/123/redirect'])assert.equal(safe({source:{id:'codex-lead'},url}),null,url);
  await w.context.ensureSecurity();
  w.local.signalSnapshot={signal:{url:'https://audit-phishing.invalid/sign-in',source:{id:'codex-lead'},assessment:{actionable:true,eventAt:Date.now()+3600000}}};
  assert.equal((await w.context.openEvidence()).ok,false);assert.equal(w.tabs.length,0);
});
