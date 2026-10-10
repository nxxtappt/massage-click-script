const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs');
const vm=require('vm');
const path=require('path');
function load(name,stubs={}) {
  if(name==='businessInterestAlerts.js')stubs={'./businessAuthManager':{findVerifiedClaimForBusiness:()=>null},...stubs};
  const module={exports:{}};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'..',name),'utf8'),{module,exports:module.exports,require:n=>n in stubs?stubs[n]:require(n),console,process,setTimeout,setInterval,setImmediate:()=>{},Date,Intl,Buffer},{filename:name});
  return module.exports;
}
const business={businessId:'studio-public-id',businessName:'Studio',claimed:true,plan:'premium',subscriptionStatus:'active',ownerEmail:'owner@example.com',services:[{businessServiceId:9,serviceName:'Deep Tissue',durationMinutes:60,platformServiceId:'42',categorySlug:'massage'}]};
function fixture({duplicate=false,failQueue=false}={}) {
  const calls=[];
  const client={release(){calls.push(['release']);},async query(sql,params){calls.push([sql,params]);if(sql.startsWith('SELECT id FROM'))return {rows:duplicate?[{id:22}]:[]};if(sql.startsWith('INSERT INTO appointment_alerts'))return {rows:[{id:23}]};if(failQueue && sql.startsWith('INSERT INTO business_interest'))throw new Error('queue failed');return {rows:[]};}};
  const api=load('businessInterestAlerts.js',{'./db':{connect:async()=>client,query:async()=>({rows:[{id:7}]})},'./businessManager':{getBusinessBySlug:async()=>business},resend:{Resend:class{}}});
  return {api,calls};
}
const input={shareContact:true,phone:'(512) 555-1234',businessSlug:'studio',businessServiceId:9,targetDate:'2099-10-10',startTime:'09:00',endTime:'17:00'};
test('validates calendar dates and local time windows',()=>{
 const {api}=fixture();
 for(const patch of [{targetDate:'2099-02-30'},{startTime:'25:00'},{startTime:'18:00'},{targetDate:'2000-01-01'}]) assert.throws(()=>api.validateWindow({...input,...patch}));
 assert.doesNotThrow(()=>api.validateWindow(input));
 assert.throws(()=>api.validateWindow({...input,targetDate:'2026-10-10',startTime:'09:00',endTime:'10:00'},'America/Chicago',new Date('2026-10-10T20:00:00Z')));
});
test('enforces premium eligibility',()=>{
 const {api}=fixture();assert.equal(api.hasPremium(business),true);
 assert.equal(api.hasPremium({...business,plan:'premium_intel'}),true);
 assert.equal(api.hasPremium({...business,subscriptionStatus:'canceled'}),false);
 assert.equal(api.hasPremium({...business,plan:'verified_free'}),false);
});
test('atomically saves scoped alert and durable owner notification',async()=>{
 const {api,calls}=fixture();const result=await api.createBusinessAlert({id:3,email:'consumer@example.com'},input);assert.equal(result.id,23);
 const alert=calls.find(c=>c[0].startsWith('INSERT INTO appointment_alerts'));
 assert.equal(alert[1][2],7);const filters=JSON.parse(alert[1][9]);assert.equal(filters.serviceName,'Deep Tissue');assert.equal(filters.platformServiceId,'42');assert.equal(filters.publicBusinessId,'studio-public-id');
 assert.ok(calls.some(c=>c[0]==='COMMIT'));assert.ok(calls.some(c=>c[0].startsWith('INSERT INTO business_interest')));
});
test('duplicate submit returns existing alert without second email',async()=>{
 const {api,calls}=fixture({duplicate:true});assert.equal((await api.createBusinessAlert({id:3,email:'consumer@example.com'},input)).duplicate,true);
 assert.equal(calls.some(c=>c[0].startsWith('INSERT')),false);
});
test('queue failure rolls back consumer alert',async()=>{
 const {api,calls}=fixture({failQueue:true});await assert.rejects(api.createBusinessAlert({id:3,email:'consumer@example.com'},input),/queue failed/);
 assert.ok(calls.some(c=>c[0]==='ROLLBACK'));assert.ok(!calls.some(c=>c[0]==='COMMIT'));
});
test('rejects unknown and disabled services',async()=>{
 const {api}=fixture();await assert.rejects(api.createBusinessAlert({id:3,email:'consumer@example.com'},{...input,businessServiceId:999}),/Choose a service/);
});
const matcher=load('userAlertMatcher.js',{'./inventoryManager':{},'./marketplaceMetros':{matchesMarketplaceMetro:()=>true,getMarketplaceTimeZone:()=> 'America/Chicago'},'./database/userAlertRepository':{},'./emailManager':{}});
const alert={businessId:7,businessName:'Studio',durationMinutes:60,targetDate:'2099-10-10',startTime:'09:00',endTime:'17:00',filters:{source:'business_page',serviceName:'Deep Tissue',platformServiceId:'42'}};
const appointment={businessId:7,businessName:'Studio',serviceName:'Deep Tissue',platformServiceId:'42',durationMinutes:60,localDateKey:'2099-10-10',localTimeKey:'12:00'};
test('matches selected business, exact service and date/time bounds',()=>{
 assert.equal(matcher.appointmentMatchesAlert(alert,appointment),true);
 for(const patch of [{businessId:8},{platformServiceId:'99'},{durationMinutes:30},{localDateKey:'2099-10-11'},{localTimeKey:'18:00'}])assert.equal(matcher.appointmentMatchesAlert(alert,{...appointment,...patch}),false);
 assert.equal(matcher.appointmentMatchesAlert(alert,{...appointment,platformServiceId:'',serviceName:'Swedish'}),false);
 assert.equal(matcher.appointmentMatchesAlert(alert,{...appointment,businessId:null,businessName:'Other'}),false);
});
test('ordinary search matching remains broad',()=>{
 assert.equal(matcher.appointmentMatchesAlert({serviceType:'massage'}, {...appointment,serviceName:'Swedish Massage'}),true);
});
test('appointment markup includes escaped tracking payload',()=>{
 const listeners={};const context={console,URL,URLSearchParams,Intl,Date,navigator:{},window:{location:{pathname:'/business/studio'}},document:{getElementById:()=>null,addEventListener:(n,f)=>listeners[n]=f},fetch:()=>new Promise(()=>{})};
 vm.createContext(context);vm.runInContext(fs.readFileSync(path.join(__dirname,'../public/business-page.js'),'utf8'),context);
 const html=vm.runInContext(`renderBusinessAvailabilityTimeGroups([${JSON.stringify({...appointment,bookingUrl:'https://example.com/book'})}])`,context);
 assert.match(html,/data-track-appointment-click="true"/);assert.match(html,/business_page/);assert.match(html,/&quot;businessName&quot;/);
 const box=vm.runInContext(`renderBusinessAlertBox(${JSON.stringify({...business,services:[...business.services,{businessServiceId:10,serviceName:'Disabled',enabled:false}]})})`,context);
 assert.match(box,/Deep Tissue/);assert.doesNotMatch(box,/Disabled/);
});
test('email outbox marks sent only after provider success and retries errors',async()=>{
 for(const failed of [false,true]){
  const calls=[];const client={release(){},async query(sql,params){calls.push([sql,params]);if(sql.startsWith('SELECT pg_try'))return {rows:[{locked:true}]};if(sql.startsWith('SELECT n.*'))return {rows:[{id:1,currentOwnerEmail:'owner@example.com',owner_email:'owner@example.com',details:{serviceName:'Massage',businessName:'Studio',targetDate:'2099-10-10',startTime:'09:00',endTime:'17:00',timezone:'America/Chicago'}}]};return {rows:[]};}};
  const api=load('businessInterestAlerts.js',{'./db':{connect:async()=>client},'./businessManager':{},resend:{Resend:class{constructor(){this.emails={send:async()=>failed?{error:{message:'temporary failure'}}:{data:{id:'sent'}}};}}}});
  const old=process.env.RESEND_API_KEY;process.env.RESEND_API_KEY='test';
  try{await api.deliverBusinessInterests();}finally{if(old===undefined)delete process.env.RESEND_API_KEY;else process.env.RESEND_API_KEY=old;}
  assert.equal(calls.some(c=>c[0].includes('SET email_sent_at=NOW()')),!failed);
  assert.equal(calls.some(c=>c[0].includes('attempts=attempts+1')),failed);
  assert.ok(calls.some(c=>c[0].includes('pg_advisory_unlock')));
 }
});
test('requires contact-sharing consent and ignores forged consumer email',async()=>{
 const {api,calls}=fixture();
 await assert.rejects(api.createBusinessAlert({id:3,email:'real@example.com'},{...input,shareContact:false}),/agree to share/);
 await assert.rejects(api.createBusinessAlert({id:3,email:'real@example.com'},{...input,phone:'not a number'}),/phone number/);
 await api.createBusinessAlert({id:3,email:'real@example.com'},{...input,email:'forged@example.com'});
 const detail=JSON.parse(calls.find(c=>c[0].startsWith('INSERT INTO business_interest'))[1][3]);
 assert.equal(detail.contactEmail,'real@example.com');assert.equal(detail.contactPhone,'(512) 555-1234');assert.equal(detail.contactConsent,true);
});
test('owner recipient falls back to verified business claim when stored owner address is invalid',()=>{
 const api=load('businessInterestAlerts.js',{'./db':{},'./businessManager':{},'./businessAuthManager':{findVerifiedClaimForBusiness:()=>({email:'verified@example.com'})},resend:{Resend:class{}}});
 assert.equal(api.resolveOwnerEmail({ownerEmail:' ',claimedByEmail:'invalid'}),'verified@example.com');
 assert.equal(api.resolveOwnerEmail({ownerEmail:'OWNER@example.com'}),'owner@example.com');
});
test('missing original recipient recovers and owner email contains login link without consumer details',async()=>{
 const calls=[];let email;
 const client={release(){},async query(sql,params){calls.push([sql,params]);if(sql.startsWith('SELECT pg_try'))return {rows:[{locked:true}]};
  if(sql.startsWith('SELECT n.*'))return {rows:[{id:44,owner_email:null,publicBusinessId:'studio',businessName:'Studio',details:{contactEmail:'consumer@example.com',contactPhone:'5125551234',serviceName:'Private service',contactRevision:'revision'}}]};return {rows:[]};}};
 const api=load('businessInterestAlerts.js',{'./db':{connect:async()=>client},'./businessManager':{},'./businessAuthManager':{findVerifiedClaimForBusiness:()=>({email:'verified@example.com'})},resend:{Resend:class{constructor(){this.emails={send:async(msg)=>{email=msg;return {data:{id:'accepted'}};}};}}}});
 const old=process.env.RESEND_API_KEY;process.env.RESEND_API_KEY='test';
 try {const summary=await api.deliverBusinessInterests();assert.equal(summary.sent,1);} finally{if(old===undefined)delete process.env.RESEND_API_KEY;else process.env.RESEND_API_KEY=old;}
 assert.equal(email.to[0],'verified@example.com');assert.match(email.html,/href="https:\/\/nextappt.ai\/business-dashboard#business-interests"/);
 for(const text of [email.html,email.text]){assert.doesNotMatch(text,/consumer@example.com|5125551234|Private service/);}
 assert.ok(calls.some(c=>c[0].includes('owner_email=$2')&&c[1][1]==='verified@example.com'));
});
test('time opens service selection and only selected service links contain analytics payloads',()=>{
 const context={console,URL,URLSearchParams,Intl,Date,navigator:{},window:{location:{pathname:'/business/studio'}},document:{getElementById:()=>null,addEventListener:()=>{}},fetch:()=>new Promise(()=>{})};
 vm.createContext(context);vm.runInContext(fs.readFileSync(path.join(__dirname,'../public/business-page.js'),'utf8'),context);
 const rows=[{...appointment,bookingUrl:'https://example.com/deep'},{...appointment,serviceName:'Swedish',platformServiceId:'43',bookingUrl:'https://example.com/swedish'}];
 const html=vm.runInContext(`renderBusinessAvailabilityTimeGroups(${JSON.stringify(rows)})`,context);
 const trigger=html.match(/<button[^>]+>[\s\S]*?<\/button>/)[0];assert.doesNotMatch(trigger,/data-track-appointment-click|href=/);
 const encoded=[...html.matchAll(/data-appointment-payload="([^"]+)"/g)].map(m=>JSON.parse(m[1].replaceAll('&quot;','"').replaceAll('&#039;',"'").replaceAll('&amp;','&')));
 assert.equal(encoded.length,2);assert.equal(encoded[0].serviceName,'Deep Tissue');assert.equal(encoded[0].bookingUrl,'https://example.com/deep');
 assert.equal(encoded[1].serviceName,'Swedish');assert.equal(encoded[1].bookingUrl,'https://example.com/swedish');
 const box=vm.runInContext(`renderBusinessAlertBox(${JSON.stringify(business)})`,context);
 assert.match(box,/<select id="businessAlertService">/);assert.doesNotMatch(box,/data-business-alert-service/);
});
test('verified business claim fallback rejects ambiguous claim owners',()=>{
 let claims=[{businessId:'studio',email:'one@example.com',status:'claimed_verified'}];
 const api=load('businessAuthManager.js',{fs:{existsSync:()=>true,readFileSync:()=>JSON.stringify(claims)},'./storagePaths':{storagePath:()=>'/test/claims',writeJsonAtomic:()=>{}}});
 assert.equal(api.findVerifiedClaimForBusiness({businessId:'studio'}).email,'one@example.com');
 claims.push({businessId:'studio',email:'two@example.com',status:'claimed_verified'});
 assert.equal(api.findVerifiedClaimForBusiness({businessId:'studio'}),null);
});
test('search Premium cards preserve duration variants and track only chosen service',()=>{
 const context={console,URL,Intl,Date,window:{location:{pathname:'/austin/massage',origin:'https://nextappt.ai'}},currentPageContext:{metroTimezone:'America/Chicago'},
  compareSearchAppointments:()=>0,getPublicInventoryLimit:()=>4,formatTimeButtonText:()=> '10:00 AM',escapeHtml:v=>String(v??'').replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;'),escapeAttribute:v=>String(v??'').replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;')};
 const source=fs.readFileSync(path.join(__dirname,'../public/app.js'),'utf8');
 vm.createContext(context);
 const start=source.indexOf('function getAppointmentDateGroupKey('),end=source.indexOf('function bindPremiumTimeToggles(');
 vm.runInContext(source.slice(start,end),context);
 const rows=[{...appointment,serviceName:'Massage',durationMinutes:60,bookingUrl:'https://example.com/60'},
  {...appointment,serviceName:'Massage',durationMinutes:90,platformServiceId:'90',bookingUrl:'https://example.com/90'}];
 const html=vm.runInContext(`renderPremiumAvailabilityGroups(${JSON.stringify(rows)},'Studio','https://example.com/book','card')`,context);
 const time=html.match(/<button[^>]+>[\s\S]*?<\/button>/)[0];assert.doesNotMatch(time,/data-track-appointment-click/);
 const payloads=[...html.matchAll(/data-appointment-payload="([^"]+)"/g)].map(m=>JSON.parse(m[1].replaceAll('&quot;','"').replaceAll('&amp;','&')));
 assert.equal(payloads.length,2);assert.equal(payloads[0].durationMinutes,60);assert.equal(payloads[1].durationMinutes,90);assert.equal(payloads[1].bookingUrl,'https://example.com/90');
 assert.match(html,/Massage · 60 min/);assert.match(html,/Massage · 90 min/);
 assert.equal(vm.runInContext(`premiumServiceChoiceLabel({name:'60 Minute Massage',appointment:{durationMinutes:60}})`,context),'60 Minute Massage');
});
