const express = require("express");
const legalAcceptanceRepository = require("./database/legalAcceptanceRepository");

const router = express.Router();

router.get("/current", async (req, res) => {
  try {
    const policies = await legalAcceptanceRepository.getCurrentPolicies();

    res.json({
      success: true,
      terms: {
        version: policies.terms.version,
        effectiveAt: policies.terms.effectiveAt,
        path: policies.terms.publicPath
      },
      privacy: {
        version: policies.privacy.version,
        effectiveAt: policies.privacy.effectiveAt,
        path: policies.privacy.publicPath
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;