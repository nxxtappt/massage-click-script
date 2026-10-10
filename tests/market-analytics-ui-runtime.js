'use strict';
const vm=require('vm'),fs=require('fs'),assert=require('assert/strict');
const helper=require('../public/market-analytics-view');
class Element{
 constructor(){this.dataset={};this.attrs={};this.listeners={};this._html='';this.textContent='';}
 addEventListener(name,fn){this.listeners[name]=fn;}appendChild(el){nav.children.push(el);}setAttribute(k,v){this.attrs[k]=v;}
 set innerHTML(v){this._html=v;if(this===content)collections={};for(const [,id] of v.matchAll(/id="([^"]+)"/g))nodes[id]=new Element();}
 get innerHTML(){return this._html;}
}
let collections={};
const nodes={},nav=new Element();nav.children=[];const button=new Element();button.parentElement=nav;
const content=new Element();const context={window:{MarketAnalyticsView:helper},console,URLSearchParams,Date,Intl,Set,Map,Promise,Number,String,
 setInterval:()=>1,clearInterval(){},currentView:'businesses',pageTitle:new Element(),pageSubtitle:new Element(),content,
 escapeHtml:v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),refreshNavButtons(){},setActiveNav(){},setStatus(){},loadView(v){context.currentView=v;content.innerHTML='Other view';},
 FormData:class{constructor(form){return Object.entries(form.values);}}
};
nav.querySelector=()=>null;
const requests=[];
context.document={createElement:()=>new Element(),querySelector:selector=>selector==='.nav-btn'?button:nodes[selector.slice(1)],querySelectorAll:selector=>{
 const key=selector.match(/data-([^\]]+)/)[1];if(collections[key])return collections[key];return collections[key]=[...content.innerHTML.matchAll(new RegExp('data-'+key+'="([^"]+)"','g'))].map(([,value])=>{const el=new Element();el.dataset[key]=value;return el;});}};
let fail=false;
context.fetch=async url=>{requests.push(url);return {ok:!fail,json:async()=>fail?{error:'DB unavailable'}:url.includes('/status')?{markets:[{city:'austin',state:'tx',industry:'massage'}],workers:[{worker_key:'scheduled-worker',heartbeat_at:new Date().toISOString()}],runs:[]}:{rows:Array.from({length:26},(_,i)=>({snapshot_date:'2026-10-09',appointment_date:'2026-10-09',city:i===0?'<script>':('austin '+i),state:'tx',industry:'massage',kind:'daily',weekday:'Monday',weekday_index:0,history_source:'Scheduled daily',historical_average:20,historical_sample_days:3,scheduled_sample_days:2,reconstructed_sample_days:1,difference_from_average:-8,percent_vs_average:-40,previous_weekday_date:'2026-10-02',previous_weekday_cards:15,previous_weekday_source:'Reconstructed',difference_from_previous:-3,percent_vs_previous:-20,confirmed_cards:'8',inferred_only_cards:'4',total_cards:'12',two_day_total:'27',businesses_with_cards:'2',status:'complete'})),weekdaySummary:[{weekday:'Monday',weekday_index:0,city:'austin',state:'tx',industry:'massage',average_cards:20,sample_days:3,scheduled_days:2,reconstructed_days:1,min_cards:12,max_cards:30}],caveat:'Retained cards'}};};
vm.createContext(context);vm.runInContext(fs.readFileSync(require('path').join(__dirname,'../public/admin-market-analytics.js'),'utf8'),context);
(async()=>{
 assert.equal(nav.children.length,1);await context.loadView('marketAnalytics');
 assert.ok(content.innerHTML.includes('Historical inventory by weekday'));assert.ok(content.innerHTML.toLowerCase().includes('&lt;script&gt;'));assert.ok(!content.innerHTML.includes('<script>'));
 assert.ok(nodes['ma-csv'].href.includes('kind=history'));assert.ok(nodes['ma-html'].href.includes('format=html'));
 assert.ok(nodes['ma-report-table'].innerHTML.includes('1–25 of 26'));nodes['ma-next'].onclick();assert.ok(nodes['ma-report-table'].innerHTML.includes('26–26 of 26'));
 const monday=context.document.querySelectorAll('[data-weekday]').find(el=>el.dataset.weekday==='0');monday.onclick();await new Promise(resolve=>setImmediate(resolve));assert.ok(nodes['ma-csv'].href.includes('weekday=0'));assert.ok(nodes['ma-report-table'].innerHTML.includes('Monday'));
 const mode=context.document.querySelectorAll('[data-mode]').find(el=>el.dataset.mode==='forward');mode.onclick();await new Promise(resolve=>setImmediate(resolve));
 assert.ok(content.innerHTML.includes('Future supply vs historical weekdays'));assert.ok(nodes['ma-csv'].href.includes('kind=forward'));assert.ok(requests.at(-1).includes('kind=forward'));assert.ok(nodes['ma-report-table'].innerHTML.includes('Weekday average'));assert.ok(nodes['ma-csv'].href.includes('/explore?'));
 nodes['ma-form'].values={from:'2026-10-01',to:'2026-10-03',city:'austin',industry:'massage'};nodes['ma-form'].onsubmit({preventDefault(){},currentTarget:nodes['ma-form']});await new Promise(resolve=>setImmediate(resolve));assert.ok(nodes['ma-csv'].href.includes('city=austin'));
 fail=true;await context.loadView('marketAnalytics');assert.ok(content.innerHTML.includes('DB unavailable'));assert.equal(typeof nodes['ma-retry'].onclick,'function');
 context.loadView('businesses');assert.equal(content.innerHTML,'Other view');
 console.log('PASS: merged history and weekday comparisons UI, escaped data, paging, mode/filter API queries, export links, error state and navigation');
})().catch(e=>{console.error(e);process.exitCode=1;});
