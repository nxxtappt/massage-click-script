const db = require("../db");

const PLANS = new Set(["verified_free", "premium", "premium_intel"]);
const STATUSES = new Set(["new", "contacted", "closed"]);

async function registerInterest({ businessKey, businessName, email, plan }) {
  if (!PLANS.has(plan)) throw new Error("Invalid billing plan.");
  const { rows } = await db.query(
    `INSERT INTO billing_leads (business_key, business_name, contact_email, requested_plan)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (business_key, requested_plan) DO UPDATE SET
       business_name = EXCLUDED.business_name,
       contact_email = EXCLUDED.contact_email,
       status = 'new',
       click_count = billing_leads.click_count + 1,
       last_clicked_at = NOW(),
       updated_at = NOW()
     RETURNING id, requested_plan, status, click_count, last_clicked_at`,
    [businessKey, businessName, email, plan]
  );
  return rows[0];
}

async function listLeads({ status = "", limit = 100 } = {}) {
  if (status && !STATUSES.has(status)) throw new Error("Invalid lead status.");
  const { rows } = await db.query(
    `SELECT id, business_key, business_name, contact_email, requested_plan,
            status, click_count, created_at, last_clicked_at, updated_at
       FROM billing_leads
      WHERE ($1::text = '' OR status = $1::text)
      ORDER BY CASE WHEN status = 'new' THEN 0 ELSE 1 END,
               last_clicked_at DESC
      LIMIT $2::integer`,
    [status, Math.min(200, Math.max(1, Number(limit) || 100))]
  );
  const count = await db.query(
    "SELECT COUNT(*)::integer AS count FROM billing_leads WHERE status = 'new'"
  );
  return { leads: rows, newCount: count.rows[0].count };
}

async function setLeadStatus(id, status) {
  if (!Number.isSafeInteger(Number(id)) || Number(id) < 1 || !STATUSES.has(status)) {
    throw new Error("Invalid lead update.");
  }
  const { rows } = await db.query(
    `UPDATE billing_leads SET status = $2, updated_at = NOW()
     WHERE id = $1 RETURNING id, status`,
    [Number(id), status]
  );
  return rows[0] || null;
}

module.exports = { registerInterest, listLeads, setLeadStatus };
