"use strict";

// Public, read-only availability projection. Never starts a scraper or an LLM call.
const crypto = require("node:crypto");
const ZONE = "America/Chicago";
const ORIGIN = "https://nextappt.ai";
const PAGE_SIZE = 100;
const MAX_ROWS = 20000;
const CACHE_MS = 15000;
const FRESH_MINUTES = 30;
const normalize = value => String(value || "").trim().toLowerCase();
const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
function httpUrl(value) {
  try { const u = new URL(value); return ["https:", "http:"].includes(u.protocol) && !u.username && !u.password ? u.href : null; }
  catch { return null; }
}
function iso(value) {
  if (value instanceof Date) return Number.isFinite(+value) ? value.toISOString() : null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) return null;
  const date = new Date(value);
  const day = value.slice(0,10);
  const dayDate = new Date(day+"T00:00:00Z");
  if (!Number.isFinite(+dayDate) || dayDate.toISOString().slice(0,10)!==day) return null;
  return Number.isFinite(+date) ? date.toISOString() : null;
}
function localParts(ms) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {timeZone:ZONE,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit",hourCycle:"h23"}).formatToParts(new Date(ms)).map(p => [p.type,p.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}`;
}
// Reject nonexistent AND ambiguous wall times rather than guessing across DST.
function wallInstant(date, time) {
  const clock = String(time).length === 5 ? `${time}:00` : String(time).slice(0,8);
  const wall = `${date}T${clock}`;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(wall)) return null;
  const base = Date.parse(`${wall}Z`);
  if (!Number.isFinite(base)) return null;
  const matches = [5,6].map(h => base + h*3600000).filter(ms => localParts(ms) === wall);
  return matches.length === 1 ? new Date(matches[0]).toISOString() : null;
}
function offsetTime(instant) {
  const ms = Math.floor(Date.parse(instant)/1000)*1000, wall = localParts(ms);
  const offset = (Date.parse(wall+"Z") - ms)/60000;
  return wall + (offset < 0 ? "-" : "+") + String(Math.floor(Math.abs(offset)/60)).padStart(2,"0") + ":" + String(Math.abs(offset)%60).padStart(2,"0");
}
function integer(value, fallback, min, max, name) {
  if (value === undefined) return fallback;
  if (typeof value !== "string" || !/^\d+$/.test(value) || +value < min || +value > max) throw fail(`Invalid ${name}.`);
  return +value;
}
function parseQuery(query = {}, now = Date.now()) {
  const allowed = new Set(["category","business","duration","hours","date","from","to","page","includeInferred","includeStale","lat","lon","radiusKm"]);
  for (const [k,v] of Object.entries(query)) if (!allowed.has(k) || typeof v !== "string" || v.length > 200) throw fail(`Unsupported or invalid parameter: ${k}`);
  for (const k of ["includeInferred","includeStale"]) if (query[k] !== undefined && !["true","false"].includes(query[k])) throw fail(`Invalid ${k}.`);
  let from = now, to = now + integer(query.hours,24,1,168,"hours")*3600000;
  if (query.date) {
    if (query.from || query.to || query.hours) throw fail("Use date OR from/to OR hours.");
    const day = wallInstant(query.date,"00:00:00");
    if (!day) throw fail("date must be a valid YYYY-MM-DD in Austin.");
    const next = new Date(Date.parse(query.date+"T12:00:00Z")+86400000).toISOString().slice(0,10);
    from = Math.max(now,Date.parse(day)); to = Date.parse(wallInstant(next,"00:00:00"));
  } else if (query.from || query.to) {
    if (!iso(query.from) || !iso(query.to) || query.hours) throw fail("Provide both from and to with Z or a UTC offset; omit hours.");
    from = Math.max(now,Date.parse(query.from)); to = Date.parse(query.to);
  }
  if (to <= from || to > now+8*86400000 || to-from > 7*86400000) throw fail("Window must be in the future, at most seven days long, and within the next eight days.");
  let location = null;
  if ([query.lat,query.lon,query.radiusKm].some(v=>v!==undefined)) {
    const nums = [query.lat,query.lon,query.radiusKm].map(v=>v?.trim() ? Number(v) : NaN);
    if (!nums.every(Number.isFinite) || Math.abs(nums[0])>90 || Math.abs(nums[1])>180 || nums[2]<=0 || nums[2]>100) throw fail("Provide lat, lon, and radiusKm (greater than zero, at most 100).");
    location = {lat:nums[0],lon:nums[1],radiusKm:nums[2]};
  }
  return {from:new Date(from).toISOString(),to:new Date(to).toISOString(),category:normalize(query.category),business:normalize(query.business),duration:integer(query.duration,null,1,480,"duration"),page:integer(query.page,1,1,10000,"page"),includeInferred:query.includeInferred==="true",includeStale:query.includeStale==="true",location};
}
function distanceKm(lat1,lon1,lat2,lon2) {
  const rad = n=>n*Math.PI/180;
  const a=Math.sin(rad(lat2-lat1)/2)**2+Math.cos(rad(lat1))*Math.cos(rad(lat2))*Math.sin(rad(lon2-lon1)/2)**2;
  return 6371*2*Math.atan2(Math.sqrt(a),Math.sqrt(Math.max(0,1-a)));
}
function project(row, business, service, now) {
  const date = row.local_date instanceof Date ? row.local_date.toISOString().slice(0,10) : String(row.local_date || "").slice(0,10);
  const time = String(row.local_time || "").slice(0,8);
  // local_date/local_time are the existing scheduler wall-clock fields. Prefer these
  // over appointment_start, which historically mixed timestamp types on ingestion.
  let start = date && time ? wallInstant(date,time) : iso(row.appointment_start);
  if (!start || (row.timezone && row.timezone !== ZONE)) return null;
  const source = row.inventory_reason === "manual_admin" ? "manual" : normalize(row.appointment_source);
  if (!["confirmed","inferred","manual"].includes(source)) return null;
  // Only the EXACT confirmed row's source timestamp qualifies. updated_at and
  // page generation time are never substituted for an observation timestamp.
  const checked = source === "confirmed" ? iso(row.observed_at) : null;
  const checkedAt = checked && Date.parse(checked)<=now ? checked : null;
  const freshness = checkedAt ? now-Date.parse(checkedAt)<=FRESH_MINUTES*60000 ? "fresh" : "stale" : "unknown";
  const bookingUrl = httpUrl(row.booking_url || business.bookingUrl);
  if (!bookingUrl) return null;
  const slug = business.businessSlug || business.slug || "";
  const duration = Number(row.duration_minutes);
  const category = normalize(row.category_slug || service.categorySlug || service.marketplaceCategory || "");
  const id = crypto.createHash("sha256").update(JSON.stringify([business.businessName,service.businessServiceId || service.id,row.service_name,row.provider_name,start,duration,source])).digest("hex").slice(0,24);
  const num = value => value!==null && value!==undefined && value!=="" && Number.isFinite(Number(value)) ? Number(value) : null;
  return {id,business:{name:business.businessName,slug,address:business.address || "",city:business.city || "",latitude:num(business.latitude),longitude:num(business.longitude),url:slug?`${ORIGIN}/business/${encodeURIComponent(slug)}`:null,verificationStatus:business.verificationStatus || "unclaimed"},service:{name:row.service_name || service.serviceName,category,durationMinutes:Number.isFinite(duration)&&duration>0?duration:null},providerName:row.provider_name || null,startAt:start,localStart:offsetTime(start),timeZone:ZONE,sourceType:source,lastCheckedAt:checkedAt,freshness,bookingUrl};
}

