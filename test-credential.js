require("dotenv").config();

const {
  getDecryptedApiCredential
} = require("./apiCredentialManager");

const c = getDecryptedApiCredential("dimensions-mindbody-main");

console.log({
  credentialId: c.credentialId,
  platform: c.platform,
  siteId: c.metadata.siteId,
  hasValue: Boolean(c.value)
});
