#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const roots = process.argv.slice(2);
const targets = roots.length ? roots : ["public/admin.js"];

const replacements = new Map([
  ["â€”", "-"],
  ["â€“", "-"],
  ["â€˜", "'"],
  ["â€™", "'"],
  ["â€œ", '"'],
  ["â€", '"'],
  ["â€¢", "-"],
  ["Â·", " - "],
  ["Â", ""]
]);

function walk(targetPath) {
  const stat = fs.statSync(targetPath);

  if (stat.isDirectory()) {
    return fs.readdirSync(targetPath)
      .flatMap((name) => walk(path.join(targetPath, name)));
  }

  return [targetPath];
}

let changedFiles = 0;

for (const root of targets) {
  const absolute = path.resolve(process.cwd(), root);

  if (!fs.existsSync(absolute)) {
    console.warn(`Skipping missing path: ${absolute}`);
    continue;
  }

  for (const file of walk(absolute)) {
    if (!/\.(js|html|css|txt|md)$/i.test(file)) continue;

    const original = fs.readFileSync(file, "utf8");
    let updated = original;

    for (const [bad, good] of replacements) {
      updated = updated.split(bad).join(good);
    }

    if (updated !== original) {
      fs.writeFileSync(`${file}.before-encoding-cleanup`, original, "utf8");
      fs.writeFileSync(file, updated, "utf8");
      changedFiles += 1;
      console.log(`Cleaned: ${path.relative(process.cwd(), file)}`);
    }
  }
}

console.log(`Changed ${changedFiles} file(s).`);