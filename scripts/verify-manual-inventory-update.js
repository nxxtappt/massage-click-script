const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const repoRoot = path.resolve(__dirname, "..");

const requiredFiles = [
  "adminManualInventoryRoutes.js",
  path.join("database", "manualInventoryRepository.js"),
  path.join("public", "admin-manual-inventory.js"),
  path.join("public", "admin-manual-inventory.css"),
  path.join("db", "migrations", "016_manual_inventory_admin.sql"),
  path.join("scripts", "run-manual-inventory-migration.js")
];

function fail(message) {
  console.error(`\n[MANUAL INVENTORY VERIFY] ${message}\n`);
  process.exit(1);
}

function read(relativePath) {
  const filePath = path.join(repoRoot, relativePath);
  if (!fs.existsSync(filePath)) fail(`Missing required file: ${relativePath}`);
  return fs.readFileSync(filePath, "utf8");
}

for (const relativePath of requiredFiles) {
  read(relativePath);
}

const adminRoutes = read("adminRoutes.js");
const adminHtml = read(path.join("public", "admin.html"));
const inventoryRepository = read(path.join("database", "inventoryRepository.js"));
const migration = read(path.join("db", "migrations", "016_manual_inventory_admin.sql"));

const checks = [
  [
    adminRoutes.includes('const manualInventoryRoutes = require("./adminManualInventoryRoutes");'),
    "adminRoutes.js is missing the manual inventory route require."
  ],
  [
    adminRoutes.includes('router.use("/inventory", manualInventoryRoutes);'),
    "adminRoutes.js is missing /inventory route mounting."
  ],
  [
    adminHtml.includes("/admin-manual-inventory.css"),
    "public/admin.html is missing manual inventory CSS."
  ],
  [
    adminHtml.includes("/admin-manual-inventory.js"),
    "public/admin.html is missing manual inventory JS."
  ],
  [
    inventoryRepository.includes("findProtectedManualInventoryDuplicate"),
    "inventoryRepository.js is missing protected duplicate suppression."
  ],
  [
    inventoryRepository.includes("scrape_overwrite_protected"),
    "inventoryRepository.js is missing scrape overwrite protection persistence/reconciliation."
  ],
  [
    migration.includes("ADD COLUMN IF NOT EXISTS scrape_overwrite_protected"),
    "Migration 016 does not create scrape_overwrite_protected."
  ]
];

for (const [ok, message] of checks) {
  if (!ok) fail(message);
}

const syntaxFiles = [
  "adminRoutes.js",
  "adminManualInventoryRoutes.js",
  path.join("database", "inventoryRepository.js"),
  path.join("database", "manualInventoryRepository.js"),
  path.join("public", "admin-manual-inventory.js"),
  path.join("scripts", "run-manual-inventory-migration.js")
];

for (const relativePath of syntaxFiles) {
  const result = spawnSync(process.execPath, ["--check", path.join(repoRoot, relativePath)], {
    cwd: repoRoot,
    encoding: "utf8"
  });

  if (result.status !== 0) {
    fail(`Syntax check failed for ${relativePath}:\n${result.stderr || result.stdout}`);
  }
}

console.log("[MANUAL INVENTORY VERIFY] Code integration checks passed.");
console.log("[MANUAL INVENTORY VERIFY] Verify DB migration with:");
console.log("  node scripts/run-manual-inventory-migration.js");