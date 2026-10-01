"use strict";
// New priced appointments widget only. No imports from the existing Mindbody scrapers.
const MONTHS = "January February March April May June July August September October November December".split(" ");
const normalize = value => String(value || "").replace(/\s+/g, " ").trim();
const isoKey = date => date.toISOString().slice(0, 10);
function dateKey(value, reference = "") {
  const raw = normalize(value);
  let year, month, day;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) [year, month, day] = raw.split("-").map(Number);
  else {
    const m = raw.match(new RegExp(`^(${MONTHS.join("|")}) (\\d{1,2})(?:,? (\\d{4}))?$`, "i"));
    if (!m) return "";
    month = MONTHS.findIndex(name => name.toLowerCase() === m[1].toLowerCase()) + 1;
    day = Number(m[2]);
    if (m[3]) year = Number(m[3]);
    else {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(reference)) return "";
      year = Number(reference.slice(0, 4));
      const refMonth = Number(reference.slice(5, 7));
      if (month - refMonth > 6) year--;
      else if (refMonth - month > 6) year++;
    }
  }
  const key = `${year}-${String(month).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
  const date = new Date(key + "T12:00:00Z");
  return Number.isNaN(date.getTime()) || isoKey(date) !== key ? "" : key;
}
function timeValue(value) {
  const m = normalize(value).match(/^(1[0-2]|0?[1-9]):([0-5]\d)\s*(AM|PM)$/i);
  return m ? `${Number(m[1])}:${m[2]} ${m[3].toUpperCase()}` : "";
}
function windowFor(business) {
  const timezone = business.timeZone || business.timezone || "America/Chicago";
  const parts = new Intl.DateTimeFormat("en-US", {timeZone:timezone,year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date());
  const p = type => parts.find(part => part.type === type).value;
  const start = dateKey(business.scrapeStartDate || `${p("year")}-${p("month")}-${p("day")}`);
  const count = Math.ceil(Number(business.daysForward || Number(business.lookaheadHours || 48)/24));
  if (!start || !Number.isFinite(count) || count < 1 || count > 31) throw new Error("Mindbody new: invalid date window (maximum 31 days)");
  const endDate = new Date(start + "T12:00:00Z"); endDate.setUTCDate(endDate.getUTCDate()+count-1);
  const end = dateKey(business.scrapeEndDate || isoKey(endDate));
  if (!end || end < start) throw new Error("Mindbody new: invalid end date");
  const dates = [];
  for (const d = new Date(start+"T12:00:00Z"); isoKey(d)<=end; d.setUTCDate(d.getUTCDate()+1)) {
    if (dates.length >= 31) throw new Error("Mindbody new: date window exceeds 31 days");
    dates.push(isoKey(d));
  }
  return {dates,scrapeStartDate:start,scrapeEndDate:end,daysForward:dates.length,lookaheadHours:Number(business.lookaheadHours || dates.length*24),scrapeWindowMode:business.scrapeWindowMode || "days_forward"};
}
async function poll(page, read, accept, label, timeout=25000) {
  const deadline=Date.now()+timeout;
  do {const value=await read(); if(accept(value)) return value; await page.waitForTimeout(250);} while(Date.now()<deadline);
  throw new Error(`Mindbody new timeout: ${label}`);
}
function parseState(state, expectedDate="") {
  const headings=state.headings.map(normalize);
  const monthHeading=headings.find(h=>new RegExp(`^(${MONTHS.join("|")}) \\d{4}$`,"i").test(h));
  const ref = expectedDate || (monthHeading ? dateKey(monthHeading.replace(/ (\d{4})$/, " 1, $1")) : "");
  let date="", empty=false;
  for(const h of headings) {
    let match=h.match(/^(?:Availability for|Available on|Appointments for)\s+(.+)$/i);
    if(match){date=dateKey(match[1],ref);break;}
    match=h.match(/^(?:There is no availability (?:today,\s*|on\s*)|(?:Your selection is )?fully booked (?:for |on )?(?:today,\s*)?)([A-Za-z]+ \d{1,2}(?:,? \d{4})?)[.!]?$/i);
    if(match){date=dateKey(match[1],ref);empty=true;break;}
  }
  const times=[...new Set(state.controls.map(timeValue).filter(Boolean))];
  // An empty-day heading and actual enabled slots are inconsistent: wait for the update.
  return {...state,date,empty,times,recognized:Boolean(date && (empty || times.length)) && !(empty && times.length)};
}
async function readState(frame, expectedDate="") {
  const state=await frame.evaluate(()=>{
    const visible=el=>{const b=el.getBoundingClientRect(),s=getComputedStyle(el);return b.width>0&&b.height>0&&s.display!=="none"&&s.visibility!=="hidden";};
    const headings=[...document.querySelectorAll("h1,h2,h3,h4,h5,h6")].filter(visible).map(el=>el.textContent.trim());
    const controls=[...document.querySelectorAll("button,a,[role='button']")].filter(el=>visible(el)&&!el.disabled&&!el.closest("[aria-disabled='true']"))
      .map(el=>(el.innerText||el.textContent||"").trim());
    return {headings,controls,text:document.body.innerText,loading:[...document.querySelectorAll("[role='progressbar'],[aria-busy='true']")].some(visible)};
  });
  return parseState(state,expectedDate);
}
async function settled(frame,page,expectedDate="") {
  let previous="",consecutive=0;
  return poll(page,()=>readState(frame,expectedDate),state=>{
    if(state.loading||!state.recognized||expectedDate&&state.date!==expectedDate){consecutive=0;return false;}
    const fingerprint=JSON.stringify([state.date,state.empty,state.times]);
    consecutive=fingerprint===previous?consecutive+1:0; previous=fingerprint;
    return consecutive>=4;
  },`availability for ${expectedDate||"displayed date"}`);
}
function serviceResolver({name,ids,activate}) {
  const norm=value=>String(value||"").replace(/\s+/g," ").trim().toLowerCase();
  const visible=el=>{const b=el.getBoundingClientRect(),s=getComputedStyle(el);return b.width>0&&b.height>0&&s.display!=="none"&&s.visibility!=="hidden";};
  const selectors="[data-testid='service-select'],[data-testid='select-service-button']";
  const cards=[...document.querySelectorAll(selectors)].filter(el=>visible(el)&&!el.closest("[aria-disabled='true']"));
  const container=el=>el.matches("[data-testid='select-service-button']")?el.closest("[role='button']"):el;
  const byId=cards.filter(el=>ids.some(id=>el.id===id||el.getAttribute("data-service-id")===id));
  let matches=byId.length?byId:cards.filter(el=>[...container(el).querySelectorAll("h1,h2,h3,h4,h5,h6")].some(h=>norm(h.textContent)===norm(name)));
  if(matches.length>1) throw new Error("Mindbody new: ambiguous service cards; use a unique exact service name or ID");
  if(!matches.length) return false;
  if(activate) matches[0].click();
  return true;
}
async function selectService(frame,page,business) {
  const args={name:business.serviceName||"",ids:[business.platformServiceId,business.serviceButtonId,business.serviceId].filter(Boolean).map(String),activate:false};
  if(!args.name) throw new Error("Mindbody new: exact serviceName is required");
  if(!await frame.evaluate(serviceResolver,args)) {
    const category=business.categoryText||business.categoryName;
    if(!category) throw new Error("Mindbody new: service card not visible; configure its category");
    const categoryButton=frame.getByRole("button").filter({has:frame.getByRole("heading",{name:category,exact:true})});
    if(await categoryButton.count()!==1) throw new Error(`Mindbody new: category not found or ambiguous: ${category}`);
    if(await categoryButton.getAttribute("aria-expanded")!=="true") await categoryButton.click({timeout:7000});
    await poll(page,()=>frame.evaluate(serviceResolver,args),Boolean,"service after category expansion");
  }
  await frame.evaluate(serviceResolver,{...args,activate:true});
  console.log(`[MINDBODY NEW] Selected exact service: ${args.name}`);
}
async function clickChoice(frame,name,roles) {
  return frame.evaluate(({name,roles})=>{
    const norm=value=>String(value||"").replace(/\s+/g," ").trim().toLowerCase();
    const visible=el=>{const b=el.getBoundingClientRect(),s=getComputedStyle(el);return b.width>0&&b.height>0&&s.display!=="none"&&s.visibility!=="hidden";};
    const selector=roles.map(role=>role==="button"?"button,[role='button']":role==="link"?"a":`[role='${role}']`).join(",");
    const matches=[...document.querySelectorAll(selector)].filter(el=>visible(el)&&!el.disabled&&!el.closest("[aria-disabled='true']")&&
      (norm(el.textContent)===norm(name)||[...el.querySelectorAll("h1,h2,h3,h4,h5,h6,label")].some(h=>norm(h.textContent)===norm(name))));
    if(matches.length!==1) return false;
    matches[0].click();return true;
  },{name,roles});
}
function stageFor(state) {
  const h=state.headings.map(normalize);
  if(h.some(t=>/^(select|choose) date (?:&|and) time$/i.test(t))||state.date) return "availability";
  if(h.some(t=>/^(select|choose)(?: your| an?)? (?:provider|employee|staff|professional)$/i.test(t))) return "provider";
  if(h.some(t=>/^Customize your service$/i.test(t))) return "addons";
  if(h.some(t=>/^(?:(?:select|choose|optional|add)\s+)?(?:add[ -]?ons?|enhancements?|extras)(?:\s.*)?$/i.test(t))) return "addons";
  return "unknown";
}
async function runFlow(frame,page,business) {
  let selectedProvider=false;
  for(let step=0;step<12;step++) {
    const state=await poll(page,()=>readState(frame),s=>!s.loading&&stageFor(s)!=="unknown","booking step");
    const stage=stageFor(state);
    if(stage==="availability") return;
    if(stage==="provider") {
      const wanted=business.skipProvider?"First Available":business.providerText||"First Available";
      if(!selectedProvider) {
        if(!await clickChoice(frame,wanted,["radio","button"])) throw new Error(`Mindbody new: configured provider unavailable: ${wanted}`);
        selectedProvider=true;
      }
      await poll(page,()=>clickChoice(frame,"Continue",["link","button"]),Boolean,"provider Continue",10000);
    } else {
      let skipped=false;
      for(const text of ["None","No Thanks","No Add-ons","Skip","Continue without add-ons"]) {
        if(await clickChoice(frame,text,["radio","button","link"])){skipped=true;break;}
      }
      const after=await readState(frame);
      if(stageFor(after)==="addons") {
        if(!await clickChoice(frame,"Continue",["link","button"])&&!await clickChoice(frame,"Next",["link","button"]))
          throw new Error(`Mindbody new: cannot bypass optional add-ons${skipped?" after selecting None":""}`);
      }
    }
    await page.waitForTimeout(500);
  }
  throw new Error("Mindbody new: booking step limit reached");
}
async function calendarState(frame) {
  return frame.evaluate(()=>{
    const visible=el=>{const b=el.getBoundingClientRect(),s=getComputedStyle(el);return b.width>0&&b.height>0&&s.display!=="none"&&s.visibility!=="hidden";};
    const grids=[...document.querySelectorAll("[role='grid']")].filter(visible);
    if(grids.length!==1) return {label:"",text:"",count:grids.length};
    const grid=grids[0],labels=[];
    labels.push(grid.getAttribute("aria-label")||"");
    for(const id of (grid.getAttribute("aria-labelledby")||"").split(/\s+/)) {const el=document.getElementById(id);if(el)labels.push(el.textContent);}
    // MUI labels the grid with aria-labelledby, not aria-label.
    for(let node=grid.parentElement,depth=0;node&&depth<3;node=node.parentElement,depth++) labels.push(node.innerText||node.textContent||"");
    return {labels,text:grid.innerText||grid.textContent,count:1};
  });
}
function calendarMonth(state) {
  for(const label of state.labels||[]) {
    const m=normalize(label).match(new RegExp(`\\b(${MONTHS.join("|")}) (\\d{4})\\b`,"i"));
    if(m) return dateKey(`${m[1]} 1, ${m[2]}`);
  }
  return "";
}
async function navigateDate(frame,page,target) {
  const wanted=new Date(target+"T12:00:00Z");
  const opener=frame.getByRole("button",{name:"Open calendar",exact:true});
  if(!await opener.isVisible()) throw new Error("Mindbody new: Open calendar control missing");
  await opener.click({timeout:7000});
  for(let step=0;step<24;step++) {
    const info=await poll(page,()=>calendarState(frame),s=>s.count===1&&Boolean(calendarMonth(s)),"calendar month");
    const shown=calendarMonth(info),desired=target.slice(0,7)+"-01";
    if(shown===desired) {
      const day=frame.getByRole("grid").getByRole("gridcell",{name:String(wanted.getUTCDate()),exact:true});
      if(await day.count()!==1||!await day.isEnabled()) throw new Error(`Mindbody new: date cannot be selected: ${target}`);
      await day.click({timeout:7000});
      const apply=frame.getByRole("button",{name:"Apply",exact:true});
      await poll(page,()=>apply.isEnabled(),Boolean,"calendar Apply",5000);
      await apply.click({timeout:7000});
      return settled(frame,page,target);
    }
    const arrow=frame.getByRole("button",{name:shown<desired?"Next month":"Previous month",exact:true});
    if(!await arrow.isEnabled()) throw new Error(`Mindbody new: calendar cannot reach ${target}`);
    await arrow.click({timeout:7000});
    await poll(page,()=>calendarState(frame),s=>Boolean(calendarMonth(s))&&calendarMonth(s)!==shown,"calendar month change",10000);
  }
  throw new Error("Mindbody new: calendar month navigation limit");
}
async function isolatedWidget(page,business) {
  await page.goto(business.bookingUrl,{waitUntil:"domcontentloaded",timeout:90000});
  const frame=await poll(page,async()=>{
    const matches=page.frames().filter(f=>/^https:\/\/go\.mindbodyonline\.com\/book\/widgets\/appointments\/view\//i.test(f.url()));
    if(matches.length>1) throw new Error("Mindbody new: multiple appointment widgets; use the exact widget URL for this integration");
    return matches[0]||null;
  },Boolean,"appointments widget",35000);
  const observed=frame.url();
  // Open the actual observed iframe URL. Host-site newsletters cannot cover this page.
  if(page.mainFrame()!==frame) await page.goto(observed,{waitUntil:"domcontentloaded",timeout:90000});
  const main=page.mainFrame();
  await poll(page,()=>main.locator("h1").allTextContents(),headings=>headings.some(h=>/^Book your appointment(?: \+ Add-ons)?$/i.test(normalize(h))),"new widget service menu",35000);
  return main;
}
async function scrapeMindbodyNewBusiness(page,business,attemptNumber=1) {
  const started=Date.now(),window=windowFor(business),appointments=[],days=[];
  let frame=null,expectedDate="",stage="widget";
  try {
    frame=await isolatedWidget(page,business);
    stage="service";await selectService(frame,page,business);
    stage="booking flow";await runFlow(frame,page,business);
    stage="initial availability";let state=await settled(frame,page);
    for(const date of window.dates) {
      expectedDate=date;stage="date availability";
      if(state.date!==date) state=await navigateDate(frame,page,date);
      if(state.date!==date||!state.recognized) throw new Error(`Mindbody new: unverified date ${date}`);
      days.push({date,times:state.times,source:"verified_new_widget_date",empty:state.empty});
      for(const time of state.times) appointments.push({date,localDateKey:date,time,source:"mindbody_new_widget"});
      console.log(`[MINDBODY NEW] ${date}: ${state.times.length} appointment time(s)`);
    }
    const {dates,...windowFields}=window;
    return {businessName:business.businessName,bookingUrl:business.bookingUrl,platform:business.platform||"mindbody-new",
      service:business.serviceName,serviceName:business.serviceName,serviceType:business.serviceType||"",durationMinutes:business.durationMinutes||null,
      platformServiceId:business.platformServiceId||business.serviceButtonId||business.serviceId||null,
      provider:business.skipProvider?"First Available":business.providerText||"First Available",appointments,date:appointments[0]?.date||window.scrapeStartDate,
      times:[...new Set(appointments.map(a=>a.time))],status:appointments.length?"success":"no_times_found",attemptNumber,
      scrapeDurationMs:Date.now()-started,lastChecked:new Date().toISOString(),rawWidgetText:state.text,
      mindbodyDaySnapshots:days,scraperVersion:"mindbody-new-2026-09-30",...windowFields};
  } catch(error) {
    const state=frame?await readState(frame,expectedDate).catch(()=>null):null;
    const details={stage,expectedDate,observedDate:state?.date,headings:state?.headings,times:state?.times,loading:state?.loading};
    console.error("[MINDBODY NEW DIAGNOSTIC]",JSON.stringify({...details,text:state?.text?.slice(0,5000)},null,2));
    error.message += " | Mindbody new diagnostic: "+JSON.stringify(details);
    throw error;
  }
}
module.exports={scrapeMindbodyNewBusiness,_test:{dateKey,timeValue,windowFor,parseState,stageFor,calendarMonth,serviceResolver,readState,settled,navigateDate}};
