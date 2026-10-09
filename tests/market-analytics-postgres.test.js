'use strict';
// Run against a disposable database: TEST_DATABASE_URL=... node --test tests/market-analytics-postgres.test.js
const test=require('node:test');const assert=require('node:assert/strict');const fs=require('fs');const path=require('path');
test('PostgreSQL aggregate: duplicates, source precedence, location attribution, date bounds and no source writes',
 {skip:!process.env.TEST_DATABASE_URL},async()=>{
 const {Client}=require('pg');const c=new Client({connectionString:process.env.TEST_DATABASE_URL});await c.connect();
 const schema='ma_test_'+process.pid+'_'+Date.now();
 try{
 await c.query(`CREATE SCHEMA ${schema}`);await c.query(`SET search_path TO ${schema}`);
 await c.query(`CREATE TABLE businesses(id bigint,business_name text,raw_json jsonb);
 CREATE TABLE business_services(id bigint,business_id bigint,category_slug text);
 CREATE TABLE business_locations(id bigint,business_id bigint,city text,state text);
 CREATE TABLE appointment_inventory(id bigint,business_service_id bigint,business_name text,platform text,service_name text,
 service_category text,duration_minutes int,provider_name text,booking_url text,local_date date,local_time time,appointment_source text,searchable boolean);
 CREATE TABLE confirmed_appointments(LIKE appointment_inventory);
 CREATE TABLE inferred_appointments(LIKE appointment_inventory);
 INSERT INTO businesses VALUES(1,'Same Name','{}'),(2,'Same Name','{}'),(3,'Multi Location','{}');
 INSERT INTO business_services VALUES(10,1,'massage'),(20,2,'massage'),(30,3,'massage');
 INSERT INTO business_locations VALUES(1,1,'Austin','TX'),(2,2,'Dripping Springs','TX'),(3,3,'Austin','TX'),(4,3,'Buda','TX');
 INSERT INTO appointment_inventory VALUES
 (1,10,'Same Name','mindbody','Massage','massage',60,'Any','https://a','2026-10-13','10:00','confirmed',true),
 (2,10,'Same Name','mindbody','Massage','massage',60,'Any','https://a','2026-10-13','10:00','confirmed',true),
 (3,10,'Same Name','mindbody','Massage','massage',60,'Any','https://a','2026-10-13','10:00','inferred',true),
 (4,20,'Same Name','mindbody','Massage','massage',60,'Any','https://b','2026-10-14','10:00','inferred',true),
 (5,10,'Same Name','mindbody','Massage','massage',60,'Any','https://a','2026-10-12','10:00','confirmed',true),
 (6,30,'Multi Location','mindbody','Massage','massage',60,'Any','https://c','2026-10-13','11:00','confirmed',true),
 (7,10,'Same Name','mindbody','Massage','massage',60,'Any','https://a','2026-10-13','12:00','confirmed',false);
 INSERT INTO confirmed_appointments SELECT * FROM appointment_inventory WHERE id=1;`);
 const sql=fs.readFileSync(path.join(__dirname,'../marketAnalytics/aggregate.sql'),'utf8');
 const before=await c.query('SELECT jsonb_agg(to_jsonb(a) ORDER BY id) AS rows FROM appointment_inventory a');
 const r=await c.query(sql,['2026-10-13','2026-10-14',false,'forward']);
 const a=r.rows.find(x=>x.city==='austin');assert.equal(a.total_cards,'1');assert.equal(a.confirmed_cards,'1');assert.equal(a.inferred_only_cards,'0');assert.equal(a.raw_rows,'3');
 assert.equal(r.rows.find(x=>x.city==='dripping springs').inferred_only_cards,'1');
 assert.equal(r.rows.find(x=>x.city==='unmapped').total_cards,'1');
 assert.ok(r.rows.every(x=>x.appointment_date!=='2026-10-12'));
 const history=await c.query(sql,['2026-10-13','2026-10-14',true,'backfill']);
 assert.equal(history.rows.find(x=>x.city==='austin').total_cards,'2');
 const after=await c.query('SELECT jsonb_agg(to_jsonb(a) ORDER BY id) AS rows FROM appointment_inventory a');assert.deepEqual(after.rows,before.rows);
 await c.query(fs.readFileSync(path.join(__dirname,'../marketAnalytics/schema.sql'),'utf8'));
 await c.query(fs.readFileSync(path.join(__dirname,'../marketAnalytics/schema.sql'),'utf8'));
 }finally{await c.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await c.end();}
});
