const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const {
  storagePath,
  writeJsonAtomic
} = require("./storagePaths");

const LOGIN_CODES_FILE = storagePath(
  "secure",
  "business-login-codes.json"
);

const SESSIONS_FILE = storagePath(
  "secure",
  "business-sessions.json"
);

const CLAIMS_FILE = storagePath(
  "secure",
  "business-claims.json"
);

const SESSION_TTL_HOURS = 24 * 7;
const LOGIN_CODE_TTL_MINUTES = 1440;

function ensureFile(filePath) {
  const dir = path.dirname(filePath);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, JSON.stringify([], null, 2));
  }
}

function loadJson(filePath) {
  ensureFile(filePath);

  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    console.error(`[AUTH] Failed loading ${filePath}`, error.message);
    return [];
  }
}

function saveJson(filePath, value) {
  ensureFile(filePath);

  writeJsonAtomic(filePath, value);
}

function normalizeEmail(email) {
  return String(email || "")
    .trim()
    .toLowerCase();
}

function generateCode() {
  return String(
    Math.floor(100000 + Math.random() * 900000)
  );
}

function generateToken() {
  return crypto.randomUUID();
}

function loadClaims() {
  return loadJson(CLAIMS_FILE);
}

function loadLoginCodes() {
  return loadJson(LOGIN_CODES_FILE);
}

function saveLoginCodes(codes) {
  saveJson(LOGIN_CODES_FILE, codes);
}

function loadSessions() {
  return loadJson(SESSIONS_FILE);
}

function saveSessions(sessions) {
  saveJson(SESSIONS_FILE, sessions);
}

function findVerifiedClaimByEmail(email) {
  const normalizedEmail = normalizeEmail(email);

  return loadClaims().find((claim) => {
    return (
      normalizeEmail(claim.email) === normalizedEmail &&
      claim.status === "claimed_verified"
    );
  });
}

function cleanupExpiredCodes() {
  const now = Date.now();

  const validCodes = loadLoginCodes().filter((code) => {
    return new Date(code.expiresAt).getTime() > now;
  });

  saveLoginCodes(validCodes);

  return validCodes;
}

function cleanupExpiredSessions() {
  const now = Date.now();

  const validSessions = loadSessions().filter((session) => {
    return new Date(session.expiresAt).getTime() > now;
  });

  saveSessions(validSessions);

  return validSessions;
}

function createLoginCode(email) {
  const verifiedClaim = findVerifiedClaimByEmail(email);

  if (!verifiedClaim) {
    throw new Error(
      "No verified business account found for this email."
    );
  }

  const codes = cleanupExpiredCodes();

  const loginCode = {
    loginCodeId: crypto.randomUUID(),
    email: normalizeEmail(email),
    businessId: verifiedClaim.businessId,
    businessName: verifiedClaim.businessName,
    code: generateCode(),
    createdAt: new Date().toISOString(),
    expiresAt: new Date(
      Date.now() + LOGIN_CODE_TTL_MINUTES * 60 * 1000
    ).toISOString(),
    used: false
  };

  codes.unshift(loginCode);

  saveLoginCodes(codes);

  return loginCode;
}

function verifyLoginCode({ email, code }) {
  const normalizedEmail = normalizeEmail(email);

  const codes = cleanupExpiredCodes();

  const loginCode = codes.find((item) => {
    return (
      normalizeEmail(item.email) === normalizedEmail &&
      String(item.code) === String(code) &&
      item.used !== true
    );
  });

  if (!loginCode) {
    throw new Error("Invalid or expired login code.");
  }

  loginCode.used = true;
  loginCode.usedAt = new Date().toISOString();

  saveLoginCodes(codes);

  return createSession({
    email: loginCode.email,
    businessId: loginCode.businessId,
    businessName: loginCode.businessName
  });
}

function createSession({
  email,
  businessId,
  businessName
}) {
  const sessions = cleanupExpiredSessions();

  const session = {
    sessionId: crypto.randomUUID(),
    token: generateToken(),
    email: normalizeEmail(email),
    businessId,
    businessName,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(
      Date.now() + SESSION_TTL_HOURS * 60 * 60 * 1000
    ).toISOString()
  };

  sessions.unshift(session);

  saveSessions(sessions);

  return session;
}

function validateSession(token) {
  if (!token) return null;

  const sessions = cleanupExpiredSessions();

  return (
    sessions.find((session) => {
      return session.token === token;
    }) || null
  );
}

function destroySession(token) {
  const sessions = loadSessions();

  const filtered = sessions.filter((session) => {
    return session.token !== token;
  });

  saveSessions(filtered);

  return true;
}

module.exports = {
  createLoginCode,
  verifyLoginCode,
  validateSession,
  destroySession,
  findVerifiedClaimByEmail
};