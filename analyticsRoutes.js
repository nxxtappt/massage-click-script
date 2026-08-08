const express = require("express");
const {
  logAppointmentClick,
  getAppointmentClicks,
  trackPageView,
  heartbeat
} = require("./analyticsManager");

const router = express.Router();

function getRequestMeta(req) {
  return {
    userAgent: req.headers["user-agent"] || "",
    referrer: req.headers.referer || ""
  };
}

function isLikelyBot(req) {
  const userAgent = String(req.headers["user-agent"] || "").toLowerCase();
  return /bot|crawler|spider|slurp|bingpreview|facebookexternalhit|headlesschrome/.test(userAgent);
}

router.get("/health", (req, res) => {
  res.json({ success: true, message: "PostgreSQL analytics loaded" });
});

router.post("/page-view", async (req, res) => {
  try {
    if (isLikelyBot(req)) return res.json({ success: true, ignored: true });
    const pageView = await trackPageView(req.body || {}, getRequestMeta(req));
    res.json({ success: true, pageView });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

router.post("/heartbeat", async (req, res) => {
  try {
    if (isLikelyBot(req)) return res.json({ success: true, ignored: true });
    await heartbeat(req.body || {}, getRequestMeta(req));
    res.json({ success: true });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

router.post("/appointment-click", async (req, res) => {
  try {
    const click = await logAppointmentClick(req.body || {}, getRequestMeta(req));
    res.json({ success: true, click });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get("/appointment-clicks", async (req, res) => {
  try {
    const clicks = await getAppointmentClicks({
      businessName: req.query.businessName || "",
      days: req.query.days || 30,
      limit: req.query.limit || 100
    });
    res.json({ success: true, totalClicks: clicks.length, clicks });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;