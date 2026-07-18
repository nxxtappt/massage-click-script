"use strict";

const express = require("express");
const schedulerRepository = require("../database/schedulerRepository");
const { listPlatformDefinitions } = require("../platformIntegrationRegistry");
const { runDueSchedules } = require("../schedulerV2");

function asyncRoute(handler) {
  return (req, res) => Promise.resolve(handler(req, res)).catch((error) => res.status(500).json({ success: false, error: error.message }));
}

const router = express.Router();
router.get("/integrations/platforms", (req, res) => res.json({ success: true, platforms: listPlatformDefinitions() }));
router.get("/scheduler/groups", asyncRoute(async (req, res) => res.json({ success: true, groups: await schedulerRepository.listGroups() })));
router.post("/scheduler/groups", asyncRoute(async (req, res) => res.json({ success: true, group: await schedulerRepository.saveGroup(req.body || {}) })));
router.delete("/scheduler/groups/:id", asyncRoute(async (req, res) => { await schedulerRepository.deleteGroup(req.params.id); res.json({ success: true }); }));
router.get("/scheduler/schedules", asyncRoute(async (req, res) => res.json({ success: true, schedules: await schedulerRepository.listSchedules() })));
router.post("/scheduler/schedules", asyncRoute(async (req, res) => res.json({ success: true, schedule: await schedulerRepository.saveSchedule(req.body || {}) })));
router.delete("/scheduler/schedules/:id", asyncRoute(async (req, res) => { await schedulerRepository.deleteSchedule(req.params.id); res.json({ success: true }); }));
router.get("/scheduler/exceptions", asyncRoute(async (req, res) => res.json({ success: true, exceptions: await schedulerRepository.listExceptions(req.query.scheduleId || null) })));
router.post("/scheduler/exceptions", asyncRoute(async (req, res) => res.json({ success: true, exception: await schedulerRepository.saveException(req.body || {}) })));
router.delete("/scheduler/exceptions/:id", asyncRoute(async (req, res) => { await schedulerRepository.deleteException(req.params.id); res.json({ success: true }); }));
router.get("/scheduler/history", asyncRoute(async (req, res) => res.json({ success: true, history: await schedulerRepository.listHistory(req.query.limit) })));
router.get("/scheduler/health", asyncRoute(async (req, res) => res.json({ success: true, health: await schedulerRepository.getHealth() })));
router.post("/scheduler/run-v2", asyncRoute(async (req, res) => res.json({ success: true, results: await runDueSchedules({ force: req.body?.force === true }) })));

module.exports = router;