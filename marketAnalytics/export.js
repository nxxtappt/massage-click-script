'use strict';
const {csvCell,html}=require('./core');
const columns=['kind','snapshot_date','captured_at','status','appointment_date','city','state','industry','confirmed_cards','inferred_only_cards','unknown_source_cards','total_cards','two_day_total','businesses_with_cards','raw_rows','timezone','note'];
function csv(data){return '\ufeff'+[columns.map(csvCell).join(','),...data.rows.map(r=>columns.map(k=>csvCell(r[k])).join(','))].join('\r\n');}
function reportHTML(data){
 const keys=['kind','snapshot_date','appointment_date','city','state','industry','confirmed_cards','inferred_only_cards','total_cards','two_day_total','businesses_with_cards','status'];
 return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>NextAppt Market Inventory Report</title>
 <style>body{font:14px system-ui;margin:32px;color:#14263a}h1{color:#126878}table{border-collapse:collapse;width:100%;font-size:11px}td,th{border-bottom:1px solid #ddd;padding:8px;text-align:left}th{background:#eaf5f5}p{line-height:1.6}footer{margin-top:24px;color:#526274}@media print{@page{size:landscape;margin:12mm}body{margin:0}thead{display:table-header-group}tr{break-inside:avoid}}</style>
 <h1>NextAppt • Market inventory</h1><p>${html(data.filters.from)} – ${html(data.filters.to)} · ${html(data.timezone)}<br>City: ${html(data.filters.city||'All')} · Industry: ${html(data.filters.industry||'All')} · Type: ${html(data.filters.kind)}</p>
 <p>${html(data.caveat)}</p><table><thead><tr>${keys.map(k=>`<th>${html(k.replaceAll('_',' '))}</th>`).join('')}</tr></thead><tbody>${data.rows.map(r=>`<tr>${keys.map(k=>`<td>${html(r[k]??'—')}</td>`).join('')}</tr>`).join('')||'<tr><td>No retained data for these filters.</td></tr>'}</tbody></table>
 <footer>${[...new Set(data.rows.map(r=>r.note))].map(n=>`<p>${html(n)}</p>`).join('')}Two-day total repeats on both forward rows; count it once per snapshot/city/industry. Businesses counts are per date and must not be summed across dates.<p>Generated ${html(new Date().toISOString())}. Definition version ${data.definitionVersion}. Open in a browser and use Print → Save as PDF.</p></footer></html>`;
}
module.exports={csv,reportHTML};
