require("dotenv").config();

const readline = require("readline");
const { saveApiCredential } = require("./apiCredentialManager");

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

rl.question("Paste Dimensions Mindbody API key: ", (apiKey) => {
  try {
    const result = saveApiCredential({
      credentialId: "dimensions-mindbody-main",
      businessId: "dimensions-massage-therapy",
      businessName: "Dimensions Massage Therapy",
      platform: "mindbody",
      label: "Primary API Key",
      credentialType: "api_key",
      value: apiKey.trim(),
      metadata: {
        siteId: "527423",
        locationId: 1
      }
    });

    console.log("Saved credential:");
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error("Failed to save credential:", error.message);
  } finally {
    rl.close();
  }
});
