'use strict';
const {dateKey,addDays}=require('./core');
const WEEKDAYS=['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
const count=v=>Number.isFinite(Number(v))?Number(v):0;
const marketKey=r=>JSON.stringify([r.city,r.state,r.industry]);
const round=v=>v==null?null:Math.round(v*100)/100;
function weekday(date){return (new Date(dateKey(date)+'T12:00:00Z').getUTCDay()+6)%7;}
function selectHistory(rows,asOf,source='merged'){
 dateKey(asOf);
 const chosen=new Map();
 for(const r of rows){
  const date=r.appointment_date||r.snapshot_date;
  if(r.status!=='complete'||!['daily','backfill'].includes(r.kind)||!date||date>=asOf)continue;
  if(source!=='merged'&&r.kind!==source)continue;
  const previous=chosen.get(date);
  if(!previous||r.kind==='daily')chosen.set(date,r.kind);
 }
 return rows.filter(r=>r.appointment_date&&r.city&&r.industry&&r.status==='complete'&&chosen.get(r.appointment_date)===r.kind)
  .map(r=>({...r,weekday:WEEKDAYS[weekday(r.appointment_date)],weekday_index:weekday(r.appointment_date),history_source:r.kind==='daily'?'Scheduled daily':'Reconstructed'}));
}
function weekdaySummary(rows){
 const groups=new Map();
 for(const r of rows){
  const key=JSON.stringify([marketKey(r),r.weekday_index]);
  if(!groups.has(key))groups.set(key,{city:r.city,state:r.state,industry:r.industry,weekday:r.weekday,weekday_index:r.weekday_index,dates:new Map()});
  groups.get(key).dates.set(r.appointment_date,r);
 }
 return [...groups.values()].map(g=>{
  const dates=[...g.dates.keys()].sort(),values=[...g.dates.values()],sum=values.reduce((n,r)=>n+count(r.total_cards),0);
  return {city:g.city,state:g.state,industry:g.industry,weekday:g.weekday,weekday_index:g.weekday_index,sample_days:values.length,
   average_cards:round(sum/values.length),min_cards:Math.min(...values.map(r=>count(r.total_cards))),max_cards:Math.max(...values.map(r=>count(r.total_cards))),
   latest_date:dates.at(-1),latest_cards:count(g.dates.get(dates.at(-1)).total_cards),
   scheduled_days:values.filter(r=>r.kind==='daily').length,reconstructed_days:values.filter(r=>r.kind==='backfill').length};
 }).sort((a,b)=>a.weekday_index-b.weekday_index||marketKey(a).localeCompare(marketKey(b)));
}
function compareFuture(futureRows,history,options){
 const latest=new Map();
 for(const r of futureRows){
  if(r.status!=='complete'||!r.appointment_date||!r.city||!r.industry)continue;
  const key=JSON.stringify([r.appointment_date,marketKey(r)]),old=latest.get(key);
  if(!old||r.snapshot_date>old.snapshot_date)latest.set(key,r);
 }
 return [...latest.values()].map(r=>{
  const cutoff=r.snapshot_date<options.asOf?r.snapshot_date:options.asOf;
  const from=addDays(cutoff,-options.historyWeeks*7);
  const selected=selectHistory(history,cutoff,options.historySource);
  const sameMarket=selected.filter(h=>marketKey(h)===marketKey(r));
  const samples=sameMarket.filter(h=>h.appointment_date>=from&&weekday(h.appointment_date)===weekday(r.appointment_date));
  const avg=samples.length?samples.reduce((n,h)=>n+count(h.total_cards),0)/samples.length:null;
  const prevDate=addDays(r.appointment_date,-7),previous=sameMarket.find(h=>h.appointment_date===prevDate);
  const total=count(r.total_cards),previousCount=previous?count(previous.total_cards):null;
  return {...r,weekday:WEEKDAYS[weekday(r.appointment_date)],weekday_index:weekday(r.appointment_date),
   historical_average:round(avg),historical_sample_days:samples.length,baseline_from:from,baseline_through:addDays(cutoff,-1),
   scheduled_sample_days:samples.filter(h=>h.kind==='daily').length,reconstructed_sample_days:samples.filter(h=>h.kind==='backfill').length,
   difference_from_average:avg==null?null:round(total-avg),percent_vs_average:avg==null||avg===0?null:round((total-avg)/avg*100),
   previous_weekday_date:prevDate,previous_weekday_cards:previousCount,previous_weekday_source:previous?.history_source||null,
   difference_from_previous:previousCount==null?null:total-previousCount,
   percent_vs_previous:previousCount==null||previousCount===0?null:round((total-previousCount)/previousCount*100),
   comparison_note:'Future supply was measured at 1pm; history is daily 11pm inventory or reconstructed offers. Timing and coverage differ. These are supply comparisons, not measured demand.'};
 }).sort((a,b)=>a.appointment_date.localeCompare(b.appointment_date)||marketKey(a).localeCompare(marketKey(b)));
}
module.exports={WEEKDAYS,weekday,selectHistory,weekdaySummary,compareFuture};
