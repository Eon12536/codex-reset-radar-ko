const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function locale({value='ko-KR',fail=false}={}) {
 const storage={uiLocale:value,settings:{monitorAccount:false,timezoneOverride:'Asia/Seoul'},appearanceTheme:'dark'},events=[];
 const context=vm.createContext({chrome:{storage:{local:{get:async()=>({...storage}),set:async values=>{if(fail)throw Error('storage');Object.assign(storage,values);}},onChanged:{addListener:fn=>events.push(fn)}}}});
 for(const file of ['translations','i18n','ui-copy-locales','ui-copy'])vm.runInContext(fs.readFileSync(require.resolve('../src/core/'+file),'utf8'),context);
 return {i18n:context.RadarI18n,copy:context.RadarUiCopy,storage,events,context};
}
test('country language persists independently from consent, theme and timezone',async()=>{
 const a=locale();await a.i18n.ready;await a.i18n.save('en-US');
 assert.equal(a.i18n.uiLanguage(),'en-US');assert.equal(a.copy.translate('남은 사용량'),'Remaining quota');
 assert.deepEqual(a.storage.settings,{monitorAccount:false,timezoneOverride:'Asia/Seoul'});assert.equal(a.storage.appearanceTheme,'dark');
 const b=locale({value:a.storage.uiLocale});await b.i18n.ready;assert.equal(b.i18n.uiLanguage(),'en-US');
 b.events[0]({uiLocale:{newValue:'ko-KR'}},'local');assert.equal(b.i18n.uiLanguage(),'ko-KR');
});
test('unsupported and failed language changes cannot overwrite the saved language',async()=>{
 const a=locale({fail:true});await a.i18n.ready;
 await assert.rejects(a.i18n.save('xx-XX'),{name:'TypeError'});await assert.rejects(a.i18n.save('en-US'));
 assert.equal(a.i18n.uiLanguage(),'ko-KR');assert.equal(a.storage.uiLocale,'ko-KR');
});
test('key popup and collection messages have English translations',async()=>{
 const a=locale({value:'en-US'});await a.i18n.ready;
 for(const text of ['Tibo · VB 리셋 소식','예고 시간보다 늦어질 수 있어요','reset 완료','일정 미정','원글·답글 23개 확인','Banked reset · 리셋권','계정 기록 연결','미확인'])assert.doesNotMatch(a.copy.translate(text),/[가-힣]/,text);
 assert.equal(a.copy.translate('Resets all propagated. That will be all.'),'Resets all propagated. That will be all.');
});

test('all eight countries persist and render their interface language without translating posts',async()=>{
 const labels={'ko-KR':'남은 사용량','en-US':'Remaining quota','en-GB':'Remaining quota','ja-JP':'残りの利用枠','zh-CN':'剩余额度','fr-FR':'Quota restant','es-ES':'Cuota restante','it-IT':'Quota residua'};
 for(const [value,expected] of Object.entries(labels)){
  const a=locale();await a.i18n.ready;await a.i18n.save(value);
  assert.equal(a.copy.translate('남은 사용량'),expected);
  const reopened=locale({value:a.storage.uiLocale});await reopened.i18n.ready;
  assert.equal(reopened.i18n.uiLanguage(),value);
  if (value !== 'ko-KR') for (const key of ['creditsExpiryPrefix', 'statusSummaryLabel', 'chatQuotaUnknown', 'chatLegacyPolicy'])
   assert.doesNotMatch(a.i18n.t(key), /[가-힣]/, key);
  assert.equal(reopened.copy.translate('Resets all propagated. That will be all.'),'Resets all propagated. That will be all.');
  assert.equal(a.storage.settings.timezoneOverride,'Asia/Seoul');
  if(value!=='ko-KR') for(const text of ['Tibo · VB 리셋 소식','국가 선택','언어를 저장했습니다.','원글·답글 23개 확인',
    '리셋 후속', '후속 안내', '리셋 반영 문제 조사·보완 안내 · 추가 리셋 여부·시각 미확정',
    '리셋 반영 문제 수정 안내 · 추가 리셋 지급·내 계정 반영은 별도 확인', '리셋 예고·후속·완료·리셋권 공지 알림'])assert.doesNotMatch(a.copy.translate(text),/[가-힣]/);
 }
});

test('completion, credit and publication-time tooltips do not mix Korean into other country languages',async()=>{
 const texts=['작성자가 리셋 완료를 알림 · 내 계정 반영은 잔여량 조회로 확인',
  '리셋권 지급 안내 · 자동 한도 리셋과 구분',
  '표시 시각은 게시 시각입니다. 실제 지급·계정 반영 시각은 별도 확인이 필요합니다. 게시 10/3 13:00 · 이미 지난 일정일 수 있습니다.'];
 for(const value of ['en-US','en-GB','ja-JP','zh-CN','fr-FR','es-ES','it-IT']){
  const a=locale({value});await a.i18n.ready;
  for(const text of texts)assert.doesNotMatch(a.copy.translate(text),/[가-힣]/,value+': '+text);
  assert.equal(a.copy.translate('Resets all propagated.'),'Resets all propagated.');
 }
});

