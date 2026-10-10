'use strict';
const router=require('express').Router();
const service=require('../marketAnalytics/service');
const {csv,reportHTML}=require('../marketAnalytics/export');
// Mounted only behind the server's existing /api/admin authentication.
router.use((req,res,next)=>{res.set('Cache-Control','no-store');next();});
router.get('/status',async(req,res)=>{
 try{res.json(await service.health());}
 catch(e){console.error('[market analytics]',e.message);res.status(503).json({error:'Analytics is unavailable. Run the analytics migration and check the worker logs.'});}
});
router.get('/report',async(req,res)=>{
 try{
  const data=await service.report(req.query);
  if(req.query.format==='csv')return res.type('text/csv').attachment('nextappt-market-inventory.csv').send(csv(data));
  if(req.query.format==='html')return res.type('text/html').attachment('nextappt-market-inventory.html').send(reportHTML(data));
  return res.json(data);
 }catch(e){
  console.error('[market analytics report]',e.message);
  const validation=/Choose a range|Use a valid|Invalid report|Report too large/.test(e.message);
  res.status(validation?400:503).json({error:validation?e.message:'Report unavailable. Check analytics migration and worker status.'});
 }
});
router.get('/explore',async(req,res)=>{
 try{
  const data=await require('../marketAnalytics/weekdayReports').explore(req.query);
  const exports=require('../marketAnalytics/weekdayExport');
  if(req.query.format==='csv')return res.type('text/csv').attachment('nextappt-weekday-inventory.csv').send(exports.csv(data));
  if(req.query.format==='html')return res.type('text/html').attachment('nextappt-weekday-inventory.html').send(exports.reportHTML(data));
  res.json(data);
 }catch(e){
  console.error('[market analytics weekday report]',e.message);
  const validation=/Choose a date range|Use a valid|Invalid measurement|Invalid weekday|Invalid history|Report too large/.test(e.message);
  res.status(validation?400:503).json({error:validation?e.message:'Weekday report unavailable. Check the web-service logs.'});
 }
});
module.exports=router;
