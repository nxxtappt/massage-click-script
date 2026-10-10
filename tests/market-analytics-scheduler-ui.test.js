'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const {EventEmitter}=require('node:events');
const {createCompanion}=require('../marketAnalytics/schedulerCompanion');
const view=require('../public/market-analytics-view');
function harness(){
 const children=[],timers=[];
 const c=createCompanion({fork:(file,args,options)=>{const child=new EventEmitter();child.kill=signal=>{child.signal=signal;};children.push({child,file,args,options});return child;},
  setTimeout:(fn,delay)=>{const t={fn,delay,unref(){}};timers.push(t);return t;},clearTimeout:t=>{t.cancelled=true;},logger:{log(){},error(){}}});
 return {c,children,timers};
}
test('analytics starts once as an isolated child in existing service',()=>{
 const {c,children}=harness();c.start();c.start();assert.equal(children.length,1);assert.deepEqual(children[0].args,['worker']);assert.equal(children[0].options.env.MARKET_ANALYTICS_HOST,'existing-scheduler');assert.ok(children[0].file.endsWith('scripts/market-analytics.js'));c.stop();assert.equal(children[0].child.signal,'SIGTERM');
});
test('child failure restarts analytics without throwing into scheduler',()=>{
 const {c,children,timers}=harness();c.start();children[0].child.emit('error',new Error('DB unavailable'));children[0].child.emit('exit',1);children[0].child.emit('close',1);
 assert.equal(timers.length,1);assert.equal(timers[0].delay,5000);timers[0].fn();assert.equal(children.length,2);c.stop();
});
test('shutdown cancels restarts and bounds child stop',()=>{
 const {c,children,timers}=harness();c.start();children[0].child.emit('exit',1);c.stop();assert.ok(timers[0].cancelled);timers[0].fn();assert.equal(children.length,1);
 const h=harness();h.c.start();h.c.stop();assert.equal(h.children[0].child.signal,'SIGTERM');h.timers[0].fn();assert.equal(h.children[0].child.signal,'SIGKILL');h.children[0].child.emit('exit',0);assert.equal(h.children.length,1);
});
test('launch failure schedules retry without rejecting scheduler startup',()=>{
 let retries=0;const c=createCompanion({fork(){throw Error('missing runtime');},setTimeout:()=>{retries++;return {unref(){}};},clearTimeout(){},logger:{log(){},error(){}}});assert.doesNotThrow(()=>c.start());assert.equal(retries,1);c.stop();
});
function row(data){return {kind:'forward',snapshot_date:'2026-10-09',appointment_date:'2026-10-10',city:'austin',state:'tx',industry:'massage',total_cards:'12',two_day_total:'27',confirmed_cards:'8',inferred_only_cards:'4',unknown_source_cards:'0',status:'complete',...data};}
test('forward totals count both target-date rows only once per market',()=>{
 const result=view.summarize([row({}),row({appointment_date:'2026-10-11',total_cards:'15',confirmed_cards:'10',inferred_only_cards:'5'})],'forward');
 assert.equal(result.total,27);assert.equal(result.markets,1);assert.equal(result.split.confirmed,18);assert.deepEqual(result.trend,[{date:'2026-10-09',total:27}]);
});
test('latest summary sums different markets but not different dates',()=>{
 const result=view.summarize([row({kind:'daily',appointment_date:'2026-10-08',total_cards:'20'}),row({kind:'daily',appointment_date:'2026-10-09',total_cards:'12'}),row({kind:'daily',appointment_date:'2026-10-09',city:'buda',total_cards:'7'}),row({status:'missed',appointment_date:null})],'daily');
 assert.equal(result.total,19);assert.equal(result.markets,2);assert.equal(result.missed,1);assert.equal(result.latestDate,'2026-10-09');
});
test('no retained evidence produces unavailable KPI rather than invented zero',()=>{
 assert.equal(view.summarize([], 'daily').total,null);assert.equal(view.chart([]),null);
 assert.equal(view.summarize([row({status:'missed',appointment_date:null})],'forward').total,null);
});
test('trend preserves missing dates and single observation is centered',()=>{
 const c=view.chart([{date:'2026-10-01',total:10},{date:'2026-10-02',total:5},{date:'2026-10-11',total:12}]);assert.ok(c.points[1].x-c.points[0].x<c.points[2].x-c.points[1].x);
 const single=view.chart([{date:'2026-10-01',total:0}]);assert.ok(Number.isFinite(single.points[0].x));assert.ok(Number.isFinite(single.points[0].y));
});
