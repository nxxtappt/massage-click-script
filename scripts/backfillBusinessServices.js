require("dotenv").config();

const fs = require("fs");
const path = require("path");
const BusinessRepository = require("../database/BusinessRepository");
const db = require("../db");

function loadBusinesses(filePath) {
  const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
  if (!Array.isArray(parsed)) throw new Error("The backfill source must be a JSON array.");
  return parsed;
}

async function run() {
  const sourcePath = path.resolve(process.argv[2] || path.join(__dirname, "..", "businesses.json"));
  const businesses = loadBusinesses(sourcePath);
  let businessesMatched = 0;
  let businessesSkipped = 0;
  let servicesSaved = 0;

  for (const sourceBusiness of businesses) {
    const businessName = String(sourceBusiness.businessName || sourceBusiness.name || "").trim();
    if (!businessName) continue;

    const existing =
      (await BusinessRepository.getBusinessByName(businessName)) ||
      (sourceBusiness.businessSlug
        ? await BusinessRepository.getBusinessBySlug(sourceBusiness.businessSlug)
        : null);

    if (!existing) {
      console.warn(`[BACKFILL] Skipping missing PostgreSQL business: ${businessName}`);
      businessesSkipped += 1;
      continue;
    }

    const services = Array.isArray(sourceBusiness.services) ? sourceBusiness.services : [];
    const saved = await BusinessRepository.saveServices(existing.id, {
      ...sourceBusiness,
      services
    });

    businessesMatched += 1;
    servicesSaved += saved.length;
    console.log(`[BACKFILL] ${businessName}: ${saved.length} canonical service(s)`);
  }

  console.log("\n===== BACKFILL COMPLETE =====");
  console.log({ sourcePath, businessesMatched, businessesSkipped, servicesSaved });
}

run()
  .catch((error) => {
    console.error("[BACKFILL FAILED]", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.pool.end().catch(() => null);
  });