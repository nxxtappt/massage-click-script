require("dotenv").config();

const db = require("../db");

function getQuery() {
  if (typeof db.query === "function") return db.query.bind(db);
  if (db.pool && typeof db.pool.query === "function") {
    return db.pool.query.bind(db.pool);
  }
  throw new Error("db.js must export query() or pool.query().");
}

const query = getQuery();

async function main() {
  const columns = await query(
    `
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'businesses'
        AND column_name IN ('logo_url', 'logo_alt')
      ORDER BY column_name
    `
  );

  console.log("Branding columns:");
  console.table(columns.rows);

  const result = await query(
    `
      SELECT
        b.business_name,
        b.business_id,
        b.logo_url,
        b.logo_alt,
        bs.plan,
        COALESCE(bs.subscription_status, bs.status, 'active') AS subscription_status,
        bs.booking_integration
      FROM businesses b
      LEFT JOIN business_subscriptions bs
        ON bs.business_id = b.id
      WHERE LOWER(b.business_name) = LOWER($1)
      LIMIT 1
    `,
    [process.argv[2] || "Dimensions Massage Therapy"]
  );

  if (!result.rows.length) {
    throw new Error("Business was not found.");
  }

  const row = result.rows[0];
  const widget = row.booking_integration || {};

  console.log("\nBusiness branding and widget:");
  console.table([
    {
      businessName: row.business_name,
      businessId: row.business_id,
      logoUrl: row.logo_url || "",
      logoAlt: row.logo_alt || "",
      plan: row.plan || "",
      subscriptionStatus: row.subscription_status || "",
      widgetEnabled: widget.enabled === true,
      widgetProvider: widget.provider || "",
      widgetType: widget.widgetType || widget.type || "",
      hasEmbedCode: Boolean(widget.embedCode || widget.code || widget.html),
      iframeUrl: widget.iframeUrl || widget.widgetUrl || "",
      bookingUrl: widget.bookingUrl || widget.url || ""
    }
  ]);
}

main()
  .catch((error) => {
    console.error("Verification failed:", error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (db.pool && typeof db.pool.end === "function") {
      await db.pool.end().catch(() => {});
    }
  });