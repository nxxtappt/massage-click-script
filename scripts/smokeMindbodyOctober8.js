"use strict";
// Reads public availability only. No appointment clicks, bookings, or database writes.
const {chromium}=require('playwright');
const presets={
 lizard90:{businessName:'Lizard Yoga',bookingUrl:'https://lizardyoga.com/appointments/',serviceName:'Massage - 90 Minutes',categoryText:'Massage',platformServiceId:'asrv_11kJBJ6Fb5ZakoaJJB',durationMinutes:90,daysForward:9},
 lizardContrast:{businessName:'Lizard Yoga',bookingUrl:'https://lizardyoga.com/appointments/',serviceName:'Contrast Therapy 1 - Infrared Sauna + Ice Bath',categoryText:'Private Sauna + Cold Plunge Suites',platformServiceId:'asrv_11kJBJ6Fb5ZakoaJtm',durationMinutes:45,daysForward:9},
 serasanaMassage:{businessName:'Serasana Dripping Springs',bookingUrl:'https://serasana.com/schedule-drippingsprings/',serviceName:'50 Min Focus Massage',categoryText:'Massage',platformServiceId:'asrv_117MGwgQgexAD5qvr5',durationMinutes:50,daysForward:11},
 serasanaAcupuncture:{businessName:'Serasana Dripping Springs',bookingUrl:'https://serasana.com/schedule-drippingsprings/',serviceName:'50 Min Private Acupuncture',categoryText:'Acupuncture',platformServiceId:'asrv_117MGwgQgexAD5qtgx',durationMinutes:50,daysForward:11}
};
async function main(){
 const preset=presets[process.argv[2]];
 if(!preset)throw new Error('Choose '+Object.keys(presets).join(', '));
 const flags=Object.fromEntries(process.argv.slice(3).map(v=>v.replace(/^--/,'').split('=')));
 const days=flags.days===undefined?preset.daysForward:Number(flags.days);
 if(!Number.isInteger(days)||days<1||days>366)throw new Error('--days must be 1–366');
 const classic=flags.scraper==='classic';
 if(flags.scraper&&!['classic','new'].includes(flags.scraper))throw new Error('--scraper must be classic or new');
 const business={...preset,daysForward:days,lookaheadHours:days*24,providerText:'First Available',platform:classic?'mindbody':'mindbody-new'};
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
 const part=k=>today.find(v=>v.type===k).value;
 business.scrapeStartDate=flags.start||`${part('year')}-${part('month')}-${part('day')}`;
 const start=new Date(business.scrapeStartDate+'T12:00:00Z');
 if(Number.isNaN(start.getTime())||start.toISOString().slice(0,10)!==business.scrapeStartDate)throw new Error('Invalid --start=YYYY-MM-DD');
 start.setUTCDate(start.getUTCDate()+days-1);business.scrapeEndDate=start.toISOString().slice(0,10);
 const scrape=classic?require('../scrapers/mindbody').scrapeMindbodyBusiness:require('../scrapers/mindbody-new').scrapeMindbodyNewBusiness;
 const browser=await chromium.launch({headless:true});
 try{
  const context=await browser.newContext({viewport:{width:1440,height:1000}});
  const result=await scrape(await context.newPage(),business,1);
  if(!classic&&result.mindbodyDaySnapshots?.length!==days)throw new Error('Incomplete scrape window');
  if(!['success','no_times_found','fully_booked'].includes(result.status))throw new Error('Unexpected status: '+result.status);
  console.log(JSON.stringify(result,null,2));
 }finally{await browser.close();}
}
main().catch(e=>{console.error(e.stack||e);process.exitCode=1;});
