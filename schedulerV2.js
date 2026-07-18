"use strict";

const { spawn } = require("child_process");
const repository = require("./database/schedulerRepository");
const businessManager = require("./businessManager");
const { buildScrapeJobs, validateScrapeJob } = require("./jobBuilder");

function localParts(date, timezone) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, weekday: "short", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(date);
  return Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
}

function occurrenceKey(schedule, date = new Date()) {
  const parts = localParts(date, schedule.timezone || "America/Chicago");
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

function isRuleDue(schedule, date = new Date()) {
  const rules = schedule.calendar_rules || schedule.calendarRules || {};
  const parts = localParts(date, schedule.timezone || "America/Chicago");
  const day = String(parts.weekday || "").slice(0, 2).toUpperCase();
  const allowedDays = Array.isArray(rules.daysOfWeek) ? rules.daysOfWeek.map((item) => String(item).slice(0, 2).toUpperCase()) : [];
  if (allowedDays.length && !allowedDays.includes(day)) return false;
  const times = Array.isArray(rules.times) ? rules.times : [];
  if (times.length) return times.includes(`${parts.hour}:${parts.minute}`);
  const intervalMinutes = Number(rules.intervalMinutes || 0);
  if (intervalMinutes > 0) {
    const minuteOfDay = Number(parts.hour) * 60 + Number(parts.minute);
    return minuteOfDay % intervalMinutes === 0;
  }
  return true;
}

async function getScheduleException(schedule, date = new Date()) {
  const parts = localParts(date, schedule.timezone || "America/Chicago");
  const dateKey = `${parts.year}-${parts.month}-${parts.day}`;
  const exceptions = await repository.listExceptions(schedule.id);
  return exceptions.find((item) => String(item.exception_date).slice(0, 10) === dateKey) || null;
}

function nextMinute(date = new Date()) {
  return new Date(Math.floor(date.getTime() / 60000) * 60000 + 60000);
}

function toCliArgs(job, schedule) {
  const args = ["scrape.js", `--business=${job.businessName}`, `--service=${job.serviceName}`, `--durationMinutes=${job.durationMinutes}`, "--manual=false", `--scheduleId=${schedule.id}`, `--integrationId=${job.integrationId || ""}`];
  const options = schedule.scrape_options || {};
  Object.entries(options).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") args.push(`--${key}=${value}`);
  });
  return args;
}

function runJob(job, schedule) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, toCliArgs(job, schedule), { stdio: "inherit", env: process.env });
    child.on("exit", (code) => resolve({ code: code || 0, job }));
    child.on("error", (error) => resolve({ code: 1, error: error.message, job }));
  });
}

async function executeSchedule(schedule, options = {}) {
  const now = options.now || new Date();
  const key = occurrenceKey(schedule, now);
  const lock = await repository.acquireScheduleLock(schedule.id, key, 120);
  if (!lock) return { skipped: true, reason: "locked_or_duplicate", occurrenceKey: key };
  let history;
  try {
    const rows = await repository.resolveScheduleBusinesses(schedule);
    const businesses = await Promise.all(rows.map((row) => businessManager.getBusinessDetails(row.business_id || row.id)));
    const jobs = buildScrapeJobs(businesses.filter(Boolean), { ...(schedule.scrape_options || {}), manual: false, scheduleId: schedule.id });
    const accepted = [];
    const rejected = [];
    jobs.forEach((job) => {
      const validation = validateScrapeJob(job);
      (validation.valid ? accepted : rejected).push(validation.valid ? job : { job, validation });
    });
    history = await repository.createHistory({ scheduleId: schedule.id, occurrenceKey: key, businessesSelected: businesses.length, jobsBuilt: accepted.length, jobsRejected: rejected.length, details: { rejected } });
    const results = [];
    for (const job of accepted) results.push(await runJob(job, schedule));
    const failed = results.filter((result) => result.code !== 0);
    await repository.finishHistory(history.id, { status: failed.length ? "partial_error" : "success", details: { results } });
    await repository.updateNextRun(schedule.id, nextMinute(now).toISOString());
    return { occurrenceKey: key, businesses: businesses.length, jobs: accepted.length, rejected: rejected.length, failed: failed.length };
  } catch (error) {
    if (history) await repository.finishHistory(history.id, { status: "error", details: { error: error.message, stack: error.stack } });
    throw error;
  } finally {
    await repository.releaseScheduleLock(schedule.id, key);
  }
}

async function runDueSchedules(options = {}) {
  const now = options.now || new Date();
  const schedules = await repository.getDueSchedules(now);
  const results = [];
  for (const schedule of schedules) {
    const exception = await getScheduleException(schedule, now);
    if (exception?.action === "skip" && options.force !== true) {
      await repository.updateNextRun(schedule.id, nextMinute(now).toISOString());
      results.push({ skipped: true, reason: "schedule_exception", scheduleId: schedule.id });
      continue;
    }
    const forcedByException = exception?.action === "run" || exception?.action === "override";
    if (!forcedByException && !isRuleDue(schedule, now) && options.force !== true) {
      await repository.updateNextRun(schedule.id, nextMinute(now).toISOString());
      continue;
    }
    results.push(await executeSchedule(schedule, { now }));
  }
  return results;
}

if (require.main === module) {
  runDueSchedules().then((results) => console.log(JSON.stringify(results, null, 2))).catch((error) => { console.error(error); process.exit(1); });
}

module.exports = { runDueSchedules, executeSchedule, isRuleDue, occurrenceKey, getScheduleException };