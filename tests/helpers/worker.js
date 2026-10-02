const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const src = path.resolve(__dirname, "../../src");
const FAKE_TOKEN = "AUDIT_ONLY_NOT_A_REAL_TOKEN";
const RAW_USAGE = { rate_limit: { primary_window: { used_percent: 40, limit_window_seconds: 18000, reset_after_seconds: 1800 }, secondary_window: { used_percent: 25, limit_window_seconds: 604800, reset_after_seconds: 86400 } } };
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });

function makeWorker({ stored = {}, fetcher, storageHook } = {}) {
  const local = structuredClone({ settings: { monitorAccount: true, quietHoursEnabled: false }, securitySchema: 1, ...stored });
  const session = { sessionAccessToken: "OLD_TOKEN", sessionAccessTokenExpiresAt: 99 };
  const requests = [], tabs = [], notifications = {}, access = {}, events = {};
  const event = name => ({ addListener(fn) { events[name] = fn; } });
  function area(name, values) {
    return {
      async get(keys) {
        await storageHook?.(name, "get", keys);
        if (typeof keys === "string") return structuredClone({ [keys]: values[keys] });
        if (Array.isArray(keys)) return structuredClone(Object.fromEntries(keys.map(key => [key, values[key]])));
        return structuredClone(values);
      },
      async set(data) { await storageHook?.(name, "set", data); Object.assign(values, structuredClone(data)); },
      async remove(keys) { for (const key of Array.isArray(keys) ? keys : [keys]) delete values[key]; },
      async clear() { for (const key of Object.keys(values)) delete values[key]; },
      async setAccessLevel(options) { access[name] = options.accessLevel; }
    };
  }
  const runtime = {
    id: "audit-extension", getURL: p => "chrome-extension://audit-extension/" + p,
    onMessage: event("message"), onInstalled: event("installed"), onStartup: event("startup"), openOptionsPage: async () => {}
  };
  const context = vm.createContext({
    URL, Date, Intl, AbortController, AbortSignal, TextDecoder, TextEncoder, atob, setTimeout, clearTimeout,
    crypto: require("node:crypto").webcrypto,
    fetch: async (url, options) => {
      requests.push({url,options});
      if (fetcher) return fetcher(url, options);
      if (url.endsWith("/auth/session")) return json({ accessToken: FAKE_TOKEN });
      if (url.endsWith("/usage")) return json(RAW_USAGE);
      if (url.endsWith("/rate-limit-reset-credits")) return json({available_count:0,credits:[]});
      if (url.includes("codex-resets.com")) return new Response("", {headers:{"content-type":"text/html"}});
      return json({items:[]});
    },
    chrome: {
      runtime, i18n:{getMessage:()=>"",getUILanguage:()=>"ko-KR"},
      permissions: { contains: async () => false },
      storage:{local:area("local",local),session:area("session",session)},
      alarms:{onAlarm:event("alarm"),clear:async()=>{},create:async()=>{}},
      action:{setBadgeText:async()=>{},setBadgeBackgroundColor:async()=>{},setTitle:async()=>{}},
      notifications:{onClicked:event("notificationClick"),onButtonClicked:event("notificationButton"),getAll:async()=>({...notifications}),clear:async id=>{delete notifications[id];},create:async(id,options)=>{notifications[id]=structuredClone(options);}},
      tabs:{create:async options=>tabs.push(options)}
    }
  });
  context.importScripts = (...files) => files.forEach(file => vm.runInContext(fs.readFileSync(path.join(src,file),"utf8"),context,{filename:file}));
  vm.runInContext(fs.readFileSync(path.join(src,"background.js"),"utf8"),context);
  return {
    context, local, session, requests, tabs, notifications, access, events, runtime,
    sender: page => ({id:runtime.id,url:runtime.getURL("src/"+page+"/"+page+".html"),frameId:0,documentLifecycle:"active"}),
    send(message, sender) { return new Promise(resolve => { const keep = events.message(message,sender,resolve); if (keep===false) resolve({ok:false}); }); }
  };
}
module.exports = { makeWorker, FAKE_TOKEN, RAW_USAGE, json };
