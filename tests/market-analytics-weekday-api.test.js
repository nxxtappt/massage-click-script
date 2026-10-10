'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const Module=require('node:module');
const {localClock,addDays}=require('../marketAnalytics/core');
let source=[],forward=[],log=[],released=false;
const client={query:async(sql,params)=>{log.push({sql,params});if(sql.startsWith('SELECT'))return {rows:params[2].includes('forward')?forward:source};return {rows:[]};},release(){released=true;}};
const oldLoad=Module._load;
Module._load=function(name,parent,isMain){if(name==='./service'&&parent?.filename.endsWith('weekdayReports.js'))return {getPool:()=>({connect:async()=>client})};return oldLoad.call(this,name,parent,isMain);};
const reports=require('../marketAnalytics/weekdayReports');Module._load=oldLoad;
function row(date,n,kind='backfill'){return {kind,snapshot_date:date,appointment_date:date,status:'complete',city:'austin',state:'tx',industry:'massage',total_cards:String(n)};}
test('request validation rejects invalid weekday, source, baseline and oversized ranges',()=>{
 assert.throws(()=>reports.validate({weekday:7}));assert.throws(()=>reports.validate({historySource:'all'}));assert.throws(()=>reports.validate({historyWeeks:'1000'}));assert.throws(()=>reports.validate({from:'2025-01-01',to:'2026-10-10'}));
});
test('history endpoint returns one source per day and filters the requested weekday',async()=>{
 const today=localClock().date,date=addDays(today,-8);source=[row(date,100),row(date,30,'daily')];log=[];released=false;
 const result=await reports.explore({kind:'history',from:addDays(today,-30),to:addDays(today,-1)});
 assert.equal(result.rows.length,1);assert.equal(result.rows[0].total_cards,'30');assert.equal(result.weekdaySummary.length,1);
 assert.ok(log[0].sql.includes('READ ONLY'));assert.equal(log.at(-1).sql,'COMMIT');assert.ok(released);
 const filtered=await reports.explore({kind:'history',from:addDays(today,-30),to:addDays(today,-1),weekday:String((result.rows[0].weekday_index+1)%7)});assert.equal(filtered.rows.length,0);assert.equal(filtered.weekdaySummary.length,1);
});
test('future endpoint returns per-date comparisons and parameterized filters without writing analytics',async()=>{
 const today=localClock().date,target=addDays(today,1),previous=addDays(target,-7);
 source=[row(previous,100)];forward=[row(target,50,'forward')];forward[0].snapshot_date=today;log=[];
 const result=await reports.explore({kind:'forward',from:target,to:addDays(today,2),city:'austin',industry:'massage'});
 assert.equal(result.comparisons[0].historical_average,100);assert.equal(result.comparisons[0].previous_weekday_cards,100);
 assert.ok(log.filter(q=>q.sql.startsWith('SELECT')).every(q=>q.params[3]==='austin'&&q.params[4]==='massage'));
 assert.ok(log.every(q=>!/^\s*(INSERT|UPDATE|DELETE|ALTER|DROP|TRUNCATE)/i.test(q.sql)));
});
test('oversized report rolls back rather than returning a truncated baseline',async()=>{
 source=Array.from({length:20001},()=>row('2026-10-01',1));log=[];released=false;
 await assert.rejects(()=>reports.explore({kind:'history',from:'2026-10-01',to:'2026-10-09'}),/Report too large/);
 assert.equal(log.at(-1).sql,'ROLLBACK');assert.ok(released);
});