function createAvailabilityService({db,businessManager,matchesMarketplaceMetro,clock=Date.now}) {
  let cache = null, pending = null;
  async function dataset() {
    if (cache && clock()-cache.at<CACHE_MS) return cache;
    if (pending) return pending;
    pending = (async()=> {
      const now=clock();
      const businesses=(await businessManager.getAllBusinesses({includeDisabled:true})).filter(b=>b.enabled!==false && b.publicInventoryVisible!==false && matchesMarketplaceMetro(b,"austin"));
      const names=businesses.map(b=>b.businessName);
      const byName=new Map(businesses.map(b=>[normalize(b.businessName),b]));
      // Bounded dataset shared across readers. Refuse oversize datasets explicitly;
      // never silently present a truncated database response as complete.
      const result=await db.query({text:`SELECT ai.*, COALESCE(c.raw_json->>'lastChecked', rr.raw_response_json->>'lastChecked') AS observed_at
        FROM appointment_inventory ai
        LEFT JOIN confirmed_appointments c ON c.id=ai.confirmed_id
        LEFT JOIN raw_scrape_results rr ON rr.id=c.raw_scrape_result_id
        WHERE ai.business_name = ANY($1::text[])
          AND ai.searchable IS TRUE
          AND COALESCE(to_jsonb(ai)->>'inventory_status',to_jsonb(ai)->>'status','active') NOT IN ('inactive','expired','archived','deleted')
          AND ai.local_date >= $2::date AND ai.local_date <= $3::date
        ORDER BY ai.id ASC LIMIT ${MAX_ROWS+1}`,values:[names,localParts(now).slice(0,10),localParts(now+8*86400000).slice(0,10)],query_timeout:8000});
      if(result.rows.length>MAX_ROWS) throw fail("Availability dataset exceeds this installation's read limit.",503);
      let excluded=0; const unique=new Map();
      for(const row of result.rows) {
        const b=byName.get(normalize(row.business_name));
        if(!b) continue;
        const services=b.services || [];
        const candidates= row.business_service_id ? services.filter(s=>String(s.businessServiceId || s.id)===String(row.business_service_id)) : services.filter(s=>normalize(s.serviceName)===normalize(row.service_name) && Number(s.durationMinutes)===Number(row.duration_minutes));
        if(candidates.length!==1 || candidates[0].enabled===false) {excluded++;continue;}
        const item=project(row,b,candidates[0],now);
        if(!item) {excluded++;continue;}
        const old=unique.get(item.id);
        if(!old || (item.lastCheckedAt || "")>(old.lastCheckedAt || "")) unique.set(item.id,item);
      }
      cache={at:now,items:[...unique.values()],excluded}; return cache;
    })();
    try {return await pending;} finally {pending=null;}
  }
  async function search(query={}) {
    const now=clock(), q=parseQuery(query,now), data=await dataset();
    const base=data.items.map(item=>({...item,freshness:item.lastCheckedAt ? now-Date.parse(item.lastCheckedAt)<=FRESH_MINUTES*60000?"fresh":"stale":"unknown"})).filter(a=>{
      if(a.startAt<q.from || a.startAt>=q.to) return false;
      if(q.category && a.service.category!==q.category) return false;
      if(q.business && ![normalize(a.business.slug),normalize(a.business.name)].includes(q.business)) return false;
      if(q.duration && a.service.durationMinutes!==q.duration) return false;
      if(q.location) {
        if(a.business.latitude===null || a.business.longitude===null) return false;
        if(distanceKm(q.location.lat,q.location.lon,a.business.latitude,a.business.longitude)>q.location.radiusKm) return false;
      }
      return true;
    });
    const items=base.filter(a=>(q.includeInferred || a.sourceType!=="inferred") && (q.includeStale || a.freshness==="fresh"));
    items.sort((a,b)=>a.startAt.localeCompare(b.startAt)||a.id.localeCompare(b.id));
    const params=new URLSearchParams({...query,from:q.from,to:q.to});params.delete("date");params.delete("hours");
    function url(page,path="/api/public/availability") {const p=new URLSearchParams(params);p.set("page",String(page));return ORIGIN+path+"?"+p;}
    return {schemaVersion:"1.0",generatedAt:new Date(now).toISOString(),inventoryReadAt:new Date(data.at).toISOString(),timeZone:ZONE,coverage:{metro:"austin",scope:"NextAppt's publicly visible configured services; not every business or appointment in the area",maximumWindowDays:7,excludedUnusableRowsInLoadedDataset:data.excluded},filters:q,freshnessPolicy:{freshWithinMinutes:FRESH_MINUTES,unknownTimestampsAreFresh:false},totalMatching:items.length,excludedByFreshnessOrSource:base.length-items.length,page:q.page,pageSize:PAGE_SIZE,hasMore:q.page*PAGE_SIZE<items.length,next:q.page*PAGE_SIZE<items.length?url(q.page+1):null,nextHtml:q.page*PAGE_SIZE<items.length?url(q.page+1,"/availability/austin"):null,previousHtml:q.page>1?url(q.page-1,"/availability/austin"):null,canonical:ORIGIN+"/availability/austin"+(Object.keys(query).length?"?"+new URLSearchParams(query):""),dataUrl:url(q.page),paginationConsistency:"Live inventory can change between requests; counts describe this response, not an immutable snapshot.",bookingNotice:"Confirmed means observed in the booking source, not reserved. Reconfirm with the business before booking. Inferred and manual entries are not independently checked.",appointments:items.slice((q.page-1)*PAGE_SIZE,q.page*PAGE_SIZE)};
  }
  return {search};
}

