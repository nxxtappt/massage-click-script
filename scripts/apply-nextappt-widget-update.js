const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const repoRoot = path.resolve(__dirname, "..");
const serverPath = path.join(repoRoot, "server.js");

const REQUIRE_LINE = 'const widgetRoutes = require("./api/widgetRoutes");';
const REQUIRE_ANCHOR = 'const analyticsRoutes = require("./analyticsRoutes");';
const MOUNT_LINE = 'app.use("/api/widget", widgetRoutes);';
const MOUNT_ANCHOR = 'app.use("/api/analytics", analyticsRoutes);';

function fail(message) {
  console.error(`\n[WIDGET PATCH] ${message}\n`);
  process.exit(1);
}

function backupName() {
  const stamp = new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");

  return path.join(repoRoot, `server.js.pre-widget-${stamp}`);
}

if (!fs.existsSync(serverPath)) {
  fail(`server.js was not found at ${serverPath}`);
}

const requiredWidgetFiles = [
  "widgetManager.js",
  path.join("api", "widgetRoutes.js"),
  path.join("public", "nextappt-widget.js")
];

for (const relativePath of requiredWidgetFiles) {
  const fullPath = path.join(repoRoot, relativePath);

  if (!fs.existsSync(fullPath)) {
    fail(`Required widget file is missing before server patch: ${relativePath}`);
  }

  const check = spawnSync(process.execPath, ["--check", fullPath], {
    cwd: repoRoot,
    encoding: "utf8"
  });

  if (check.status !== 0) {
    fail(`Syntax check failed for ${relativePath}:\n${check.stderr || check.stdout}`);
  }
}

let source = fs.readFileSync(serverPath, "utf8");

const requirePresent = source.includes(REQUIRE_LINE);
const mountPresent = source.includes(MOUNT_LINE);

if (requirePresent && mountPresent) {
  console.log("[WIDGET PATCH] Widget server integration is already installed.");
  process.exit(0);
}

if (!requirePresent && !source.includes(REQUIRE_ANCHOR)) {
  fail(`Could not find current server require anchor: ${REQUIRE_ANCHOR}`);
}

if (!mountPresent && !source.includes(MOUNT_ANCHOR)) {
  fail(`Could not find current server mount anchor: ${MOUNT_ANCHOR}`);
}

const backupPath = backupName();
fs.copyFileSync(serverPath, backupPath);
console.log(`[WIDGET PATCH] Backup created: ${backupPath}`);

if (!requirePresent) {
  source = source.replace(
    REQUIRE_ANCHOR,
    `${REQUIRE_ANCHOR}\n${REQUIRE_LINE}`
  );
  console.log("[WIDGET PATCH] Added widget route require.");
}

if (!mountPresent) {
  source = source.replace(
    MOUNT_ANCHOR,
    `${MOUNT_ANCHOR}\n${MOUNT_LINE}`
  );
  console.log("[WIDGET PATCH] Added /api/widget route mount.");
}

fs.writeFileSync(serverPath, source);
console.log("[WIDGET PATCH] server.js updated with widget-only changes.");
console.log("[WIDGET PATCH] Next run: node scripts/verify-nextappt-widget-update.js");