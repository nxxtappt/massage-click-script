require('dotenv').config();
const fs=require('fs');
const path=require('path');
const db=require('../db');
(async()=>{
  try { await db.query(fs.readFileSync(path.join(__dirname,'../migrations/20261010_business_interest_notifications.sql'),'utf8')); console.log('Business interest migration complete.'); }
  catch(error) { console.error(error.message); process.exitCode=1; }
  finally { await db.pool.end(); }
})();
