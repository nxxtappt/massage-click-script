/* Market intelligence workspace; all reads use existing authenticated analytics APIs. */
(() => {
 'use strict';
 const esc=escapeHtml;
 const view=window.MarketAnalyticsView;
 const nav=document.querySelector('.nav-btn')?.parentElement;
 if(!nav||!view)return;
 let button=nav.querySelector('[data-view="marketAnalytics"]');
 if(!button){button=document.createElement('button');button.className='nav-btn';button.type='button';button.dataset.view='marketAnalytics';button.textContent='Market Analytics';nav.appendChild(button);}
 refreshNavButtons();button.addEventListener('click',()=>loadView('marketAnalytics'));
 const original=loadView;
 let generation=0,heartbeatTimer=null,reportPage=0,lastData=null,lastStatus=null;
 const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()).map(p=>[p.type,p.value]));
 const today=`${parts.year}-${parts.month}-${parts.day}`;
 const day=n=>new Date(Date.parse(today)+n*86400000).toISOString().slice(0,10);
 let filters={from:day(-84),to:day(-1),kind:'history',city:'',industry:'',weekday:'all',historyWeeks:'12',historySource:'merged'};
 loadView=function(name){
  if(name==='marketAnalytics')return loadMarket();
  generation++;clearInterval(heartbeatTimer);heartbeatTimer=null;
  return original(name);
 };
 const weekdays=['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
 const modes={history:{label:'Daily history',title:'Historical inventory by weekday',subtitle:'Daily snapshots and retained history in one timeline.',metric:'Latest historical day'},forward:{label:'Future vs history',title:'Future supply vs historical weekdays',subtitle:'Compare each future date with its matching weekday average and the previous week.',metric:'Latest two-day inventory'}};
 const number=v=>v==null?'—':Number(v).toLocaleString();
 const title=v=>String(v||'').replace(/\b[a-z]/g,c=>c.toUpperCase());
 const time=v=>v?new Date(v).toLocaleString('en-US',{timeZone:'America/Chicago',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}):'No heartbeat yet';
 async function request(url){const r=await fetch(url,{credentials:'same-origin'});let data;try{data=await r.json();}catch{throw new Error('Could not read analytics response. Check your admin login.');}if(!r.ok)throw new Error(data.error||'Analytics request failed.');return data;}
 function workerInfo(status){
  const hb=status.workers?.find(w=>w.worker_key==='scheduled-worker');
  const fresh=hb&&Date.now()-Date.parse(hb.heartbeat_at)<180000;
  if(hb?.last_error)return {text:'Needs attention',className:'error',detail:hb.last_error};
  if(fresh)return {text:'Collection running',className:'',detail:'Last check '+time(hb.heartbeat_at)};
  return {text:hb?'Collection offline':'Awaiting scheduler',className:'warn',detail:hb?'Last check '+time(hb.heartbeat_at):'The analytics companion starts with your existing scheduler service.'};
 }
 function chartHTML(trend){
  const c=view.chart(trend);
  if(!c)return '<div class="ma-empty"><strong>No trend yet</strong>Choose Daily history to explore retained inventory, or wait for the first scheduled capture.</div>';
  const points=c.points.map(p=>`${p.x},${p.y}`).join(' ');
  const bottom=c.height-c.bottom;
  const area=`${c.points[0].x},${bottom} ${points} ${c.points.at(-1).x},${bottom}`;
  const ticks=[0,.5,1].map(f=>{const y=c.top+(1-f)*(c.height-c.top-c.bottom);return `<line x1="${c.left}" x2="${c.width-c.right}" y1="${y}" y2="${y}" stroke="#e4edf2"/><text x="${c.left-8}" y="${y+4}" text-anchor="end">${number(Math.round(c.max*f))}</text>`;}).join('');
  const marks=c.points.length>80?[]:c.points;
  return `<svg class="ma-chart" role="img" aria-label="Inventory trend across ${trend.length} measured dates. Exact values appear in the report table." viewBox="0 0 ${c.width} ${c.height}">
   ${ticks}<polygon points="${area}" fill="#e8f5f6"/><polyline points="${points}" fill="none" stroke="#087c88" stroke-width="2.5"/>
   ${marks.map(p=>`<circle cx="${p.x}" cy="${p.y}" r="3" fill="#087c88"><title>${esc(p.date)}: ${number(p.total)} cards</title></circle>`).join('')}
   <text x="${c.left}" y="${c.height-10}">${esc(trend[0].date)}</text><text x="${c.width-c.right}" y="${c.height-10}" text-anchor="end">${esc(trend.at(-1).date)}</text></svg>`;
 }
 function signed(v,percent=false){return v==null?'—':(Number(v)>0?'+':'')+Number(v).toLocaleString(undefined,{maximumFractionDigits:2})+(percent?'%':'');}
 function weekdayHTML(){
  if(filters.kind!=='history')return '';
  const all=lastData.weekdaySummary||[];
  const rows=filters.weekday==='all'?all:all.filter(r=>String(r.weekday_index)===filters.weekday);
  return `<section class="ma-panel"><div class="ma-panel-head"><h4>Monday–Sunday averages by market</h4><span class="ma-eyebrow">Measured days only</span></div>
   <div class="ma-weekdays" role="group" aria-label="Organize by weekday"><button data-weekday="all" aria-pressed="${filters.weekday==='all'}">All days</button>${weekdays.map((w,i)=>`<button data-weekday="${i}" aria-pressed="${filters.weekday===String(i)}">${w}</button>`).join('')}</div>
   <div class="ma-table-scroll"><table class="ma-table"><thead><tr><th>Weekday</th><th>City / state</th><th>Industry</th><th>Average cards</th><th>Measured days</th><th>Daily / reconstructed days</th><th>Range</th></tr></thead><tbody>${rows.slice(0,100).map(r=>`<tr><td>${esc(r.weekday)}</td><td>${esc(title(r.city))} / ${esc(String(r.state).toUpperCase())}</td><td>${esc(title(r.industry))}</td><td class="ma-n"><strong>${number(r.average_cards)}</strong></td><td class="ma-n">${number(r.sample_days)}</td><td class="ma-n">${number(r.scheduled_days)} / ${number(r.reconstructed_days)}</td><td class="ma-n">${number(r.min_cards)}–${number(r.max_cards)}</td></tr>`).join('')||'<tr><td colspan="7">No measured history for this weekday.</td></tr>'}</tbody></table></div>
   <p style="font-size:11px">Averages use the selected date range, separately for each city, state, industry and weekday. Sample counts show coverage; missing days are excluded. ${rows.length>100?'First 100 groups shown. Downloads contain the full weekday profile.':''}</p></section>`;
 }
 function renderTable(){
  const rows=lastData.rows;const perPage=25;const count=Math.max(1,Math.ceil(rows.length/perPage));reportPage=Math.min(reportPage,count-1);
  const future=filters.kind==='forward';
  const headers=future?['Appointment date / weekday','City / state','Industry','Future cards','Weekday average','Measured days (daily / reconstructed)','vs average','Previous weekday / inventory','vs previous']:['Appointment date','Weekday','City / state','Industry','History source','Observed','Inferred only','Total cards','Businesses'];
  const body=rows.slice(reportPage*perPage,(reportPage+1)*perPage).map(r=>future?`<tr>
   <td>${esc(r.appointment_date)}<small class="ma-cell-note">${esc(r.weekday)} · captured ${esc(r.snapshot_date)}</small></td><td>${esc(title(r.city))} / ${esc(String(r.state).toUpperCase())}</td><td>${esc(title(r.industry))}</td>
   <td class="ma-n"><strong>${number(r.total_cards)}</strong></td><td class="ma-n">${number(r.historical_average)}</td><td class="ma-n">${number(r.historical_sample_days)}<small class="ma-cell-note">${number(r.scheduled_sample_days)} / ${number(r.reconstructed_sample_days)}</small></td>
   <td class="ma-n">${signed(r.difference_from_average)}<small class="ma-cell-note">${signed(r.percent_vs_average,true)}</small></td>
   <td>${esc(r.previous_weekday_date)}<small class="ma-cell-note">${number(r.previous_weekday_cards)} cards · ${esc(r.previous_weekday_source||'Unavailable')}</small></td>
   <td class="ma-n">${signed(r.difference_from_previous)}<small class="ma-cell-note">${signed(r.percent_vs_previous,true)}</small></td></tr>`:`<tr>
   <td>${esc(r.appointment_date)}</td><td>${esc(r.weekday)}</td><td>${esc(title(r.city))} / ${esc(String(r.state).toUpperCase())}</td><td>${esc(title(r.industry))}</td><td>${esc(r.history_source)}</td>
   <td class="ma-n">${number(r.confirmed_cards)}</td><td class="ma-n">${number(r.inferred_only_cards)}</td><td class="ma-n"><strong>${number(r.total_cards)}</strong></td><td class="ma-n">${number(r.businesses_with_cards)}</td></tr>`).join('');
  document.querySelector('#ma-report-table').innerHTML=`<div class="ma-table-scroll"><table class="ma-table"><thead><tr>${headers.map(h=>`<th scope="col">${h}</th>`).join('')}</tr></thead><tbody>${body||`<tr><td colspan="${headers.length}"><div class="ma-empty"><strong>No matching records</strong>Try another weekday, market, or date range.</div></td></tr>`}</tbody></table></div>
   <div class="ma-pagination"><span>${rows.length?reportPage*perPage+1:0}–${Math.min((reportPage+1)*perPage,rows.length)} of ${number(rows.length)} rows</span><div><button id="ma-prev" ${reportPage===0?'disabled':''} aria-label="Previous page">Previous</button> <button id="ma-next" ${reportPage===count-1?'disabled':''} aria-label="Next page">Next</button></div></div>`;
  document.querySelector('#ma-prev').onclick=()=>{reportPage--;renderTable();};document.querySelector('#ma-next').onclick=()=>{reportPage++;renderTable();};
 }
 function render(){
  const status=lastStatus,data=lastData,m=modes[filters.kind],summary=view.summarize(data.rows,filters.kind==='forward'&&filters.weekday==='all'?'forward':'history'),worker=workerInfo(status);
  const cities=[...new Set((status.markets||[]).map(r=>r.city))].sort();const industries=[...new Set((status.markets||[]).filter(r=>!filters.city||r.city===filters.city).map(r=>r.industry))].sort();
  if(filters.city&&!cities.includes(filters.city))cities.push(filters.city);
  if(filters.industry&&!industries.includes(filters.industry))industries.push(filters.industry);
  const options=(items,selected,label)=>`<option value="">${label}</option>`+items.map(v=>`<option value="${esc(v)}" ${selected===v?'selected':''}>${esc(title(v))}</option>`).join('');
  const sourceTotal=summary.split.confirmed+summary.split.inferred+summary.split.unknown;
  const bars=Object.values(summary.split).map(n=>`<span style="width:${sourceTotal?n/sourceTotal*100:0}%"></span>`).join('');
  content.innerHTML=`<div class="ma">
   <div class="ma-hero"><div><div class="ma-eyebrow">NextAppt intelligence</div><h3>${m.title}</h3><p>${m.subtitle}</p></div><div><span id="ma-worker-badge" class="ma-badge ${worker.className}">${worker.text}</span><p id="ma-worker-detail" style="font-size:11px;margin-top:8px">${esc(worker.detail)}</p></div></div>
   <div class="ma-modes" role="group" aria-label="Measurement">${Object.entries(modes).map(([key,v])=>`<button class="ma-mode ${key===filters.kind?'active':''}" data-mode="${key}" aria-pressed="${key===filters.kind}">${v.label}</button>`).join('')}</div>
   <div class="ma-panel"><form id="ma-form" class="ma-toolbar">
    <label>Appointment dates from<input name="from" type="date" value="${esc(filters.from)}" required></label><label>Through<input name="to" type="date" value="${esc(filters.to)}" required></label>
    <label>City<select name="city">${options(cities,filters.city,'All cities')}</select></label><label>Industry<select name="industry">${options(industries,filters.industry,'All industries')}</select></label>
    <label>Day of week<select name="weekday"><option value="all">All weekdays</option>${weekdays.map((w,i)=>`<option value="${i}" ${String(i)===filters.weekday?'selected':''}>${w}</option>`).join('')}</select></label>
    <label>Historical source<select name="historySource">${[['merged','Daily + retained history'],['daily','Daily captures only'],['backfill','Reconstructed only']].map(([k,v])=>`<option value="${k}" ${filters.historySource===k?'selected':''}>${v}</option>`).join('')}</select></label>
    ${filters.kind==='forward'?`<label>Weekday average window<select name="historyWeeks">${[4,8,12,26,52].map(n=>`<option value="${n}" ${String(n)===String(filters.historyWeeks)?'selected':''}>Previous ${n} weeks</option>`).join('')}</select></label>`:''}
    <button class="ma-button" type="submit">Update report</button></form>
    <div class="ma-presets">${[['7','Last 7 days'],['30','Last 30 days'],['90','Last 90 days'],...(filters.kind==='forward'?[['next','Next two days']]:[])].map(([key,label])=>`<button data-preset="${key}" type="button">${label}</button>`).join('')}</div>
    <div class="ma-applied">Showing ${esc(filters.from)} – ${esc(filters.to)} · ${esc(title(filters.city)||'All cities')} · ${esc(title(filters.industry)||'All industries')} · America/Chicago</div></div>
   <div class="ma-kpis">
    <div class="ma-kpi"><div class="ma-kpi-label">${filters.kind==='forward'&&filters.weekday!=='all'?'Latest selected-day inventory':m.metric}</div><strong>${number(summary.total)}</strong><small>${summary.latestDate?'Latest measured date: '+esc(summary.latestDate):'Awaiting retained data'}</small></div>
    <div class="ma-kpi"><div class="ma-kpi-label">Observed cards</div><strong>${sourceTotal?number(summary.split.confirmed):'—'}</strong><small>Confirmed availability in shown dates for the latest measurement</small></div>
    <div class="ma-kpi"><div class="ma-kpi-label">Markets with inventory</div><strong>${summary.latestDate?number(summary.markets):'—'}</strong><small>Distinct city / state / industry groups in the latest measurement</small></div>
    <div class="ma-kpi"><div class="ma-kpi-label">Measured dates</div><strong>${number(summary.trend.length)}</strong><small>${summary.missed?number(summary.missed)+' missed captures in these results':'Dates with retained inventory evidence'}</small></div>
   </div>
   <div class="ma-grid"><section class="ma-panel"><div class="ma-panel-head"><h4>Inventory trend</h4><span class="ma-eyebrow">${filters.kind==='forward'&&filters.weekday==='all'?'Two-day total':'Cards per day'}</span></div>${chartHTML(summary.trend)}<p style="font-size:11px">${filters.kind==='forward'&&filters.weekday==='all'?'Horizontal axis: capture date. Each point counts both future dates once.':'Horizontal axis: appointment date.'} Missing dates are omitted, not treated as zero.</p></section>
    <section class="ma-panel"><h4>Latest market breakdown</h4>${summary.topMarkets.map(r=>`<div class="ma-top"><div>${esc(title(r.city))}, ${esc(String(r.state).toUpperCase())}<small>${esc(title(r.industry))}</small></div><strong>${number(r.total)}</strong></div>`).join('')||'<div class="ma-empty">No market totals yet.</div>'}<div class="ma-source-bar" aria-hidden="true">${bars}</div><div class="ma-legend"><span>Observed ${number(summary.split.confirmed)}</span><span>Inferred ${number(summary.split.inferred)}</span><span>Other ${number(summary.split.unknown)}</span></div><p style="font-size:11px">Source breakdown uses the displayed appointment dates of the latest measurement.</p></section></div>
   ${weekdayHTML()}
   ${filters.kind==='forward'?`<div class="ma-note" style="margin-bottom:18px">Comparing future supply to the previous ${esc(filters.historyWeeks)} weeks of matching weekdays. Each city / state / industry is compared separately. Future inventory is measured at 1 p.m.; history is daily 11 p.m. inventory or reconstructed offers, so timing and coverage differ. This comparison does not measure demand. Use “Daily captures only” to exclude reconstruction; limited samples are shown explicitly.</div>`:''}
   <div class="ma-panel ma-export"><div><h4>Shareable market reports</h4><p style="font-size:12px">Export the current filters for business outreach or internal review.</p></div><div class="ma-actions"><a class="ma-button secondary" id="ma-csv">Download CSV</a><a class="ma-button" id="ma-html">Printable report</a></div></div>
   <section class="ma-panel"><div class="ma-panel-head"><h4>${filters.kind==='forward'?'Future date comparisons':'History detail'}</h4><span style="font-size:12px;color:#64758a">${number(data.rows.length)} records</span></div><div id="ma-report-table"></div></section>
   <div class="ma-note">${filters.kind==='history'?(filters.historySource==='merged'?'Daily captures take precedence for each date; retained reconstruction fills dates without a completed daily capture. ':filters.historySource==='daily'?'Showing scheduled daily captures only. ':'Showing reconstructed retained offers only. ')+'Today’s partial history is excluded. ':''}Cards count advertised service options. They can overlap and do not establish bookings or staff capacity. ${filters.kind==='forward'?'The two-day total repeats on date rows; count it once per capture and market. ':''}Missing records do not prove zero supply. Open the printable report and use Print → Save as PDF to create a PDF attachment.</div>
   <details class="ma-panel" style="margin-top:18px"><summary>Collection schedule, recent runs, and definitions</summary><p>1 p.m.: tomorrow and the day after. 11 p.m.: retained past cards for that day. Chicago time adjusts for daylight saving. Analytics can run alongside the existing scheduler.</p>
    ${(status.runs||[]).map(r=>`<div class="ma-health-row"><span>${esc(r.snapshot_date)}</span><span>${esc(r.kind)}</span><span>${esc(r.status)}</span><span>${esc(time(r.captured_at))}</span></div>`).join('')||'<p>No runs recorded yet.</p>'}
    <p>${esc(data.caveat||'')}</p><p>Observed means a confirmed availability record, not a customer booking. Staffing or demand conclusions need additional evidence. Reports contain aggregates; they do not include individual business names or booking URLs.</p></details></div>`;
  renderTable();
  document.querySelector('#ma-form').onsubmit=e=>{e.preventDefault();filters={...filters,...Object.fromEntries(new FormData(e.currentTarget))};reportPage=0;loadMarket();};
  for(const el of document.querySelectorAll('[data-mode]'))el.onclick=()=>{filters.kind=el.dataset.mode;filters.from=filters.kind==='forward'?day(1):day(-30);filters.to=filters.kind==='forward'?day(2):day(-1);reportPage=0;loadMarket();};
  for(const el of document.querySelectorAll('[data-preset]'))el.onclick=()=>{const n=el.dataset.preset;filters.from=n==='next'?day(1):day(-Number(n));filters.to=n==='next'?day(2):day(-1);reportPage=0;loadMarket();};
  for(const el of document.querySelectorAll('[data-weekday]'))el.onclick=()=>{filters.weekday=el.dataset.weekday;reportPage=0;loadMarket();};
  for(const format of ['csv','html'])document.querySelector('#ma-'+format).href='/api/admin/market-analytics/explore?'+new URLSearchParams({...filters,format});
 }
 async function loadMarket(){
  const g=++generation;clearInterval(heartbeatTimer);currentView='marketAnalytics';setActiveNav(currentView);
  pageTitle.textContent='Market Analytics';pageSubtitle.textContent='Market supply, historical trends, and downloadable reports';
  content.innerHTML='<div class="ma"><div class="ma-skeleton" role="status" aria-label="Loading market analytics"></div></div>';
  try{
   const [status,data]=await Promise.all([request('/api/admin/market-analytics/status'),request('/api/admin/market-analytics/explore?'+new URLSearchParams(filters))]);
   if(g!==generation||currentView!=='marketAnalytics')return;
   lastStatus=status;lastData=data;render();setStatus('Market report ready.','success');
   heartbeatTimer=setInterval(async()=>{
    if(currentView!=='marketAnalytics')return;
    try{const status=await request('/api/admin/market-analytics/status');if(g!==generation||currentView!=='marketAnalytics')return;lastStatus=status;const info=workerInfo(status);const badge=document.querySelector('#ma-worker-badge');if(badge){badge.className='ma-badge '+info.className;badge.textContent=info.text;document.querySelector('#ma-worker-detail').textContent=info.detail;}}catch{}
   },60000);
  }catch(error){
   if(g!==generation||currentView!=='marketAnalytics')return;
   content.innerHTML=`<div class="ma"><div class="ma-error"><h3>Market analytics needs attention</h3><p>${esc(error.message)}</p><button id="ma-retry" class="ma-button">Try again</button></div></div>`;document.querySelector('#ma-retry').onclick=loadMarket;setStatus('Could not load market report.','error');
  }
 }
})();
