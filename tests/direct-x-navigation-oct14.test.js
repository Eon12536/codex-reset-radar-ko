const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
function delayedBrowser({initialBlank=false,foreign=false}={}) {
 const listeners=new Set(), calls=[], timers=new Set();
 let tabState, desired;
 const later = (fn,ms) => {const t=setTimeout(()=>{timers.delete(t);fn();},ms);timers.add(t);};
 const notify = change=>{for(const fn of [...listeners])fn(31,change,{...tabState});};
 const owner={tab:{windowId:1},url:url=>url,cleanup:async()=>{calls.push('cleanup');return true;},
  open:async url=>{desired=url;tabState={id:31,windowId:1,active:false,pinned:false,url:initialBlank?'about:blank':url,status:'complete',...(initialBlank?{pendingUrl:url}:{})};
   if(initialBlank)later(()=>{tabState={...tabState,url,status:'complete'};delete tabState.pendingUrl;notify({status:'complete'});},20);
   return {...tabState};},
  navigate:async(id,url)=>{desired=url;tabState={...tabState,status:'complete',pendingUrl:foreign?'https://x.com/i/chat':url};
   later(()=>notify({status:'complete'}),2); // old document completion races with new navigation
   later(()=>{tabState={...tabState,url:tabState.pendingUrl,status:'complete'};delete tabState.pendingUrl;notify({status:'complete'});},20);
   return {...tabState};}}
 const chrome={permissions:{contains:async()=>true},tabs:{get:async()=>({...tabState}),onUpdated:{addListener:fn=>listeners.add(fn),removeListener:fn=>listeners.delete(fn)}},
 scripting:{executeScript:async()=>{assert.equal(tabState.pendingUrl,undefined,'scripts run only after navigation commits');assert.equal(tabState.url,desired,'old page cannot be read as the new timeline');calls.push(tabState.url);
 const reply=tabState.url.endsWith('/with_replies');const id=reply?'2109812360596865224':'2108090000000000000';
 return [{frameId:0,result:{rows:[{id,author:'thsottiaux',text:reply?'Global reset landing by EOD PST time. Enjoy':'Other news',createdAt:new Date().toISOString(),url:'https://x.com/thsottiaux/status/'+id}],stopReason:'seven-days'}}];}}};
 const context=vm.createContext({URL,Date,chrome,setTimeout,clearTimeout,RadarTabOwner:{create:()=>owner}});
 vm.runInContext(fs.readFileSync(require.resolve('../src/core/direct-x'),'utf8'),context);
 return {read:()=>context.RadarDirectX.read(new AbortController().signal,{authors:['thsottiaux']}),calls,listeners,dispose(){for(const t of timers)clearTimeout(t);}};
}
test('the previous complete page and its stale completion event cannot stop collection of the latest reply',async()=>{
 const b=delayedBrowser();try{const result=await b.read();assert.ok(result.items.some(p=>p.id==='2109812360596865224'));assert.ok(result.diagnostics.timelines.every(t=>t.ok));assert.equal(b.listeners.size,0);}finally{b.dispose();}
});
test('initial about:blank completion waits for the exact requested X page to commit',async()=>{
 const b=delayedBrowser({initialBlank:true});try{const result=await b.read();assert.equal(result.diagnostics.timelines.length,2);assert.ok(result.diagnostics.timelines.every(t=>t.ok));assert.equal(b.listeners.size,0);}finally{b.dispose();}
});
test('a pending user navigation to a private or unrelated X page cannot be treated as the requested reader page',async()=>{
 const b=delayedBrowser({foreign:true});try{const result=await b.read();assert.equal(result.items.length,1);assert.equal(b.calls.filter(c=>c.startsWith('https://')).length,1);assert.equal(result.diagnostics.timelines[1].ok,false);assert.equal(b.listeners.size,0);}finally{b.dispose();}
});
