const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const CREDENTIALS_DIR = path.join(__dirname, "secure");
const CREDENTIALS_FILE = path.join(CREDENTIALS_DIR, "api-credentials.json");

const ALGORITHM = "aes-256-gcm";
const KEY_VERSION = "v1";

function ensureStorageExists() {
  if (!fs.existsSync(CREDENTIALS_DIR)) {
    fs.mkdirSync(CREDENTIALS_DIR, { recursive: true });
  }

  if (!fs.existsSync(CREDENTIALS_FILE)) {
    fs.writeFileSync(CREDENTIALS_FILE, JSON.stringify([], null, 2));
  }
}

function getMasterKey() {
  const rawKey = process.env.NEXTAPPT_MASTER_KEY;

  if (!rawKey) {
    throw new Error(
      "Missing NEXTAPPT_MASTER_KEY environment variable. Do not store API credentials until this is set."
    );
  }

  const keyBuffer = Buffer.from(rawKey, "base64");

  if (keyBuffer.length !== 32) {
    throw new Error(
      "NEXTAPPT_MASTER_KEY must be a base64-encoded 32-byte key."
    );
  }

  return keyBuffer;
}

function loadCredentials() {
  ensureStorageExists();

  try {
    const raw = fs.readFileSync(CREDENTIALS_FILE, "utf8");
    const parsed = JSON.parse(raw);

    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.error("[CREDENTIALS] Failed to load credentials:", error.message);
    return [];
  }
}

function saveCredentials(credentials) {
  ensureStorageExists();
  fs.writeFileSync(CREDENTIALS_FILE, JSON.stringify(credentials, null, 2));
}

function encryptValue(plainText) {
  if (!plainText || typeof plainText !== "string") {
    throw new Error("Cannot encrypt empty credential value.");
  }

  const key = getMasterKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([
    cipher.update(plainText, "utf8"),
    cipher.final()
  ]);

  const authTag = cipher.getAuthTag();

  return {
    encryptedValue: encrypted.toString("base64"),
    iv: iv.toString("base64"),
    authTag: authTag.toString("base64"),
    keyVersion: KEY_VERSION
  };
}

function decryptValue(encryptedPayload) {
  if (
    !encryptedPayload ||
    !encryptedPayload.encryptedValue ||
    !encryptedPayload.iv ||
    !encryptedPayload.authTag
  ) {
    throw new Error("Invalid encrypted credential payload.");
  }

  const key = getMasterKey();

  const decipher = crypto.createDecipheriv(
    ALGORITHM,
    key,
    Buffer.from(encryptedPayload.iv, "base64")
  );

  decipher.setAuthTag(Buffer.from(encryptedPayload.authTag, "base64"));

  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encryptedPayload.encryptedValue, "base64")),
    decipher.final()
  ]);

  return decrypted.toString("utf8");
}

function saveApiCredential(options = {}) {
  const {
    credentialId,
    businessId = "",
    businessName = "",
    platform,
    label = "Primary API Key",
    credentialType = "api_key",
    value,
    metadata = {}
  } = options;

  if (!credentialId) {
    throw new Error("credentialId is required.");
  }

  if (!platform) {
    throw new Error("platform is required.");
  }

  if (!value) {
    throw new Error("credential value is required.");
  }

  const credentials = loadCredentials();
  const now = new Date().toISOString();

  const encryptedPayload = encryptValue(value);

  const safeCredential = {
    credentialId,
    businessId,
    businessName,
    platform,
    label,
    credentialType,
    encryptedValue: encryptedPayload.encryptedValue,
    iv: encryptedPayload.iv,
    authTag: encryptedPayload.authTag,
    keyVersion: encryptedPayload.keyVersion,
    metadata,
    createdAt: now,
    updatedAt: now
  };

  const existingIndex = credentials.findIndex(
    (item) => item.credentialId === credentialId
  );

  if (existingIndex >= 0) {
    safeCredential.createdAt = credentials[existingIndex].createdAt || now;
    credentials[existingIndex] = safeCredential;
  } else {
    credentials.push(safeCredential);
  }

  saveCredentials(credentials);

  console.log(`[CREDENTIALS] Saved encrypted credential: ${credentialId}`);

  return {
    credentialId,
    businessId,
    businessName,
    platform,
    label,
    credentialType,
    keyVersion: safeCredential.keyVersion,
    createdAt: safeCredential.createdAt,
    updatedAt: safeCredential.updatedAt,
    metadata
  };
}

function getApiCredentialRecord(credentialId) {
  if (!credentialId) {
    throw new Error("credentialId is required.");
  }

  const credentials = loadCredentials();

  return credentials.find((item) => item.credentialId === credentialId) || null;
}

function getDecryptedApiCredential(credentialId) {
  const record = getApiCredentialRecord(credentialId);

  if (!record) {
    throw new Error(`Credential not found: ${credentialId}`);
  }

  const value = decryptValue({
    encryptedValue: record.encryptedValue,
    iv: record.iv,
    authTag: record.authTag
  });

  return {
    credentialId: record.credentialId,
    businessId: record.businessId,
    businessName: record.businessName,
    platform: record.platform,
    label: record.label,
    credentialType: record.credentialType,
    value,
    metadata: record.metadata || {},
    keyVersion: record.keyVersion,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt
  };
}

function listApiCredentialSummaries() {
  return loadCredentials().map((record) => ({
    credentialId: record.credentialId,
    businessId: record.businessId,
    businessName: record.businessName,
    platform: record.platform,
    label: record.label,
    credentialType: record.credentialType,
    keyVersion: record.keyVersion,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    metadata: record.metadata || {}
  }));
}

function deleteApiCredential(credentialId) {
  if (!credentialId) {
    throw new Error("credentialId is required.");
  }

  const credentials = loadCredentials();
  const filtered = credentials.filter(
    (item) => item.credentialId !== credentialId
  );

  saveCredentials(filtered);

  console.log(`[CREDENTIALS] Deleted credential: ${credentialId}`);

  return {
    deleted: credentials.length !== filtered.length,
    credentialId
  };
}

module.exports = {
  saveApiCredential,
  getApiCredentialRecord,
  getDecryptedApiCredential,
  listApiCredentialSummaries,
  deleteApiCredential,
  encryptValue,
  decryptValue
};