const path = require("path");
const fs = require("fs");

const STORAGE_ROOT =
  process.env.STORAGE_ROOT ||
  path.join(__dirname, "storage");

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function storagePath(...parts) {
  const fullPath = path.join(STORAGE_ROOT, ...parts);
  ensureDir(path.dirname(fullPath));
  return fullPath;
}

function readJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) {
    return fallback;
  }

  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    console.error(
      `[STORAGE] Failed to read ${filePath}:`,
      error.message
    );

    return fallback;
  }
}

function writeJsonAtomic(filePath, data) {
  ensureDir(path.dirname(filePath));

  const tempPath = `${filePath}.tmp`;

  fs.writeFileSync(
    tempPath,
    JSON.stringify(data, null, 2),
    "utf8"
  );

  fs.renameSync(tempPath, filePath);
}

module.exports = {
  STORAGE_ROOT,
  ensureDir,
  storagePath,
  readJson,
  writeJsonAtomic
};