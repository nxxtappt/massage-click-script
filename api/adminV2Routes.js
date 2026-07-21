"use strict";

const express = require("express");
const schedulerRepository = require("../database/schedulerRepository");
const scrapeJobRepository = require("../database/scrapeJobRepository");
const { listPlatformDefinitions } = require("../platformIntegrationRegistry");
const {
  runDueSchedules,
  initializeScheduleNextRun
} = require("../schedulerV2");

function asyncRoute(handler) {
  return (req, res) =>
    Promise.resolve(handler(req, res)).catch((error) => {
      console.error("[ADMIN V2 ROUTE ERROR]", error);
      const status = /required|not found|choose either|must use|must target/i.test(
        error.message
      )
        ? 400
        : 500;
      res.status(status).json({ success: false, error: error.message });
    });
}

const router = express.Router();

router.get("/integrations/platforms", (req, res) => {
  res.json({ success: true, platforms: listPlatformDefinitions() });
});

router.get(
  "/scheduler/groups",
  asyncRoute(async (req, res) => {
    res.json({ success: true, groups: await schedulerRepository.listGroups() });
  })
);

router.post(
  "/scheduler/groups",
  asyncRoute(async (req, res) => {
    const group = await schedulerRepository.saveGroup(req.body || {});
    res.json({ success: true, group });
  })
);

router.delete(
  "/scheduler/groups/:id",
  asyncRoute(async (req, res) => {
    await schedulerRepository.deleteGroup(req.params.id);
    res.json({ success: true });
  })
);

router.get(
  "/scheduler/schedules",
  asyncRoute(async (req, res) => {
    res.json({
      success: true,
      schedules: await schedulerRepository.listSchedules()
    });
  })
);

router.post(
  "/scheduler/schedules",
  asyncRoute(async (req, res) => {
    let schedule = await schedulerRepository.saveSchedule(req.body || {});
    await initializeScheduleNextRun(schedule);
    schedule = await schedulerRepository.getSchedule(schedule.id);
    res.json({ success: true, schedule });
  })
);

router.post(
  "/scheduler/schedules/:id/recalculate",
  asyncRoute(async (req, res) => {
    let schedule = await schedulerRepository.getSchedule(req.params.id);
    if (!schedule) {
      return res.status(404).json({ success: false, error: "Schedule not found." });
    }
    const nextRunAt = await initializeScheduleNextRun(schedule);
    schedule = await schedulerRepository.getSchedule(req.params.id);
    res.json({ success: true, nextRunAt, schedule });
  })
);

router.delete(
  "/scheduler/schedules/:id",
  asyncRoute(async (req, res) => {
    await schedulerRepository.deleteSchedule(req.params.id);
    res.json({ success: true });
  })
);

router.get(
  "/scheduler/exceptions",
  asyncRoute(async (req, res) => {
    res.json({
      success: true,
      exceptions: await schedulerRepository.listExceptions(
        req.query.scheduleId || null
      )
    });
  })
);

router.post(
  "/scheduler/exceptions",
  asyncRoute(async (req, res) => {
    const exception = await schedulerRepository.saveException(req.body || {});
    const schedule = await schedulerRepository.getSchedule(exception.schedule_id);
    if (schedule) await initializeScheduleNextRun(schedule);
    res.json({ success: true, exception });
  })
);

router.delete(
  "/scheduler/exceptions/:id",
  asyncRoute(async (req, res) => {
    const exception = await schedulerRepository.deleteException(req.params.id);
    if (exception?.schedule_id) {
      const schedule = await schedulerRepository.getSchedule(exception.schedule_id);
      if (schedule) await initializeScheduleNextRun(schedule);
    }
    res.json({ success: true, exception });
  })
);

router.get(
  "/scheduler/history",
  asyncRoute(async (req, res) => {
    res.json({
      success: true,
      history: await schedulerRepository.listHistory(req.query.limit)
    });
  })
);

router.get(
  "/scheduler/jobs",
  asyncRoute(async (req, res) => {
    res.json({
      success: true,
      jobs: await scrapeJobRepository.listJobs({
        status: req.query.status,
        source: req.query.source,
        scheduleId: req.query.scheduleId,
        limit: req.query.limit
      })
    });
  })
);

router.get(
  "/scheduler/jobs/:id",
  asyncRoute(async (req, res) => {
    const job = await scrapeJobRepository.getJob(req.params.id);
    if (!job) {
      return res.status(404).json({ success: false, error: "Scrape job not found." });
    }
    res.json({ success: true, job });
  })
);

router.post(
  "/scheduler/jobs/:id/retry",
  asyncRoute(async (req, res) => {
    const job = await scrapeJobRepository.retryJob(req.params.id);
    if (!job) {
      return res.status(409).json({
        success: false,
        error: "Only failed or cancelled jobs can be retried."
      });
    }
    res.json({ success: true, job });
  })
);

router.post(
  "/scheduler/jobs/:id/cancel",
  asyncRoute(async (req, res) => {
    const job = await scrapeJobRepository.requestJobCancellation(req.params.id);
    if (!job) {
      return res.status(409).json({
        success: false,
        error: "Only queued or running jobs can be cancelled."
      });
    }
    res.json({ success: true, job });
  })
);

router.get(
  "/scheduler/health",
  asyncRoute(async (req, res) => {
    const [health, queue, workers] = await Promise.all([
      schedulerRepository.getHealth(),
      scrapeJobRepository.getQueueHealth(),
      scrapeJobRepository.listWorkers()
    ]);

    res.json({
      success: true,
      health: {
        ...health,
        ...queue,
        workers_online: workers.filter(
          (worker) => worker.effective_status !== "offline"
        ).length
      },
      queue,
      workers
    });
  })
);

router.post(
  "/scheduler/run-v2",
  asyncRoute(async (req, res) => {
    const results = await runDueSchedules({
      force: req.body?.force === true,
      requestedBy: "admin-v2"
    });
    const jobsQueued = results.reduce(
      (sum, result) => sum + Number(result.jobsQueued || 0),
      0
    );

    res.status(202).json({
      success: true,
      message: `${jobsQueued} scrape job(s) queued for the background worker.`,
      jobsQueued,
      results
    });
  })
);

module.exports = router;