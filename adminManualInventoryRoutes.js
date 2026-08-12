const express = require("express");
const businessManager = require("./businessManager");
const manualInventoryRepository = require("./database/manualInventoryRepository");

const router = express.Router();
const MAX_BATCH_ROWS = 2000;

function cleanText(value, maxLength = 500) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function cleanBoolean(value) {
  return value === true || value === "true";
}

function normalizeIdList(value = []) {
  return [
    ...new Set(
      (Array.isArray(value) ? value : [])
        .map((item) => String(item || "").trim())
        .filter((item) => /^\d+$/.test(item))
    )
  ];
}

function normalizeSlots(value = []) {
  const slots = [];
  const seen = new Set();

  for (const rawSlot of Array.isArray(value) ? value : []) {
    const date = cleanText(rawSlot?.date, 10);
    const time = cleanText(rawSlot?.time, 5);

    if (
      !manualInventoryRepository.isValidDateKey(date) ||
      !manualInventoryRepository.isValidTimeKey(time)
    ) {
      const error = new Error(`Invalid appointment slot: ${date} ${time}`);
      error.statusCode = 400;
      throw error;
    }

    const key = `${date}|${time}`;
    if (seen.has(key)) continue;

    seen.add(key);
    slots.push({ date, time });
  }

  return slots;
}

function getServiceId(service = {}) {
  return String(service.businessServiceId || service.id || "").trim();
}

router.get("/manual", async (req, res) => {
  try {
    const result = await manualInventoryRepository.listManualInventory({
      business: cleanText(req.query.business || req.query.businessName, 300),
      date: cleanText(req.query.date, 10),
      protection: cleanText(req.query.protection, 40),
      limit: req.query.limit
    });

    res.json({
      success: true,
      source: "postgres",
      ...result
    });
  } catch (error) {
    console.error("[ADMIN MANUAL INVENTORY LIST ERROR]", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post("/manual", async (req, res) => {
  try {
    const body = req.body || {};
    const businessId = cleanText(body.businessId || body.businessName, 300);
    const serviceIds = normalizeIdList(body.serviceIds);
    const slots = normalizeSlots(body.slots);
    const protectFromScrape = cleanBoolean(
      body.protectFromScrape ?? body.scrapeOverwriteProtected
    );

    if (!businessId) {
      return res.status(400).json({
        success: false,
        error: "businessId is required."
      });
    }

    if (!serviceIds.length) {
      return res.status(400).json({
        success: false,
        error: "Select at least one configured business service."
      });
    }

    if (!slots.length) {
      return res.status(400).json({
        success: false,
        error: "Add at least one appointment date and time."
      });
    }

    if (serviceIds.length * slots.length > MAX_BATCH_ROWS) {
      return res.status(400).json({
        success: false,
        error: `Manual inventory batches are limited to ${MAX_BATCH_ROWS} appointment rows.`
      });
    }

    const business = await businessManager.getBusinessDetails(businessId);

    if (!business) {
      return res.status(404).json({
        success: false,
        error: "Business not found."
      });
    }

    const availableServices = Array.isArray(business.services)
      ? business.services
      : [];

    const serviceMap = new Map(
      availableServices
        .map((service) => [getServiceId(service), service])
        .filter(([id]) => Boolean(id))
    );

    const services = [];

    for (const serviceId of serviceIds) {
      const service = serviceMap.get(serviceId);

      if (!service) {
        return res.status(400).json({
          success: false,
          error: `Business service ${serviceId} does not belong to ${business.businessName}.`
        });
      }

      if (service.enabled === false) {
        return res.status(400).json({
          success: false,
          error: `Service is disabled: ${service.serviceName || serviceId}`
        });
      }

      services.push(service);
    }

    const result = await manualInventoryRepository.createManualInventoryBatch({
      business,
      services,
      slots,
      protectFromScrape
    });

    res.status(201).json({
      success: true,
      source: "postgres",
      businessId: business.businessId || business.id,
      businessName: business.businessName,
      protectFromScrape,
      ...result
    });
  } catch (error) {
    console.error("[ADMIN MANUAL INVENTORY CREATE ERROR]", error);
    res.status(error.statusCode || 500).json({
      success: false,
      error: error.message
    });
  }
});

router.post("/manual/protection", async (req, res) => {
  try {
    const ids = normalizeIdList(req.body?.ids).slice(0, 1000);
    const protectedValue = cleanBoolean(
      req.body?.protected ?? req.body?.scrapeOverwriteProtected
    );

    if (!ids.length) {
      return res.status(400).json({
        success: false,
        error: "Select at least one manual inventory row."
      });
    }

    const result = await manualInventoryRepository.setManualInventoryProtection(
      ids,
      protectedValue
    );

    res.json({
      success: true,
      source: "postgres",
      protected: protectedValue,
      ...result
    });
  } catch (error) {
    console.error("[ADMIN MANUAL INVENTORY PROTECTION ERROR]", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post("/manual/delete", async (req, res) => {
  try {
    const ids = normalizeIdList(req.body?.ids).slice(0, 1000);

    if (!ids.length) {
      return res.status(400).json({
        success: false,
        error: "Select at least one manual inventory row."
      });
    }

    const result = await manualInventoryRepository.deleteManualInventory(ids);

    res.json({
      success: true,
      source: "postgres",
      ...result
    });
  } catch (error) {
    console.error("[ADMIN MANUAL INVENTORY DELETE ERROR]", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;