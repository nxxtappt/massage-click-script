const db = require('./db');
const businessManager = require('./businessManager');
const { Resend } = require('resend');
const crypto = require('crypto');
const { findVerifiedClaimForBusiness } = require('./businessAuthManager');

function hasPremium(business) {
  const subscription = business.subscription || business;
  return ['premium', 'premium_intel'].includes(subscription.plan || business.plan) &&
    ['active', 'trialing'].includes(String(subscription.subscriptionStatus || business.subscriptionStatus || 'active').toLowerCase());
}
function validateWindow(input, timezone = 'America/Chicago', now = new Date()) {
  const date = String(input.targetDate || '');
  const start = String(input.startTime || '');
  const end = String(input.endTime || '');
  const parsed = new Date(`${date}T12:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) throw new Error('Choose a valid date.');
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {timeZone: timezone, year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(now).map(p=>[p.type,p.value]));
  const today = `${parts.year}-${parts.month}-${parts.day}`;
  if (date < today) throw new Error('Choose today or a future date.');
  if (![start,end].every(t=>/^([01]\d|2[0-3]):[0-5]\d$/.test(t)) || start > end) throw new Error('Choose a valid time window.');
  if (date === today && end < `${parts.hour}:${parts.minute}`) throw new Error('That time window has already passed.');
  return {targetDate: date, startTime: start, endTime: end};
}
async function resolveBusinessDatabaseId(business) {
  const result = await db.query('SELECT id FROM businesses WHERE business_id=$1 AND business_name=$2 LIMIT 1',[String(business.businessId || business.id),business.businessName]);
  return Number(result.rows[0]?.id);
}
function validEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '';
}
function consumerContact(user, input) {
  if (input.shareContact !== true) throw new Error('Please agree to share your contact details with this business.');
  const contactEmail = validEmail(user.email);
  if (!contactEmail) throw new Error('A verified account email is required.');
  const contactPhone = String(input.phone || '').trim();
  const digits = contactPhone.replace(/\D/g, '');
  if (contactPhone && (contactPhone.length > 40 || !/^[+()\d\s.-]+$/.test(contactPhone) || digits.length < 7 || digits.length > 15)) {
    throw new Error('Enter a valid phone number, or leave it blank.');
  }
  return {contactEmail, contactPhone, contactConsent: true};
}
function resolveOwnerEmail(business = {}) {
  const configured = validEmail(business.ownerEmail) || validEmail(business.claimedByEmail);
  if (configured) return configured;
  const claim = findVerifiedClaimForBusiness(business);
  return validEmail(claim?.email) || validEmail(business.email) || null;
}
function queuePromptDelivery() {
  setImmediate(() => deliverBusinessInterests().catch(error => console.error('[BUSINESS INTEREST MAIL]', error.message)));
}
async function createBusinessAlert(user, input) {
  const contact = consumerContact(user, input);
  const business = await businessManager.getBusinessBySlug(String(input.businessSlug || ''));
  if (!business || business.enabled === false || !hasPremium(business) || !(business.claimed === true || ['verified','claimed_verified'].includes(business.verificationStatus))) {
    throw new Error('Business alerts require an active, verified Premium business.');
  }
  const service = (business.services || []).find(s => s.enabled !== false && String(s.businessServiceId || s.id) === String(input.businessServiceId));
  if (!service) throw new Error('Choose a service offered by this business.');
  const timezone = business.timeZone || business.timezone || business.locations?.[0]?.timezone || 'America/Chicago';
  const window = validateWindow(input, timezone);
  const businessId = await resolveBusinessDatabaseId(business);
  if (!Number.isSafeInteger(businessId) || businessId <= 0) throw new Error('Business identifier is invalid.');
  const serviceName = service.serviceName || service.name;
  const filters = {source:'business_page', businessServiceId: service.businessServiceId || service.id,
    serviceName, platformServiceId: String(service.platformServiceId || service.serviceId || service.sessionTypeId || ''),
    includeInferred: true, timezone, publicBusinessId: String(business.businessId || business.id)};
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    // Serialize repeat submissions from the same consumer and avoid duplicate emails.
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`business-interest:${user.id}`]);
    const existing = await client.query(`SELECT id FROM appointment_alerts WHERE user_id=$1 AND business_id=$2
      AND status='active' AND target_date=$3 AND start_time=$4 AND end_time=$5
      AND filters_json->>'businessServiceId'=$6 LIMIT 1`,
      [user.id,businessId,window.targetDate,window.startTime,window.endTime,String(filters.businessServiceId)]);
    if (existing.rows.length) {
      const alertId = existing.rows[0].id;
      await client.query(`UPDATE business_interest_notifications SET
        details = details || $2::jsonb || jsonb_build_object('contactRevision', CASE
          WHEN details->>'contactEmail' IS DISTINCT FROM $3 OR COALESCE(details->>'contactPhone','') IS DISTINCT FROM $4
          THEN $5::text ELSE details->>'contactRevision' END),
        email_sent_at = CASE WHEN details->>'contactEmail' IS DISTINCT FROM $3 OR COALESCE(details->>'contactPhone','') IS DISTINCT FROM $4
          THEN NULL ELSE email_sent_at END,
        next_attempt_at = NOW()
        WHERE alert_id = $1`, [alertId,JSON.stringify(contact),contact.contactEmail,contact.contactPhone,crypto.randomUUID()]);
      await client.query('COMMIT'); queuePromptDelivery();
      return {id:alertId,duplicate:true};
    }
    const result = await client.query(`INSERT INTO appointment_alerts
      (user_id,label,status,business_id,service_type,duration_minutes,category_slug,target_date,target_date_end,start_time,end_time,filters_json)
      VALUES ($1,$2,'active',$3,$4,$5,$6,$7,$7,$8,$9,$10::jsonb) RETURNING id`,
      [user.id,`${business.businessName}: ${serviceName}`.slice(0,180),businessId,service.serviceType || null,
       service.durationMinutes || null,service.categorySlug || null,window.targetDate,window.startTime,window.endTime,JSON.stringify(filters)]);
    const alertId = result.rows[0].id;
    await client.query(`UPDATE user_email_preferences SET appointment_alerts_enabled=TRUE, global_unsubscribed_at=NULL, updated_at=NOW() WHERE user_id=$1`,[user.id]);
    // Contact details are resolved on the server, never accepted from the browser.
    const ownerEmail = resolveOwnerEmail(business);
    await client.query(`INSERT INTO business_interest_notifications (alert_id,business_id,owner_email,details)
      VALUES ($1,$2,$3,$4::jsonb)`,[alertId,businessId,ownerEmail,JSON.stringify({businessName:business.businessName,serviceName,durationMinutes:service.durationMinutes,...window,timezone,...contact,contactRevision:crypto.randomUUID()})]);
    await client.query('COMMIT');
    queuePromptDelivery();
    return {id:alertId};
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
async function listBusinessInterests(businessId) {
  try {
    const result = await db.query(`SELECT id, details, created_at AS "createdAt", read_at AS "readAt", email_sent_at AS "emailSentAt", attempts, last_error AS "emailError", owner_email AS "ownerEmail"
      FROM business_interest_notifications WHERE business_id=$1 ORDER BY created_at DESC LIMIT 100`,[businessId]);
    return result.rows;
  } catch(error) {
    // Keep dashboard login available during deployment before the migration runs.
    if(error.code === '42P01') return [];
    throw error;
  }
}
async function markInterestRead(businessId, id) {
  const result = await db.query('UPDATE business_interest_notifications SET read_at=COALESCE(read_at,NOW()) WHERE business_id=$1 AND id=$2 RETURNING id',[businessId,id]);
  return result.rows.length > 0;
}
let sending = false;
async function deliverBusinessInterests() {
  if (sending) return {skipped:true};
  sending = true;
  let client;
  const summary = {checked:0,sent:0,failed:0,missingOwner:0};
  try {
    client = await db.connect();
    const locked = await client.query("SELECT pg_try_advisory_lock(hashtext('business-interest-mail')) AS locked");
    if (!locked.rows[0].locked) return {skipped:true};
    try {
      // Include requests whose original owner address was missing; resolve it again on every retry.
      const rows = await client.query(`SELECT n.*, b.business_id AS "publicBusinessId", b.business_name AS "businessName",
        b.owner_email AS "currentOwnerEmail", b.claimed_by_email AS "claimedByEmail", b.email AS "businessEmail"
        FROM business_interest_notifications n JOIN businesses b ON b.id=n.business_id
        WHERE n.email_sent_at IS NULL AND n.next_attempt_at <= NOW() ORDER BY n.next_attempt_at LIMIT 20`);
      for (const row of rows.rows) {
        summary.checked++;
        try {
          const ownerEmail = resolveOwnerEmail({businessId:row.publicBusinessId,businessName:row.businessName,
            ownerEmail:row.currentOwnerEmail,claimedByEmail:row.claimedByEmail,email:row.businessEmail});
          if (!ownerEmail) {
            summary.missingOwner++;
            throw new Error('No valid owner email is configured.');
          }
          await client.query('UPDATE business_interest_notifications SET owner_email=$2 WHERE id=$1',[row.id,ownerEmail]);
          if (!process.env.RESEND_API_KEY) throw new Error('RESEND_API_KEY is required');
          const dashboardUrl = 'https://nextappt.ai/business-dashboard#business-interests';
          const result = await new Resend(process.env.RESEND_API_KEY).emails.send({
            from:process.env.BUSINESS_INTEREST_FROM_EMAIL || process.env.BUSINESS_LOGIN_FROM_EMAIL || 'NextAppt <onboarding@resend.dev>',
            to:[ownerEmail], subject:'New consumer interest on NextAppt',
            html:`<div style="font-family:Arial,sans-serif;color:#002b49;line-height:1.6"><h2>New consumer interest</h2>
              <p>A consumer has requested an appointment with your business.</p><p>Log in to view their request and any contact details they chose to share.</p>
              <p><a href="${dashboardUrl}" style="display:inline-block;background:#0075b9;color:white;padding:12px 18px;border-radius:8px;text-decoration:none">View in your business dashboard</a></p></div>`,
            text:`A consumer has requested an appointment with your business. Log in to view their request and shared contact details: ${dashboardUrl}`
          }, {idempotencyKey:`business-interest-${row.id}-${row.details?.contactRevision || 'original'}`});
          if (result.error) throw new Error(result.error.message || 'Email delivery failed');
          if (!result.data?.id && !result.id) throw new Error('Email provider did not confirm delivery acceptance.');
          await client.query('UPDATE business_interest_notifications SET email_sent_at=NOW(),last_error=NULL WHERE id=$1',[row.id]);
          summary.sent++;
        } catch (error) {
          summary.failed++;
          await client.query(`UPDATE business_interest_notifications SET attempts=attempts+1,last_error=$2,
            next_attempt_at=NOW()+INTERVAL '5 minutes' WHERE id=$1`,[row.id,String(error.message).slice(0,500)]);
          console.error(`[BUSINESS INTEREST MAIL] Notification ${row.id}: ${error.message}`);
        }
      }
    } finally { await client.query("SELECT pg_advisory_unlock(hashtext('business-interest-mail'))"); }
  } catch (error) { summary.error=error.message; console.error('[BUSINESS INTEREST MAIL]',error.message); }
  finally { if(client) client.release(); sending=false; }
  return summary;
}
function startBusinessInterestMailer() {
  const run = () => deliverBusinessInterests().catch(error=>console.error(error.message));
  const initial = setTimeout(run,15000); initial.unref();
  const timer = setInterval(run,60000); timer.unref();
}
module.exports={hasPremium,validateWindow,createBusinessAlert,listBusinessInterests,markInterestRead,startBusinessInterestMailer,resolveBusinessDatabaseId,deliverBusinessInterests,consumerContact,resolveOwnerEmail};
