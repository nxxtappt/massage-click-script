require('dotenv').config();
const db=require('../db');
const {deliverBusinessInterests}=require('../businessInterestAlerts');
(async()=>{
 try {
  console.log('Email configuration:',{apiKeyConfigured:Boolean(process.env.RESEND_API_KEY),senderConfigured:Boolean(process.env.BUSINESS_INTEREST_FROM_EMAIL || process.env.BUSINESS_LOGIN_FROM_EMAIL)});
  const state=await db.query(`SELECT COUNT(*)::int AS total,
    COUNT(*) FILTER (WHERE email_sent_at IS NOT NULL)::int AS sent,
    COUNT(*) FILTER (WHERE email_sent_at IS NULL)::int AS pending,
    COUNT(*) FILTER (WHERE email_sent_at IS NULL AND last_error IS NOT NULL)::int AS deliveryErrors
    FROM business_interest_notifications`);
  console.log('Owner notification queue:',state.rows[0]);
  if(process.argv.includes('--retry')){
   await db.query('UPDATE business_interest_notifications SET next_attempt_at=NOW() WHERE email_sent_at IS NULL');
   const result=await deliverBusinessInterests();console.log('Retry result:',result);
   if(result.error || result.failed)process.exitCode=1;
  }
 } catch(error){console.error(error.message);process.exitCode=1;}
 finally{await db.pool.end();}
})();
