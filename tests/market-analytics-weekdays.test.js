'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const {weekday,selectHistory,weekdaySummary,compareFuture}=require('../marketAnalytics/weekdayAnalysis');
const {csv,reportHTML}=require('../marketAnalytics/weekdayExport');
const day=(date,total,kind='backfill',extra={})=>({kind,snapshot_date:date,appointment_date:date,status:'complete',city:'austin',state:'tx',industry:'massage',total_cards:String(total),...extra});
const future=(date,total,capture='2026-10-10',extra={})=>day(date,total,'forward',{snapshot_date:capture,...extra});
test('weekdays are Monday-first and stable across timezone and DST dates',()=>{
 assert.equal(weekday('2026-10-12'),0);assert.equal(weekday('2026-10-11'),6);assert.equal(weekday('2026-11-01'),6);assert.throws(()=>weekday('2026-02-29'));
});
test('merged history prefers daily over backfill without summing overlaps',()=>{
 const r=selectHistory([day('2026-10-05',100),day('2026-10-05',30,'daily'),day('2026-09-28',80)],'2026-10-10');assert.equal(r.length,2);assert.equal(r.find(r=>r.appointment_date==='2026-10-05').total_cards,'30');
 assert.equal(weekdaySummary(r)[0].average_cards,55);assert.equal(weekdaySummary(r)[0].sample_days,2);
 assert.equal(weekdaySummary(r)[0].scheduled_days,1);assert.equal(weekdaySummary(r)[0].reconstructed_days,1);
});
test('completed daily capture with absent market evidence suppresses same-date reconstruction',()=>{
 const r=selectHistory([day('2026-10-05',100),day('2026-10-05',null,'daily',{appointment_date:null,city:null,industry:null})],'2026-10-10');assert.deepEqual(r,[]);
});
test('missed daily capture allows reconstruction fallback; partial today is excluded',()=>{
 const r=selectHistory([day('2026-10-05',100),day('2026-10-05',0,'daily',{status:'missed'}),day('2026-10-10',200)],'2026-10-10');assert.equal(r.length,1);assert.equal(r[0].history_source,'Reconstructed');
});
test('Monday future compares only Mondays in the same market and the exact prior Monday',()=>{
 const history=[day('2026-09-28',100),day('2026-10-05',60,'daily'),day('2026-10-06',999),day('2026-10-05',999,'daily',{city:'buda'}),day('2026-10-05',999,'daily',{industry:'hair'}),day('2026-10-05',999,'daily',{state:'mn'})];
 const [r]=compareFuture([future('2026-10-12',40)],history,{asOf:'2026-10-10',historyWeeks:12,historySource:'merged'});
 assert.equal(r.weekday,'Monday');assert.equal(r.historical_average,80);assert.equal(r.historical_sample_days,2);assert.equal(r.previous_weekday_date,'2026-10-05');assert.equal(r.previous_weekday_cards,60);assert.equal(r.difference_from_average,-40);assert.equal(r.percent_vs_average,-50);assert.equal(r.scheduled_sample_days,1);assert.equal(r.reconstructed_sample_days,1);
});
test('averages exclude missing dates and percentage is unavailable for zero baseline',()=>{
 const [r]=compareFuture([future('2026-10-12',40)],[day('2026-10-05',0)],{asOf:'2026-10-10',historyWeeks:12,historySource:'merged'});assert.equal(r.historical_sample_days,1);assert.equal(r.historical_average,0);assert.equal(r.percent_vs_average,null);assert.equal(r.percent_vs_previous,null);
 const [missing]=compareFuture([future('2026-10-12',40)],[],{asOf:'2026-10-10',historyWeeks:12,historySource:'merged'});assert.equal(missing.historical_average,null);assert.equal(missing.previous_weekday_cards,null);
});
test('previous weekday is not silently replaced by the latest available older weekday',()=>{
 const [r]=compareFuture([future('2026-10-12',40)],[day('2026-09-28',100)],{asOf:'2026-10-10',historyWeeks:12,historySource:'merged'});assert.equal(r.historical_average,100);assert.equal(r.previous_weekday_cards,null);
});
test('archived forecasts never use observations after their capture date',()=>{
 const [r]=compareFuture([future('2026-10-05',40,'2026-10-03')],[day('2026-09-28',50),day('2026-10-05',999)],{asOf:'2026-10-10',historyWeeks:12,historySource:'merged'});assert.equal(r.historical_average,50);assert.equal(r.baseline_through,'2026-10-02');
});
test('latest capture per target date is used; requested baseline length and source are honored',()=>{
 const rows=[future('2026-10-12',40,'2026-10-10'),future('2026-10-12',25,'2026-10-11')];
 const [r]=compareFuture(rows,[day('2026-08-31',200,'daily'),day('2026-10-05',60,'daily'),day('2026-09-28',100)],{asOf:'2026-10-11',historyWeeks:4,historySource:'daily'});assert.equal(r.total_cards,'25');assert.equal(r.historical_sample_days,1);assert.equal(r.historical_average,60);assert.equal(r.reconstructed_sample_days,0);
});
test('downloads contain weekday summaries and comparisons, escape text, preserve numeric negative differences',()=>{
 const d={definitionVersion:2,timezone:'America/Chicago',filters:{kind:'forward',from:'2026-10-11',to:'2026-10-12',weekday:'0',historyWeeks:12,historySource:'merged'},rows:[{city:'=HYPERLINK("evil")',industry:'<script>',difference_from_average:-5,percent_vs_average:-20}],weekdaySummary:[],caveat:'Sources differ'};
 const c=csv(d);assert.ok(c.includes('historical_average'));assert.ok(c.includes(',-5,-20,'));assert.ok(c.includes("'=HYPERLINK"));assert.ok(!reportHTML(d).includes('<script>'));assert.ok(reportHTML(d).includes('&lt;script&gt;'));
});
