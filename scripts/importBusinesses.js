require("dotenv").config();

const fs = require("fs");
const path = require("path");
const { saveBusinessFull } = require("../database/BusinessRepository");

async function main() {
  const filePath = path.join(process.cwd(), "businesses.json");

  if (!fs.existsSync(filePath)) {
    throw new Error("businesses.json not found in project root.");
  }

  const businesses = JSON.parse(fs.readFileSync(filePath, "utf8"));

  if (!Array.isArray(businesses)) {
    throw new Error("businesses.json must be an array.");
  }

  let imported = 0;
  let failed = 0;

  for (const business of businesses) {
    try {
      await saveBusinessFull(business);
      imported += 1;
      console.log(`[OK] ${business.businessName || business.name}`);
    } catch (error) {
      failed += 1;
      console.error(`[FAILED] ${business.businessName || business.name}: ${error.message}`);
    }
  }

  console.log("");
  console.log(`Import complete. Imported: ${imported}. Failed: ${failed}.`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Import failed:", error.message);
    process.exit(1);
  });
