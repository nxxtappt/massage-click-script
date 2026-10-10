(function(root,factory){
 if(typeof module==='object'&&module.exports)module.exports=factory();
 else root.MarketAnalyticsView=factory();
})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 const num=v=>Number.isFinite(Number(v))?Number(v):0;
 function validRows(rows){return rows.filter(r=>r.status==='complete'&&r.appointment_date&&r.city&&r.industry);}
 function measures(rows,kind){
  const out=new Map();
  for(const r of validRows(rows)){
   // Combined forward counts repeat on target-date rows; count each market once.
   const key=JSON.stringify([kind==='forward'?r.snapshot_date:r.appointment_date,r.city,r.state,r.industry]);
   if(kind==='forward'){
    if(!out.has(key))out.set(key,{date:r.snapshot_date,city:r.city,state:r.state,industry:r.industry,total:num(r.two_day_total)});
   }else{
    out.set(key,{date:r.appointment_date,city:r.city,state:r.state,industry:r.industry,total:num(r.total_cards)});
   }
  }
  return [...out.values()];
 }
 function summarize(rows,kind){
  const data=measures(rows,kind);
  const trendMap=new Map();
  for(const r of data)trendMap.set(r.date,(trendMap.get(r.date)||0)+r.total);
  const trend=[...trendMap].sort(([a],[b])=>a.localeCompare(b)).map(([date,total])=>({date,total}));
  const latestDate=trend.at(-1)?.date||null;
  const latest=data.filter(r=>r.date===latestDate);
  const source=validRows(rows).filter(r=>(kind==='forward'?r.snapshot_date:r.appointment_date)===latestDate);
  const split={confirmed:0,inferred:0,unknown:0};
  for(const r of source){split.confirmed+=num(r.confirmed_cards);split.inferred+=num(r.inferred_only_cards);split.unknown+=num(r.unknown_source_cards);}
  const markets=[...new Set(latest.map(r=>JSON.stringify([r.city,r.state,r.industry])))].length;
  const missed=new Set(rows.filter(r=>r.status==='missed').map(r=>JSON.stringify([r.kind,r.snapshot_date]))).size;
  return {latestDate,total:trend.at(-1)?.total??null,markets,split,missed,trend,
   topMarkets:latest.sort((a,b)=>b.total-a.total).slice(0,6)};
 }
 function chart(trend){
  if(!trend.length)return null;
  const width=800,height=220,left=52,right=22,top=20,bottom=36;
  const max=Math.max(1,...trend.map(r=>r.total));
  // Time-scaled x axis preserves gaps rather than implying daily observations.
  const dates=trend.map(r=>Date.parse(r.date));const first=dates[0],last=dates.at(-1);
  const points=trend.map((r,i)=>({date:r.date,total:r.total,
   x:Math.round(left+(last===first?(width-left-right)/2:(dates[i]-first)/(last-first)*(width-left-right))),
   y:Math.round(top+(1-r.total/max)*(height-top-bottom))}));
  return {width,height,left,right,top,bottom,max,points};
 }
 return {validRows,measures,summarize,chart};
});
