"use strict";
require("dotenv").config();
const db = require("../db");

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required; use Render Shell or configured Codespace.");
  const businessName = String(process.argv[2] || "Dimensions Massage Therapy").trim();
  const { rows: businesses } = await db.query(
    "SELECT id, business_id, business_name FROM businesses WHERE LOWER(business_name)=LOWER($1) LIMIT 1",
    [businessName]
  );
  const business = businesses[0];
  if (!business) throw new Error("Business not found in PostgreSQL.");
  const [subscription, integrations, services] = await Promise.all([
    db.query("SELECT plan, subscription_status FROM business_subscriptions WHERE business_id=$1 LIMIT 1", [business.id]),
    db.query(
      `SELECT i.id, i.platform, i.integration_type, i.api_provider, i.credential_id,
              i.is_default, i.enabled, i.status,
              c.status AS credential_status, c.verified_at
         FROM business_integrations i
         LEFT JOIN crm_credentials c ON c.business_id=i.business_id AND c.credential_id=i.credential_id
        WHERE i.business_id=$1 ORDER BY i.is_default DESC, i.priority ASC, i.id ASC`,
      [business.id]
    ),
    db.query(
      `SELECT service_name, session_type_id, platform_service_id, enabled
         FROM business_services WHERE business_id=$1 ORDER BY service_name`,
      [business.id]
    )
  ]);
  console.log(JSON.stringify({
    business: { businessId: business.business_id, businessName: business.business_name },
    subscription: subscription.rows[0] || null,
    integrations: integrations.rows,
    services: services.rows,
    unmappedServices: services.rows.filter((service) => service.enabled &&
      !(Number.isSafeInteger(Number(service.session_type_id || service.platform_service_id))
        && Number(service.session_type_id || service.platform_service_id) > 0))
      .map((service) => service.service_name)
  }, null, 2));
  console.log("No API keys or decrypted credentials were read by this check.");
}

main()
  .catch((error) => { console.error(error.message); process.exitCode = 1; })
  .finally(() => db.pool.end());
