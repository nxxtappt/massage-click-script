/* Dedicated admin view; no public-search changes. */
(() => {
 'use strict';
 const esc=escapeHtml;
 const nav=document.querySelector('.nav-btn')?.parentElement;
 if(!nav)return;
 const button=document.createElement('button');
 button.className='nav-btn';button.type='button';button.dataset.view='marketAnalytics';button.textContent='Market Analytics';nav.appendChild(button);
 refreshNavButtons();button.addEventListener('click',()=>loadView('marketAnalytics'));
 const original=loadView;
 loadView=function(view){return view==='marketAnalytics'?loadMarket():original(view);};
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 const day=n=>new Date(Date.parse(today)+n*86400000).toISOString().slice(0,10);
 let filters={from:day(-30),to:day(2),kind:'daily',city:'',industry:''};
 let generation=0;
 const style=document.createElement('style');style.textContent=`
 .ma-toolbar{display:flex;gap:12px;flex-wrap:wrap;align-items:end;margin:20px 0}.ma-toolbar label{display:grid;gap:5px;font-size:13px}.ma-toolbar input,.ma-toolbar select{padding:9px;border:1px solid #b9cbd2;border-radius:7px}.ma-table{border-collapse:collapse;width:100%;font-size:12px}.ma-table td,.ma-table th{padding:10px;text-align:left;border-bottom:1px solid #dce4e8}.ma-info{padding:16px;background:#eef7f8;border-radius:10px;line-height:1.6}.ma-actions{display:flex;gap:14px;margin:18px 0;flex-wrap:wrap}.ma-overflow{overflow:auto}.ma-warn{color:#8a4e00}.ma-health{margin:14px 0;font-size:13px}`;document.head.appendChild(style);
 async function request(url){const r=await fetch(url,{credentials:'same-origin'});const data=await r.json();if(!r.ok)throw new Error(data.error||'Request failed');return data;}
 async function loadMarket(){
  const g=++generation;currentView='marketAnalytics';setActiveNav(currentView);
  pageTitle.textContent='Market Analytics';pageSubtitle.textContent='Inventory by city and industry • America/Chicago';
  setLoading('Loading inventory snapshots…');
  try{
   const [status,data]=await Promise.all([request('/api/admin/market-analytics/status'),request('/api/admin/market-analytics/report?'+new URLSearchParams(filters))]);
   if(g!==generation||currentView!=='marketAnalytics')return;
   const cities=[...new Set(status.markets.map(m=>m.city))];const industries=[...new Set(status.markets.map(m=>m.industry))];
   const options=(arr,value)=>'<option value="">All</option>'+arr.map(v=>`<option value="${esc(v)}" ${v===value?'selected':''}>${esc(v)}</option>`).join('');
   const heartbeat=status.workers[0];const healthy=heartbeat&&Date.now()-Date.parse(heartbeat.heartbeat_at)<180000&&!heartbeat.last_error;
   const cols=['snapshot_date','appointment_date','city','state','industry','confirmed_cards','inferred_only_cards','total_cards','two_day_total','businesses_with_cards','status'];
   content.innerHTML=`<div class="ma-info"><strong>Two scheduled measurements</strong><br>11 p.m.: retained past cards for that calendar day.<br>1 p.m.: tomorrow and the day after, with a combined two-day total.<br>Historical backfill is reconstructed and kept separate. ${esc(data.caveat)}</div>
   <div class="ma-health ${healthy?'':'ma-warn'}">Worker: ${healthy?'running':'not healthy / not started'} · Last heartbeat: ${esc(heartbeat?.heartbeat_at||'none')}<br>${esc(heartbeat?.last_error||'')}</div>
   <form id="ma-form" class="ma-toolbar">
   <label>Appointment dates from<input name="from" type="date" value="${esc(filters.from)}" required></label>
   <label>Through<input name="to" type="date" value="${esc(filters.to)}" required></label>
   <label>Measurement<select name="kind">${[['daily','11 p.m. daily snapshots'],['forward','1 p.m. next two days'],['backfill','Reconstructed history']].map(([k,v])=>`<option value="${k}" ${k===filters.kind?'selected':''}>${v}</option>`).join('')}</select></label>
   <label>City<select name="city">${options(cities,filters.city)}</select></label><label>Industry<select name="industry">${options(industries,filters.industry)}</select></label>
   <button class="primary-btn" type="submit">Build report</button></form>
   <div class="ma-actions"><a id="ma-csv">Download CSV</a><a id="ma-html">Download printable report</a></div>
   <p>Printable reports can be saved as PDF from your browser. Downloads contain market aggregates, without business names or booking URLs.</p>
   <div class="ma-overflow"><table class="ma-table"><thead><tr>${cols.map(k=>`<th>${esc(k.replaceAll('_',' '))}</th>`).join('')}</tr></thead><tbody>${data.rows.slice(0,500).map(r=>`<tr>${cols.map(k=>`<td>${esc(r[k]??'—')}</td>`).join('')}</tr>`).join('')||`<tr><td colspan="11">No retained data for this report. Missing data is not a measured zero.</td></tr>`}</tbody></table></div>
   <p>${data.rows.length>500?'Showing first 500 rows; downloads include all matching rows.':''} Two-day totals repeat for each date; count them once per snapshot and market.</p>
   <details><summary>Collection status and historical setup</summary><p>Backfill runs once during installation and can resume safely. Historical offers cannot recreate past 1 p.m./11 p.m. snapshots. No demand alerts are generated from supply alone.</p>
   ${status.runs.map(r=>`<p>${esc(r.snapshot_date)} · ${esc(r.kind)} · ${esc(r.status)} · captured ${esc(r.captured_at)}<br>${esc(r.note)}</p>`).join('')||'<p>No snapshots yet.</p>'}</details>`;
   document.getElementById('ma-form').addEventListener('submit',event=>{event.preventDefault();filters=Object.fromEntries(new FormData(event.currentTarget));loadMarket();});
   for(const format of ['csv','html'])document.getElementById('ma-'+format).href='/api/admin/market-analytics/report?'+new URLSearchParams({...filters,format});
   setStatus('Market report ready.','success');
  }catch(e){if(currentView==='marketAnalytics'&&g===generation){content.innerHTML=`<p>${esc(e.message)}</p>`;setStatus('Market analytics unavailable.','error');}}
 }
})();
