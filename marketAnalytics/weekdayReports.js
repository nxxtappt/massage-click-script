'use strict';
const {getPool}=require('./service');
const {localClock,dateKey,addDays,TIMEZONE}=require('./core');
const {selectHistory,weekdaySummary,compareFuture}=require('./weekdayAnalysis');
function validate(input={}){
 const today=localClock().date,kind=input.kind||'history';
 if(!['history','forward'].includes(kind))throw Error('Invalid measurement.');
 const from=dateKey(input.from||addDays(today,kind==='forward'?1:-84));
 const to=dateKey(input.to||addDays(today,kind==='forward'?2:-1));
 if(from>to||Date.parse(to)-Date.parse(from)>366*86400000)throw Error('Choose a date range up to 366 days.');
 const weekday=String(input.weekday??'all');if(!['all','0','1','2','3','4','5','6'].includes(weekday))throw Error('Invalid weekday.');
 const historyWeeks=Number(input.historyWeeks||12);if(![4,8,12,26,52].includes(historyWeeks))throw Error('Invalid history window.');
 const historySource=input.historySource||'merged';if(!['merged','daily','backfill'].includes(historySource))throw Error('Invalid history source.');
 return {from,to,kind,weekday,historyWeeks,historySource,city:String(input.city||'').slice(0,160).toLowerCase(),industry:String(input.industry||'').slice(0,160).toLowerCase()};
}
async function readRows(client,from,to,kinds,filters){
 const r=await client.query(`SELECT r.kind,r.snapshot_date::text,r.captured_at,r.status,r.timezone,r.note,
  t.appointment_date::text,t.city,t.state,t.industry,t.confirmed_cards::text,t.inferred_only_cards::text,
  t.unknown_source_cards::text,t.total_cards::text,t.businesses_with_cards::text,t.raw_rows::text,
  CASE WHEN r.kind='forward' THEN (SELECT sum(x.total_cards)::text FROM market_analytics_totals x
   WHERE x.run_id=r.id AND x.city=t.city AND x.state=t.state AND x.industry=t.industry) END AS two_day_total
 FROM market_analytics_runs r LEFT JOIN market_analytics_totals t ON t.run_id=r.id
  AND ($4='' OR t.city=$4) AND ($5='' OR t.industry=$5)
 WHERE r.kind=ANY($3::text[]) AND coalesce(t.appointment_date,r.snapshot_date) BETWEEN $1::date AND $2::date
 ORDER BY r.snapshot_date,r.kind,t.appointment_date,t.city,t.state,t.industry LIMIT 20001`,[from,to,kinds,filters.city,filters.industry]);
 if(r.rows.length>20000)throw Error('Report too large. Narrow the date or market filters.');
 return r.rows;
}
async function explore(input={}){
 const filters=validate(input),asOf=localClock().date;
 const client=await getPool().connect();
 try{
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  await client.query("SET LOCAL statement_timeout='30s'");
  let rows,summary=[],comparisons=[];
  if(filters.kind==='history'){
   const raw=await readRows(client,filters.from,filters.to,['daily','backfill'],filters);
   rows=selectHistory(raw,asOf,filters.historySource);
   summary=weekdaySummary(rows);
   if(filters.weekday!=='all')rows=rows.filter(r=>r.weekday_index===Number(filters.weekday));
  }else{
   rows=(await readRows(client,filters.from,filters.to,['forward'],filters)).filter(r=>r.appointment_date&&r.city&&r.status==='complete');
   // Average only earlier observations. An archived forward snapshot never sees later history.
   const earliest=rows.reduce((d,r)=>r.snapshot_date<d?r.snapshot_date:d,asOf);
   const historyFrom=addDays(earliest,-filters.historyWeeks*7);
   const raw=await readRows(client,historyFrom,addDays(asOf,-1),['daily','backfill'],filters);
   comparisons=compareFuture(rows,raw,{asOf,historyWeeks:filters.historyWeeks,historySource:filters.historySource});
   if(filters.weekday!=='all')comparisons=comparisons.filter(r=>r.weekday_index===Number(filters.weekday));
   rows=comparisons;
  }
  await client.query('COMMIT');
  return {definitionVersion:2,timezone:TIMEZONE,filters,rows,weekdaySummary:summary,comparisons,
   caveat:(filters.historySource==='merged'?'History prefers the completed daily capture for each date; reconstruction fills dates without a completed daily capture. ':filters.historySource==='daily'?'History uses scheduled daily captures only. ':'History uses reconstructed offers only. ')+'Current-day partial history is excluded. Missing market rows are not zero. Averages use measured dates for the same city, state, industry and weekday. Source counts show scheduled vs reconstructed samples; their definitions and collection times differ.'};
 }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
}
module.exports={explore,validate,readRows};
