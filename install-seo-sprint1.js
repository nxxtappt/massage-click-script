const fs = require("fs");
const path = require("path");

const projectRoot = process.cwd();
const serverPath = path.join(projectRoot, "server.js");
const sourceModulePath = path.join(__dirname, "seoRoutes.js");
const targetModulePath = path.join(projectRoot, "seoRoutes.js");

if (!fs.existsSync(serverPath)) {
  throw new Error(`server.js was not found in ${projectRoot}`);
}

if (!fs.existsSync(sourceModulePath)) {
  throw new Error("seoRoutes.js is missing from the update package.");
}

let server = fs.readFileSync(serverPath, "utf8");
const originalServer = server;

const requireLine = 'const seoRoutes = require("./seoRoutes");';
if (!server.includes(requireLine)) {
  const anchor = 'const path = require("path");';
  if (!server.includes(anchor)) {
    throw new Error('Could not find const path = require("path"); in server.js');
  }
  server = server.replace(anchor, `${anchor}\n${requireLine}`);
}

const mountLine = "app.use(seoRoutes);";
if (!server.includes(mountLine)) {
  const preferredAnchor = 'app.use("/api/ai", aiSearchRoutes);';
  const fallbackAnchor = 'app.use(express.json({ limit: "10mb" }));';
  const anchor = server.includes(preferredAnchor) ? preferredAnchor : fallbackAnchor;

  if (!server.includes(anchor)) {
    throw new Error("Could not find a safe Express middleware insertion point.");
  }

  server = server.replace(anchor, `${anchor}\n${mountLine}`);
}

if (server !== originalServer) {
  const backupPath = path.join(projectRoot, "server.js.pre-seo-backup");
  if (!fs.existsSync(backupPath)) {
    fs.writeFileSync(backupPath, originalServer, "utf8");
  }
  fs.writeFileSync(serverPath, server, "utf8");
}

fs.copyFileSync(sourceModulePath, targetModulePath);

console.log("NextAppt SEO Sprint 1 routes installed.");
console.log("Updated: server.js");
console.log("Added: seoRoutes.js");
console.log("Backup: server.js.pre-seo-backup (created once)");