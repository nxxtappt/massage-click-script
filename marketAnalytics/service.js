'use strict';
const fs=require('fs');
const path=require('path');
const {TIMEZONE,localClock,dateKey,windowFor,addDays}=require('./core');
const aggregateSQL=fs.readFileSync(path.join(__dirname,'aggregate.sql'),'utf8');
// Separate, small pool: analytics never exhausts the site's existing pool.
let pool;
function getPool(){
  if(!pool){const {Pool}=require('pg');pool=new Pool({
    connectionString:process.env.MARKET_ANALYTICS_DATABASE_URL||process.env.DATABASE_URL,
    ssl:process.env.PGSSLMODE==='disable'?false:{rejectUnauthorized:false},
    max:2,connectionTimeoutMillis:10000,idleTimeoutMillis:30000,statement_timeout:120000,
    application_name:'nextappt-market-analytics'});}
  return pool;
}
const notes={
 daily:'11pm snapshot of retained searchable cards dated today. Not bookings, utilization, or all offers ever seen. Inventory deleted by reconciliation cannot be recovered.',
 forward:'1pm snapshot of retained searchable cards for tomorrow and the day after. Low supply alone does not establish demand. No extra scrapes or API calls were made.',
 backfill:'Reconstructed distinct offers from retained inventory plus confirmed/inferred history; includes inactive offers. Not an original 11pm snapshot. Missing/deleted history cannot be recovered. City/industry mapping reflects current metadata.'
};
async function snapshot(kind,date,{status='complete'}={}){
 const range=windowFor(kind,date); const client=await getPool().connect();
 try{
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
  await client.query("SET LOCAL statement_timeout='120s'");
  await client.query("SET LOCAL lock_timeout='3s'");
  // Across all web/worker instances; transaction releases it even after failure.
  const lock=await client.query('SELECT pg_try_advisory_xact_lock(78192341) AS locked');
  if(!lock.rows[0].locked){await client.query('ROLLBACK');return {busy:true};}
  const existing=await client.query('SELECT id FROM market_analytics_runs WHERE kind=$1 AND snapshot_date=$2 AND timezone=$3',[kind,date,TIMEZONE]);
  if(existing.rows.length){await client.query('ROLLBACK');return {exists:true};}
  const run=await client.query(`INSERT INTO market_analytics_runs(kind,snapshot_date,timezone,status,note)
    VALUES($1,$2,$3,$4,$5) RETURNING id`,[kind,date,TIMEZONE,status,status==='missed'?'Scheduled capture missed; no historical point-in-time value fabricated.':notes[kind]]);
  let totals=[];
  if(status==='complete'){
   totals=(await client.query(aggregateSQL,[range.from,range.to,kind==='backfill',kind])).rows;
   for(const t of totals) await client.query(`INSERT INTO market_analytics_totals
     (run_id,appointment_date,city,state,industry,confirmed_cards,inferred_only_cards,unknown_source_cards,total_cards,businesses_with_cards,raw_rows)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,[run.rows[0].id,t.appointment_date,t.city,t.state,t.industry,t.confirmed_cards,t.inferred_only_cards,t.unknown_source_cards,t.total_cards,t.businesses_with_cards,t.raw_rows]);
  }
  await client.query('COMMIT');return {id:run.rows[0].id,groups:totals.length,status};
 }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
}
async function backfill(from,to,onProgress=()=>{}){
 dateKey(from);dateKey(to);
 if(from>to||to>localClock().date)throw new Error('Backfill must end on or before today.');
 for(let date=from;date<=to;date=addDays(date,1)){
  const result=await snapshot('backfill',date);
  if(result.busy)throw new Error('Another analytics run is active. Retry the backfill; completed days are preserved.');
  onProgress({date,...result});
 }
}
async function historyBounds(){
 const r=await getPool().query(`SELECT min(d)::text AS first_date,max(d)::text AS last_date FROM (
 SELECT min(local_date) d FROM appointment_inventory UNION ALL SELECT max(local_date) FROM appointment_inventory
 UNION ALL SELECT min(local_date) FROM confirmed_appointments UNION ALL SELECT max(local_date) FROM confirmed_appointments
 UNION ALL SELECT min(local_date) FROM inferred_appointments UNION ALL SELECT max(local_date) FROM inferred_appointments) s`);
 return r.rows[0];
}
async function report(filters={}){
 const from=dateKey(filters.from||addDays(localClock().date,-30));
 const to=dateKey(filters.to||addDays(localClock().date,2));
 if(from>to||Date.parse(to)-Date.parse(from)>366*86400000)throw new Error('Choose a range up to 366 days.');
 const kind=filters.kind||'all';if(!['all','daily','forward','backfill'].includes(kind))throw new Error('Invalid report type.');
 const values=[from,to,kind,String(filters.city||'').slice(0,160).toLowerCase(),String(filters.industry||'').slice(0,160).toLowerCase()];
 const client=await getPool().connect();
 try {
  await client.query('BEGIN READ ONLY');
  await client.query("SET LOCAL statement_timeout='30s'");
  const r=await client.query(`SELECT r.kind,r.snapshot_date::text,r.captured_at,r.status,r.timezone,r.note,
   t.appointment_date::text,t.city,t.state,t.industry,t.confirmed_cards::text,t.inferred_only_cards::text,
   t.unknown_source_cards::text,t.total_cards::text,t.businesses_with_cards::text,t.raw_rows::text,
   CASE WHEN r.kind='forward' THEN (SELECT sum(x.total_cards)::text FROM market_analytics_totals x
    WHERE x.run_id=r.id AND x.city=t.city AND x.state=t.state AND x.industry=t.industry) END AS two_day_total
   FROM market_analytics_runs r LEFT JOIN market_analytics_totals t ON t.run_id=r.id
   WHERE coalesce(t.appointment_date,r.snapshot_date) BETWEEN $1::date AND $2::date
    AND ($3='all' OR r.kind=$3) AND ($4='' OR t.city=$4) AND ($5='' OR t.industry=$5)
   ORDER BY r.snapshot_date DESC,r.kind,t.appointment_date,t.city,t.industry LIMIT 20001`,values);
  if(r.rows.length>20000)throw new Error('Report too large. Narrow the dates or market filters.');
  await client.query('COMMIT');
  return {definitionVersion:1,timezone:TIMEZONE,filters:{from,to,kind,city:values[3],industry:values[4]},rows:r.rows,
   caveat:'Cards are advertised service options, not independent staff capacity or bookings. Confirmed means observed availability, not a confirmed customer booking. Missing market rows mean no retained evidence, not proven zero. Do not add different snapshot kinds together.'};
 }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
}
async function health(){
 const [runs,state,markets]=await Promise.all([
  getPool().query('SELECT kind,snapshot_date::text,captured_at,status,note FROM market_analytics_runs ORDER BY id DESC LIMIT 20'),
  getPool().query('SELECT * FROM market_analytics_worker_state'),
  getPool().query('SELECT DISTINCT city,state,industry FROM market_analytics_totals ORDER BY city,state,industry LIMIT 3000')]);
 return {timezone:TIMEZONE,runs:runs.rows,workers:state.rows,markets:markets.rows};
}
async function heartbeat(error=null){await getPool().query(`INSERT INTO market_analytics_worker_state(worker_key,heartbeat_at,last_error)
 VALUES('scheduled-worker',now(),$1) ON CONFLICT(worker_key) DO UPDATE SET heartbeat_at=now(),last_error=excluded.last_error`,[error]);}
async function close(){if(pool){await pool.end();pool=null;}}
module.exports={getPool,snapshot,backfill,historyBounds,report,health,heartbeat,close,notes};
