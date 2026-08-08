const express = require("express");
const { getAdminSiteAnalytics } = require("./analyticsManager");

const router = express.Router();

router.get("/", async (req, res) => {
  try {
    const analytics = await getAdminSiteAnalytics({
      days: req.query.days || 30
    });
    res.json({ success: true, analytics });
  } catch (error) {
    console.error("[ADMIN SITE ANALYTICS]", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;