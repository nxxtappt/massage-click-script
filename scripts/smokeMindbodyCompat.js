"use strict";
// Read-only widget scrape: no database imports, no appointment/cart clicks.
const {chromium} = require("playwright");
const {scrapeMindbodyBusiness} = require("../scrapers/mindbody");
const args = Object.fromEntries(process.argv.slice(2).map(arg => {
  const at = arg.indexOf("=");
  if (!arg.startsWith("--") || at < 0) throw new Error("Use --name=value arguments");
  return [arg.slice(2,at),arg.slice(at+1)];
}));
const business = {
  businessName:"Generator Athlete Lab",
  bookingUrl:"https://www.generatorathletelab.com/book-treatment-session",
  platform:"mindbody", categoryText:"Massage",
  serviceName:"Massage Therapy - 60 minutes",
  platformServiceId:"asrv_1153kMBP4YwuFQCxVN",
  providerText:"First Available", daysForward:2, timeZone:"America/Chicago",
  ...args
};
(async () => {
  const browser = await chromium.launch({headless:true,args:["--no-sandbox"]});
  try {
    const page = await browser.newPage();
    const result = await scrapeMindbodyBusiness(page,business,1);
    console.log(JSON.stringify({
      businessName:result.businessName,service:result.serviceName,status:result.status,
      scraperVersion:result.scraperVersion,
      appointments:result.appointments,days:result.mindbodyDaySnapshots
    },null,2));
  } finally {await browser.close();}
})().catch(error => {console.error(error.message);process.exitCode=1;});
