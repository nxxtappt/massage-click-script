'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const fs=require('fs');const path=require('path');
const {windowFor,due,localClock,dateKey}=require('../marketAnalytics/core');
const {csv,reportHTML}=require('../marketAnalytics/export');
test('Monday forward snapshot includes Tuesday and Wednesday only',()=>{
 assert.deepEqual(windowFor('forward','2026-10-12'),{from:'2026-10-13',to:'2026-10-14'});
 assert.deepEqual(windowFor('daily','2026-10-12'),{from:'2026-10-12',to:'2026-10-12'});
});
test('calendar windows cross month/year and leap boundaries',()=>{
 assert.deepEqual(windowFor('forward','2026-12-31'),{from:'2027-01-01',to:'2027-01-02'});
 assert.deepEqual(windowFor('forward','2028-02-28'),{from:'2028-02-29',to:'2028-03-01'});
 assert.throws(()=>dateKey('2026-02-29'));
});
test('Chicago schedule adjusts for DST in both seasons',()=>{
 assert.equal(due(new Date('2026-10-12T18:00:00Z'))[0].kind,'forward');
 assert.equal(due(new Date('2026-12-12T19:00:00Z'))[0].kind,'forward');
 assert.deepEqual(due(new Date('2026-10-13T04:00:00Z')),[{kind:'daily',date:'2026-10-12'}]);
 assert.equal(localClock(new Date('2026-12-13T05:00:00Z')).date,'2026-12-12');
 assert.deepEqual(due(new Date('2026-10-12T18:15:00Z')),[]);
 assert.deepEqual(due(new Date('2026-10-12T17:59:00Z')),[]);
});
test('downloads escape HTML and spreadsheet formulas',()=>{
 const data={filters:{from:'2026-10-01',to:'2026-10-02'},timezone:'America/Chicago',rows:[{city:'=HYPERLINK("evil")',industry:'<script>alert(1)</script>',note:'x & y'}],caveat:'No demand inference',definitionVersion:1};
 assert.match(csv(data),/"'=HYPERLINK/);
 assert.ok(!reportHTML(data).includes('<script>'));
 assert.match(reportHTML(data),/&lt;script&gt;/);
});
test('source SQL contains no operational mutations',()=>{
 const sql=fs.readFileSync(path.join(__dirname,'../marketAnalytics/aggregate.sql'),'utf8').replace(/--[^\n]*/g,'');
 assert.ok(!/\b(insert|update|delete|truncate|alter|drop)\b/i.test(sql));
 const schema=fs.readFileSync(path.join(__dirname,'../marketAnalytics/schema.sql'),'utf8');
 for(const m of schema.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g))assert.ok(m[1].startsWith('market_analytics_'));
});
