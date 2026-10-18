const test = require('node:test');
const assert = require('node:assert/strict');
const {makeWorker, json, finishPublicResume} = require('./helpers/worker');
const NOW = Date.parse('2026-10-13T12:30:00Z');
const LATEST = {id:'2109812360596865224', author:'thsottiaux', text:'Global reset landing by EOD PST time. Enjoy', createdAt:'2026-10-13T01:03:59Z', url:'https://x.com/thsottiaux/status/2109812360596865224'};
function make() {
 const w = makeWorker({stored:{settings:{monitorAccount:false,monitorStatusSource:false,monitorHistorySource:false,monitorCommunitySource:false,quietHoursEnabled:false}},fetcher:async()=>json({items:[]})});
 w.context.Date = class extends Date {static now(){return NOW;}};
 const timelines = ['posts','replies'].flatMap(kind=>['thsottiaux','reach_vb','openai'].map(author=>({author,kind,ok:true,stopReason:'seven-days'})));
 let missing=true;
 w.context.RadarDirectX = {...w.context.RadarDirectX,read:async()=>({items:w.context.RadarDirectX.normalize(missing?[{...LATEST,id:'2109892247580000595',text:'Good plans are simple.',createdAt:'2026-10-13T06:21:26Z',url:'https://x.com/thsottiaux/status/2109892247580000595'}]:[LATEST],NOW),diagnostics:{posts:1,timelines,bodyUnavailableCount:missing?1:0,bodyUnavailable:missing?[{id:LATEST.id,author:LATEST.author,createdAt:LATEST.createdAt}]:[],bodyUnavailableLatestAt:missing?Date.parse(LATEST.createdAt):null}})};
 return {w,recover(){missing=false;}};
}
test('a fresh unrelated post cannot certify a reset body that has not loaded; resumed recovery delivers the restored reset once', async()=>{
 const {w,recover}=make();
 await w.events.startup();
 assert.equal(w.local.signalSnapshot.leadStatus.collectionVerified,false);
 assert.equal(w.local.signalSnapshot.leadStatus.directError,'body-unavailable');
 assert.equal(w.local.collectorHealth.error,'body-unavailable');
 assert.ok(w.local.publicResumeCheck);
 assert.ok(!w.local.seenSignalIds.includes(LATEST.id));
 recover();
 await w.context.refreshSignals();
 await finishPublicResume(w);
 assert.equal(w.local.signalSnapshot.leadStatus.collectionVerified,true);
 assert.equal(w.local.collectorHealth.error,null);
 assert.ok(w.local.signalSnapshot.activeSignals.some(p=>p.id===LATEST.id));
 assert.ok(w.notifications['signal:'+LATEST.id]);
 const history=JSON.stringify(w.local.notificationHistory);
 await w.context.refreshSignals(); await finishPublicResume(w);
 assert.equal(JSON.stringify(w.local.notificationHistory),history);
});
