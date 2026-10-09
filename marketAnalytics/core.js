'use strict';
const TIMEZONE = 'America/Chicago';
function localClock(now = new Date(), timezone = TIMEZONE) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {timeZone:timezone,
    year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'})
    .formatToParts(now).map(x=>[x.type,x.value]));
  return {date:`${p.year}-${p.month}-${p.day}`, hour:Number(p.hour), minute:Number(p.minute)};
}
function dateKey(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
      !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0,10)!==value)
    throw new Error('Use a valid YYYY-MM-DD date.');
  return value;
}
function addDays(date,n) { return new Date(Date.parse(dateKey(date))+n*86400000).toISOString().slice(0,10); }
function windowFor(kind,date) {
  dateKey(date);
  if(kind==='forward') return {from:addDays(date,1),to:addDays(date,2)};
  if(kind==='daily'||kind==='backfill') return {from:date,to:date};
  throw new Error('Invalid snapshot kind.');
}
function due(now = new Date(), timezone = TIMEZONE) {
  const c=localClock(now,timezone);
  return ['forward','daily'].filter(k=>c.hour===(k==='forward'?13:23) && c.minute<15)
    .map(kind=>({kind,date:c.date}));
}
function csvCell(value) {
  let s=String(value ?? '');
  if(/^[\s]*[=+@-]/.test(s)) s="'"+s;
  return '"'+s.replaceAll('"','""')+'"';
}
function html(value) { return String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
module.exports={TIMEZONE,localClock,dateKey,addDays,windowFor,due,csvCell,html};
