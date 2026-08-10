const express = require("express");
const widgetManager = require("../widgetManager");

const router = express.Router();

router.get("/:slug", async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "public, max-age=60, s-maxage=60");

  try {
    const requestedLimit = Number(req.query.limitTimes || 8);
    const limitTimes = Number.isFinite(requestedLimit)
      ? Math.max(1, Math.min(Math.floor(requestedLimit), 30))
      : 8;

    const widget = await widgetManager.getBusinessWidgetData(req.params.slug, {
      limitTimes,
      includeConfirmed:
        String(req.query.includeConfirmed || "true").toLowerCase() !== "false",
      includeInferred:
        String(req.query.includeInferred || "true").toLowerCase() !== "false"
    });

    if (!widget) {
      return res.status(404).json({
        success: false,
        error: "Business widget not found."
      });
    }

    return res.json({
      success: true,
      widget
    });
  } catch (error) {
    console.error("[WIDGET API ERROR]", error);

    return res.status(500).json({
      success: false,
      error: "Widget availability could not be loaded."
    });
  }
});

module.exports = router;