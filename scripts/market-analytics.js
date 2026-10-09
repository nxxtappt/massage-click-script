#!/usr/bin/env node
'use strict';
require('dotenv').config();
const fs=require('fs');
const path=require('path');
const service=require('../marketAnalytics/service');
const {TIMEZONE,localClock,addDays,due}=require('../marketAnalytics/core');
const args=process.argv.slice(2);
let stopping=false;
async function tick(now=new Date()){
 const c=localClock(now,TIMEZONE);
 // A restart cannot turn current inventory into yesterday's snapshot.
 // Record missed schedules since the latest saved run, without manufacturing totals.
 const last=await service.getPool().query(`SELECT max(snapshot_date)::text AS day FROM market_analytics_runs WHERE kind IN ('daily','forward')`);
 const start=last.rows[0].day||c.date;
 for(let d=start;d<=c.date;d=addDays(d,1)){
  for(const [kind,hour] of [['forward',13],['daily',23]]){
   if(d<c.date||c.hour>hour||(c.hour===hour&&c.minute>=15))
    await service.snapshot(kind,d,{status:'missed'});
  }
 }
 for(const s of due(now,TIMEZONE))await service.snapshot(s.kind,s.date);
 await service.heartbeat();
}
async function main(){
 const command=args[0];
 if(command==='migrate'){
  await service.getPool().query(fs.readFileSync(path.join(__dirname,'../marketAnalytics/schema.sql'),'utf8'));
  console.log('Analytics tables ready. Operational tables were not changed.');return;
 }
 if(command==='backfill'){
  const bounds=await service.historyBounds();
  if(!bounds.first_date){console.log('No retained dated history.');return;}
  const today=localClock().date;
  const from=args[1]||bounds.first_date;
  const to=args[2]||today;
  console.log(JSON.stringify({sourceBounds:bounds,from,to,definition:service.notes.backfill}));
  await service.backfill(from,to,p=>console.log(JSON.stringify(p)));return;
 }
 if(command==='once'){await tick();console.log('Schedule checked.');return;}
 if(command==='worker'){
  console.log('Market analytics worker: America/Chicago, 13:00 and 23:00. Poll every 30 seconds.');
  process.on('SIGTERM',()=>{stopping=true;});process.on('SIGINT',()=>{stopping=true;});
  while(!stopping){
   try{await tick();}catch(e){console.error(e.message);await service.heartbeat(e.message.slice(0,500)).catch(()=>{});}
   if(!stopping)await new Promise(resolve=>setTimeout(resolve,30000));
  }
  return;
 }
 throw new Error('Usage: node scripts/market-analytics.js migrate|backfill [FROM TO]|once|worker');
}
if(require.main===module)main().catch(e=>{console.error(e.message);process.exitCode=1;}).finally(()=>service.close());
module.exports={tick};
