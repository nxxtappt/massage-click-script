const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const repoRoot = path.resolve(__dirname, "..");
const requiredFiles = [
  "server.js",
  "widgetManager.js",
  path.join("api", "widgetRoutes.js"),
  path.join("public", "nextappt-widget.js")
];

let failed = false;

for (const relativePath of requiredFiles) {
  const fullPath = path.join(repoRoot, relativePath);

  if (!fs.existsSync(fullPath)) {
    console.error(`[VERIFY] Missing: ${relativePath}`);
    failed = true;
    continue;
  }

  const check = spawnSync(process.execPath, ["--check", fullPath], {
    cwd: repoRoot,
    encoding: "utf8"
  });

  if (check.status !== 0) {
    console.error(`[VERIFY] Syntax failed: ${relativePath}`);
    console.error(check.stderr || check.stdout);
    failed = true;
  } else {
    console.log(`[VERIFY] Syntax OK: ${relativePath}`);
  }
}

const serverPath = path.join(repoRoot, "server.js");

if (fs.existsSync(serverPath)) {
  const server = fs.readFileSync(serverPath, "utf8");
  const markers = [
    'const widgetRoutes = require("./api/widgetRoutes");',
    'app.use("/api/widget", widgetRoutes);'
  ];

  for (const marker of markers) {
    const count = server.split(marker).length - 1;

    if (count !== 1) {
      console.error(`[VERIFY] Expected exactly one server marker (${count} found): ${marker}`);
      failed = true;
    } else {
      console.log(`[VERIFY] Found exactly one server marker: ${marker}`);
    }
  }
}

if (failed) {
  console.error("\n[VERIFY] Widget update verification FAILED.\n");
  process.exit(1);
}

console.log("\n[VERIFY] Widget update is structurally ready.\n");
console.log(
  'After deployment test: curl -sS "https://nextappt.ai/api/widget/dimensions-massage-therapy?limitTimes=8" | jq .'
);