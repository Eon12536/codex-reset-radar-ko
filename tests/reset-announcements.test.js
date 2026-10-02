const test=require('node:test'),assert=require('node:assert/strict');
global.RadarTime=require('../src/core/time');
const Signals=require('../src/core/signals'),Direct=require('../src/core/direct-x'),Security=require('../src/core/security');
const now=Date.parse('2026-09-27T07:30:00Z');
const post=(id,author,text,createdAt)=>({id,author,text,createdAt,url:`https://x.com/${author}/status/${id}`,source:{id:'codex-lead',weight:1}});
const promise=post('2103637477760311522','thsottiaux',"o yes… we’re back in action and we’ll reset usage limits for all paid users across codex and ChatGPT work\n\nsorry about the brief disruption!\n\n(and yes we have a special spare codex when things are down to help us out)",'2026-09-26T00:07:13Z');
const done=post('2103911959544610829','thsottiaux','Resets all propagated. That will be all. Have a fantastic weekend.','2026-09-26T18:17:54Z');
const vb=post('2103912596592267509','reach_vb','Reset should be reflected for everyone - happy weekend!!','2026-09-26T18:20:26Z');
test('dated real Tibo promise is recognized without inventing an ETA and remains in news',()=>{
 const assessment=Signals.classify(promise,{now});
 assert.equal(assessment.actionable,true);assert.equal(assessment.eventAt,null);
 assert.equal(Signals.isActive({...promise,assessment},{now}),true);
 assert.equal(Signals.resetKind(promise),'ordinary');
});
test('plural propagation completion and VB rollout wording become reports with safe original links',()=>{
 for(const p of [done,vb]){
  assert.equal(Signals.reports([p],{now})[0]?.assessment.report,'completed-reset');
  assert.equal(Signals.resetKind(p),'unknown');
  assert.equal(Security.evidenceUrl(p),p.url);
  assert.equal(Direct.normalize([p],now)[0].author,p.author);
 }
});
test('new author does not weaken exclusions or attribute unrelated authors and suggestions',()=>{
 for(const text of ['We should reset Codex limits','Reset should be reflected for everyone?','We will not reset Codex usage limits','We will reset your password','Resets all propagated last year']){
  const p={...vb,text};assert.equal(Signals.classify(p,{now}).actionable,false,text);assert.equal(Signals.reports([p],{now}).length,0,text);
 }
 assert.equal(Signals.reports([{...vb,author:'someone'}],{now}).length,0);
 assert.equal(Direct.normalize([{...vb,author:'someone',url:'https://x.com/someone/status/'+vb.id}],now).length,0);
 assert.equal(Security.evidenceUrl({...vb,url:'https://x.com/attacker/status/'+vb.id}),null);
});
