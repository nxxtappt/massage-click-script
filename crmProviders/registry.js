"use strict";

// Each new CRM contributes a scoped adapter: normalizeInput, verifyCredentials,
// getBookableItems/fetchAvailability, and an inventory mapper. Never claim a
// provider is connected just because a token was stored.
const adapters = new Map();
const mindbody = require("./mindbody");
adapters.set(mindbody.provider, mindbody);

function getAdapter(provider) {
  const adapter = adapters.get(String(provider || "").trim().toLowerCase());
  if (!adapter) throw new Error(`No live availability adapter is installed for ${provider || "this CRM"}.`);
  return adapter;
}

function listAdapters() {
  return [...adapters.values()].map(({ provider, label, fields }) => ({ provider, label, fields }));
}

module.exports = { getAdapter, listAdapters };
