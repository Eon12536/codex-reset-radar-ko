const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function locale({value='ko-KR',fail=false}={}) {
 const storage={uiLocale:value,settings:{monitorAccount:false,timezoneOverride:'Asia/Seoul'},appearanceTheme:'dark'},events=[];
 const context=vm.createContext({chrome:{storage:{local:{get:async()=>({...storage}),set:async values=>{if(fail)throw Error('storage');Object.assign(storage,values);}},onChanged:{addListener:fn=>events.push(fn)}}}});
 for(const file of ['translations','i18n','ui-copy-locales','ui-copy'])vm.runInContext(fs.readFileSync(require.resolve('../src/core/'+file),'utf8'),context);
 return {i18n:context.RadarI18n,copy:context.RadarUiCopy,storage,events};
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
  if(value!=='ko-KR') for(const text of ['Tibo · VB 리셋 소식','국가 선택','언어를 저장했습니다.','원글·답글 23개 확인'])assert.doesNotMatch(a.copy.translate(text),/[가-힣]/);
 }
});
