const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..");
const serverPath = path.join(repoRoot, "server.js");

const checks = [
  {
    anchor: 'const analyticsRoutes = require("./analyticsRoutes");',
    addition: 'const widgetRoutes = require("./api/widgetRoutes");'
  },
  {
    anchor: 'app.use("/api/analytics", analyticsRoutes);',
    addition: 'app.use("/api/widget", widgetRoutes);'
  }
];

if (!fs.existsSync(serverPath)) {
  console.error("[WIDGET PREVIEW] server.js not found.");
  process.exit(1);
}

const source = fs.readFileSync(serverPath, "utf8");
let failed = false;

console.log("\n[WIDGET PREVIEW] No files will be changed.\n");

for (const item of checks) {
  const additionCount = source.split(item.addition).length - 1;

  if (additionCount === 1) {
    console.log(`[ALREADY PRESENT] ${item.addition}`);
    continue;
  }

  if (additionCount > 1) {
    console.error(`[ERROR] Duplicate widget line already exists (${additionCount}): ${item.addition}`);
    failed = true;
    continue;
  }

  if (!source.includes(item.anchor)) {
    console.error(`[ERROR] Current server anchor not found: ${item.anchor}`);
    failed = true;
    continue;
  }

  console.log(`[WOULD ADD AFTER]\n  ${item.anchor}\n+ ${item.addition}\n`);
}

if (failed) {
  process.exit(1);
}

console.log("[WIDGET PREVIEW] Planned server.js changes are limited to the two lines above.");