test('forecast basis and accessible labels contain no leftover Korean in other countries',async()=>{
 for(const value of ['en-US','en-GB','ja-JP','zh-CN','fr-FR','es-ES','it-IT']) {
  const a=locale({value});await a.i18n.ready;
  for(const text of ['공개 글 기준','커뮤니티 기록 기준','참고 예상'])
   assert.doesNotMatch(a.copy.translate(text),/[가-힣]/,value+': '+text);
 }
});

test('actual settings collection diagnostics translate off, error, legacy and partial-scan states',async()=>{
 const source=fs.readFileSync(require.resolve('../src/options/options.js'),'utf8');
 const render=source.slice(source.indexOf('async function renderPublicConnection()'),source.indexOf('chrome.storage.onChanged.addListener',source.indexOf('async function renderPublicConnection()')));
 const base={monitorSignals:true,monitorLeadSource:true,monitorDirectX:true};
 const cases=[{settings:{...base,monitorSignals:false}},{settings:{...base,monitorDirectX:false}},
  ...['permission','login','timeout','no-posts','page-unavailable','tab-blocked','unknown'].map(directError=>({settings:base,signalSnapshot:{leadStatus:{directError}}})),
  {settings:base,signalSnapshot:{leadStatus:{directOk:true}}},
  {settings:base,signalSnapshot:{leadStatus:{directOk:true,latestPostAt:Date.now(),directScan:{posts:12,conversations:3,truncated:2,contextPending:2,conversationFailures:1,
   timelines:[{author:'thsottiaux',kind:'posts',ok:true,posts:12,stopReason:'time-budget'},{author:'reach_vb',kind:'replies',ok:false,error:'timeout',stage:'reading'}]}}}}];
 for(const value of ['en-US','en-GB','ja-JP','zh-CN','fr-FR','es-ES','it-IT']) {
  const a=locale({value});await a.i18n.ready;
  for(const file of ['settings','time','signals']) vm.runInContext(fs.readFileSync(require.resolve('../src/core/'+file),'utf8'),a.context);
  const status={textContent:''};a.context.control=()=>status;
  a.context.msg=(...args)=>a.i18n.t(...args);
  vm.runInContext(render,a.context);
  for(const data of cases) {
   a.context.chrome.storage.local.get=async()=>data;
   await a.context.renderPublicConnection();
   assert.doesNotMatch(a.copy.translate(status.textContent),/[가-힣]/,value+': '+status.textContent);
  }
  const html=fs.readFileSync(require.resolve('../src/options/options.html'),'utf8');
  const resumeHelp=html.match(/<strong>놓친 공개 소식 복귀 알림<\/strong><small>([^<]+)<\/small>/)[1];
  assert.doesNotMatch(a.copy.translate(resumeHelp),/[가-힣]/,value+': resume help');
  assert.doesNotMatch(a.copy.translate('리셋 예고·완료·리셋권 공지 알림'),/[가-힣]/,value+': reset alert label');
 }
});

test('notification diagnostics use the selected country time and translate delivery and queue status',async()=>{
 const source=fs.readFileSync(require.resolve('../src/options/notification-test.js'),'utf8');
 const at=Date.parse('2026-10-04T01:15:00Z');
 for(const value of ['en-US','en-GB','ja-JP','zh-CN','fr-FR','es-ES','it-IT']) {
  const a=locale({value});await a.i18n.ready;
  vm.runInContext(fs.readFileSync(require.resolve('../src/core/time'),'utf8'),a.context);
  const elements=Object.fromEntries(['testNotification','notificationTestStatus','notificationWorkerStatus'].map(id=>[id,{textContent:'',addEventListener(){}}]));
  a.context.document={getElementById:id=>elements[id]};
  a.context.setTimeout=setTimeout;a.context.clearTimeout=clearTimeout;
  a.context.chrome.runtime={sendMessage:async()=>({ok:true,version:require('../manifest.json').version,
   permission:'granted',hintAlerts:false,pending:0,quiet:false,resumeReadyAt:Date.now()+60000,realDelivery:{status:'accepted',at},
   publicAlerts:{pending:0,handled:3,expired:7,disabled:2,eligible:0}})};
  vm.runInContext(source,a.context);
  await new Promise(resolve=>setImmediate(resolve));
  const text=elements.notificationWorkerStatus.textContent;
  if(value==='en-US') { assert.match(text,/10\/3/);assert.match(text,/9:15 PM/); }
  assert.doesNotMatch(a.copy.translate(text),/[가-힣]/,value+': '+text);
  for(const match of source.matchAll(/"([^"\r\n]*[가-힣][^"\r\n]*)"/g))
   assert.doesNotMatch(a.copy.translate(match[1]),/[가-힣]/,value+': '+match[1]);
 }
});
