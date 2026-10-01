"use strict";
// Read-only availability test: no database writes, slot selection, or cart actions.
const { chromium } = require("playwright");
const { scrapeMindbodyNewBusiness } = require("../scrapers/mindbody-new");
const presets = {
  "generator90": {businessName:"Generator Athlete Lab",bookingUrl:"https://www.generatorathletelab.com/book-treatment-session",serviceName:"Massage Therapy - 90 minutes",categoryText:"Massage",durationMinutes:90},
  "generator60": {businessName:"Generator Athlete Lab",bookingUrl:"https://www.generatorathletelab.com/book-treatment-session",serviceName:"Massage Therapy - 60 minutes",categoryText:"Massage",durationMinutes:60},
  "mantra120": {businessName:"Mantra Wellness",bookingUrl:"https://mantrawellness.co/pages/massage",serviceName:"Customized Massage - 120min",categoryText:"MASSAGE - CUSTOMIZED MASSAGE",durationMinutes:120}
};
async function main() {
  const name=process.argv[2]||"generator90";
  if(!presets[name]) throw new Error("Choose generator90, generator60, or mantra120");
  const browser=await chromium.launch({headless:true});
  try {
    const context=await browser.newContext({viewport:{width:1440,height:1000}});
    const page=await context.newPage();
    const result=await scrapeMindbodyNewBusiness(page,{...presets[name],platform:"mindbody-new",daysForward:9,providerText:"First Available",...(process.env.MINDBODY_START_DATE?{scrapeStartDate:process.env.MINDBODY_START_DATE}:{})});
    console.log(JSON.stringify(result,null,2));
  } finally {await browser.close();}
}
main().catch(error=>{console.error(error.stack||error);process.exitCode=1;});
