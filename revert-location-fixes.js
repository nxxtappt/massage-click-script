#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const root = path.resolve(process.cwd());
const backupBase = path.join(root, ".nextappt-location-fix-backup");
const requested = process.argv[2] ? path.resolve(process.argv[2]) : null;

function newestBackup() {
  if (!fs.existsSync(backupBase)) return null;

  const directories = fs
    .readdirSync(backupBase, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(backupBase, entry.name))
    .sort()
    .reverse();

  return directories[0] || null;
}

const backupRoot = requested || newestBackup();

if (!backupRoot || !fs.existsSync(backupRoot)) {
  console.error("No location-fix backup directory was found.");
  process.exit(1);
}

const infoPath = path.join(backupRoot, "BACKUP_INFO.json");
if (!fs.existsSync(infoPath)) {
  console.error(`Invalid backup: ${infoPath} was not found.`);
  process.exit(1);
}

const info = JSON.parse(fs.readFileSync(infoPath, "utf8"));

for (const relativePath of info.files || []) {
  const backupPath = path.join(backupRoot, relativePath);
  const destinationPath = path.join(root, relativePath);

  if (!fs.existsSync(backupPath)) {
    throw new Error(`Backup file missing: ${backupPath}`);
  }

  fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
  fs.copyFileSync(backupPath, destinationPath);
  console.log(`Restored ${relativePath}`);
}

console.log(`\nRestored backup: ${path.relative(root, backupRoot)}`);