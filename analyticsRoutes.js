const express = require("express");

const {
  logAppointmentClick,
  getAppointmentClicks
} = require("./analyticsManager");

const router = express.Router();

router.get("/health", (req, res) => {
  res.json({
    success: true,
    message: "analyticsRoutes.js loaded"
  });
});

router.post("/appointment-click", (req, res) => {
  try {
    const click = logAppointmentClick(req.body || {}, {
      userAgent: req.headers["user-agent"] || "",
      referrer: req.headers.referer || "",
      ipAddress: req.ip || ""
    });

    res.json({
      success: true,
      click
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

router.get("/appointment-clicks", (req, res) => {
  try {
    const clicks = getAppointmentClicks({
      businessName: req.query.businessName || ""
    });

    res.json({
      success: true,
      totalClicks: clicks.length,
      clicks
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;