function renderList(data) {
  const rows=data.appointments.map(a=>`<li id="appointment-${a.id}"><h3>${escapeHtml(a.business.name)} — ${escapeHtml(a.service.name)}</h3><p>${escapeHtml(a.business.address)} · ${escapeHtml(a.service.durationMinutes ?? "Unknown")} minutes${a.providerName?` · ${escapeHtml(a.providerName)}`:""}</p><p><time datetime="${escapeHtml(a.localStart)}">${escapeHtml(a.localStart)}</time> (${ZONE}) · ${escapeHtml(a.sourceType)} · ${escapeHtml(a.freshness)}</p><p>Last checked: ${a.lastCheckedAt?`<time datetime="${a.lastCheckedAt}">${a.lastCheckedAt}</time>`:"Unknown; not independently verified"}</p><a href="${escapeHtml(a.bookingUrl)}">Check availability and book with ${escapeHtml(a.business.name)}</a></li>`).join("\n");
  return `<section aria-label="Readable appointment inventory"><h2>Austin appointment availability</h2><p>Window: ${escapeHtml(data.filters.from)} to ${escapeHtml(data.filters.to)} (end exclusive). Austin time zone: ${ZONE}.</p><p>${data.totalMatching} matching entries. Page ${data.page}. ${escapeHtml(data.coverage.scope)}.</p><p>Inventory read: ${data.inventoryReadAt}. Page generated: ${data.generatedAt}. These are not source-check times. Fresh means checked within ${FRESH_MINUTES} minutes.</p><p>${escapeHtml(data.bookingNotice)}</p>${rows?`<ol>${rows}</ol>`:"<p>No matching fresh inventory is listed. This does not mean no appointments exist in Austin.</p>"}<p>${data.excludedByFreshnessOrSource} entries excluded by the selected freshness/source filters. ${data.coverage.excludedUnusableRowsInLoadedDataset} rows in the loaded dataset could not be safely published.</p><nav>${data.previousHtml?`<a rel="prev" href="${escapeHtml(data.previousHtml)}">Previous page</a> · `:""}${data.nextHtml?`<a rel="next" href="${escapeHtml(data.nextHtml)}">Next page</a> · `:""}<a href="${escapeHtml(data.dataUrl)}">Read this inventory as JSON</a> · <a href="/availability/austin">Browse appointment inventory</a> · <a href="/availability-methodology">Coverage and methodology</a></nav></section>`;
}
function renderPage(data) {
  // No Event/Offer markup: these are possible service openings, not booked events.
  const schema={"@context":"https://schema.org","@type":"CollectionPage",name:"Austin appointment availability",url:data.canonical,description:data.coverage.scope,mainEntity:{"@type":"ItemList",numberOfItems:data.appointments.length,itemListElement:data.appointments.map((a,i)=>({"@type":"ListItem",position:(data.page-1)*PAGE_SIZE+i+1,name:`${a.business.name}: ${a.service.name}, ${a.localStart}, ${a.sourceType}, ${a.freshness}`,url:`${data.canonical}#appointment-${a.id}`}))}};
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Austin appointment availability | NextAppt.ai</title><meta name="description" content="Browse NextAppt Austin appointment inventory with source-check timestamps, time zones, booking links and availability labels."><link rel="canonical" href="${escapeHtml(data.canonical)}"><script type="application/ld+json">${JSON.stringify(schema).replace(/</g,"\\u003c")}</script></head><body><header><a href="/">NextAppt.ai</a> · <a href="/austin/massage">Massage search</a></header><main><h1>Austin appointment inventory</h1>${renderList(data)}</main></body></html>`;
}
module.exports={createAvailabilityService,parseQuery,project,wallInstant,offsetTime,iso,httpUrl,renderList,renderPage,escapeHtml};