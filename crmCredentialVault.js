"use strict";
const crypto = require("crypto");

const KEY_VERSION = "v2";

function getKey() {
  const raw = process.env.NEXTAPPT_CREDENTIALS_KEY || "";
  if (!/^[A-Za-z0-9+/]{43}=$/.test(raw)) {
    throw new Error("NEXTAPPT_CREDENTIALS_KEY must be a base64-encoded 32-byte key.");
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) throw new Error("NEXTAPPT_CREDENTIALS_KEY must decode to 32 bytes.");
  return key;
}

function associatedData({ credentialId, publicBusinessId, provider }) {
  if (!credentialId || !publicBusinessId || !provider) {
    throw new Error("Credential binding (ID, business, provider) is required.");
  }
  return Buffer.from(JSON.stringify([credentialId, publicBusinessId, provider]), "utf8");
}

function encryptCredential(value, binding) {
  if (typeof value !== "string" || !value.trim()) throw new Error("API key is required.");
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", getKey(), iv);
  cipher.setAAD(associatedData(binding));
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return {
    encryptedValue: encrypted.toString("base64"),
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
    keyVersion: KEY_VERSION
  };
}

function decryptCredential(payload, binding) {
  if (payload.keyVersion !== KEY_VERSION) throw new Error("Unsupported CRM credential key version.");
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm", getKey(), Buffer.from(payload.iv, "base64")
  );
  decipher.setAAD(associatedData(binding));
  decipher.setAuthTag(Buffer.from(payload.authTag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(payload.encryptedValue, "base64")), decipher.final()
  ]).toString("utf8");
}

module.exports = { encryptCredential, decryptCredential, getKey };
