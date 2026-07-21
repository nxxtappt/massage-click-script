"use strict";

const repository = require("./database/schedulerRepository");
const scrapeJobRepository = require("./database/scrapeJobRepository");

const DEFAULT_TIMEZONE = "America/Chicago";
const MAX_LOOKAHEAD_MINUTES = 62 * 24 * 60;

const CLI_OPTION_KEYS = new Set([
  "platform",
  "service",
  "serviceType",
  "durationMinutes",
  "businessServiceId",
  "platformServiceId",
  "priority",
  "discoveryStatus",
  "latitude",
  "longitude",
  "maxDistanceMiles",
  "scrapeStartDate",
  "scrapeEndDate",
  "lookaheadHours",
  "daysForward",
  "scrapeWindowMode",
  "integrationId",
  "forceRefresh",
  "forceDirectScrape",
  "ignoreServiceRules",
  "skipVagaroDiscovery"
]);

function floorToMinute(date = new Date()) {
  return new Date(Math.floor(date.getTime() / 60000) * 60000);
}

function addMinutes(date, minutes) {
  return new Date(date.getTime() + Number(minutes || 0) * 60000);
}

function normalizeTime(value) {
  const match = String(value || "").trim().match(/^(\d{1,2}):(\d{2})/);
  if (!match) return "";
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return "";
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function localParts(date, timezone = DEFAULT_TIMEZONE) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    hourCycle: "h23"
  }).formatToParts(date);

  const map = Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value])
  );

  const hour = map.hour === "24" ? "00" : String(map.hour || "00").padStart(2, "0");
  const minute = String(map.minute || "00").padStart(2, "0");
  const weekday = String(map.weekday || "").slice(0, 2).toUpperCase();
  const dateKey = `${map.year}-${map.month}-${map.day}`;

  return {
    ...map,
    hour,
    minute,
    weekday,
    dateKey,
    timeKey: `${hour}:${minute}`
  };
}

function occurrenceKey(schedule, date = new Date()) {
  const parts = localParts(date, schedule.timezone || DEFAULT_TIMEZONE);
  return `${parts.dateKey}T${parts.timeKey}`;
}

function normalizeCalendarRules(schedule = {}) {
  const raw = schedule.calendar_rules || schedule.calendarRules || {};
  const daysOfWeek = Array.isArray(raw.daysOfWeek)
    ? raw.daysOfWeek
        .map((item) => String(item || "").slice(0, 2).toUpperCase())
        .filter(Boolean)
    : [];
  const times = Array.isArray(raw.times)
    ? raw.times.map(normalizeTime).filter(Boolean)
    : [];

  return {
    ...raw,
    daysOfWeek,
    times,
    intervalMinutes: Math.max(0, Number(raw.intervalMinutes || 0) || 0),
    windowStart: normalizeTime(raw.windowStart),
    windowEnd: normalizeTime(raw.windowEnd)
  };
}

function getExceptionTime(exception, rules) {
  const overrideTime = normalizeTime(exception?.override_time || exception?.overrideTime);
  if (overrideTime) return overrideTime;
  if (rules.times.length) return rules.times[0];
  return rules.windowStart || "00:00";
}

function isWithinTimeWindow(timeKey, rules) {
  if (rules.windowStart && timeKey < rules.windowStart) return false;
  if (rules.windowEnd && timeKey > rules.windowEnd) return false;
  return true;
}

function isRuleDue(schedule, date = new Date(), exception = null) {
  const rules = normalizeCalendarRules(schedule);
  const parts = localParts(date, schedule.timezone || DEFAULT_TIMEZONE);

  if (exception?.action === "skip") return false;

  if (exception?.action === "override") {
    return parts.timeKey === getExceptionTime(exception, rules);
  }

  if (exception?.action === "run") {
    return parts.timeKey === getExceptionTime(exception, rules);
  }

  if (rules.daysOfWeek.length && !rules.daysOfWeek.includes(parts.weekday)) {
    return false;
  }

  if (!isWithinTimeWindow(parts.timeKey, rules)) return false;

  if (rules.times.length) {
    return rules.times.includes(parts.timeKey);
  }

  if (rules.intervalMinutes > 0) {
    const minuteOfDay = Number(parts.hour) * 60 + Number(parts.minute);
    const windowStartMatch = String(rules.windowStart || "00:00").match(/^(\d{2}):(\d{2})$/);
    const anchorMinute = windowStartMatch
      ? Number(windowStartMatch[1]) * 60 + Number(windowStartMatch[2])
      : 0;
    return (minuteOfDay - anchorMinute) % rules.intervalMinutes === 0;
  }

  return parts.timeKey === "00:00";
}

function buildExceptionMap(exceptions = [], timezone = DEFAULT_TIMEZONE) {
  const map = new Map();
  for (const exception of exceptions) {
    const dateKey = String(exception.exception_date || exception.exceptionDate || "").slice(0, 10);
    if (dateKey) map.set(dateKey, exception);
  }
  return map;
}

function findNextOccurrence(
  schedule,
  afterDate = new Date(),
  exceptions = [],
  options = {}
) {
  const exceptionMap = buildExceptionMap(exceptions, schedule.timezone || DEFAULT_TIMEZONE);
  const maximumMinutes = Math.max(
    1,
    Number(options.maxLookaheadMinutes || MAX_LOOKAHEAD_MINUTES)
  );
  let candidate = addMinutes(floorToMinute(afterDate), 1);

  for (let index = 0; index < maximumMinutes; index += 1) {
    const parts = localParts(candidate, schedule.timezone || DEFAULT_TIMEZONE);
    const exception = exceptionMap.get(parts.dateKey) || null;

    if (isRuleDue(schedule, candidate, exception)) {
      return candidate;
    }

    candidate = addMinutes(candidate, 1);
  }

  throw new Error(
    `No valid occurrence found for schedule ${schedule.name || schedule.id} within ${maximumMinutes} minutes.`
  );
}

function addCliArg(args, key, value) {
  if (!CLI_OPTION_KEYS.has(key)) return;
  if (value === undefined || value === null || value === "") return;

  if (typeof value === "object") {
    throw new Error(`Schedule scrape option ${key} must be a scalar value.`);
  }

  args.push(`--${key}=${String(value)}`);
}

function buildScheduleJobArgs(schedule, business) {
  const args = [
    `--business=${business.business_name}`,
    "--manual=false",
    `--scheduleId=${schedule.id}`
  ];

  const scrapeOptions = schedule.scrape_options || schedule.scrapeOptions || {};
  for (const [key, value] of Object.entries(scrapeOptions)) {
    addCliArg(args, key, value);
  }

  return args;
}

async function getScheduleExceptions(scheduleId) {
  return repository.listExceptions(scheduleId);
}

async function queueScheduleOccurrence(schedule, occurrenceDate, options = {}) {
  const key = occurrenceKey(schedule, occurrenceDate);
  const lock = await repository.acquireScheduleLock(schedule.id, key, 120);

  if (!lock) {
    return {
      skipped: true,
      reason: "locked_or_duplicate",
      scheduleId: schedule.id,
      occurrenceKey: key,
      jobsQueued: 0
    };
  }

  let history = null;

  try {
    const businesses = await repository.resolveScheduleBusinesses(schedule);

    history = await repository.createHistory({
      scheduleId: schedule.id,
      occurrenceKey: key,
      status: businesses.length ? "queued" : "error",
      businessesSelected: businesses.length,
      jobsBuilt: 0,
      jobsRejected: 0,
      details: {
        occurrenceAt: occurrenceDate.toISOString(),
        targetType: schedule.group_id ? "group" : "business"
      }
    });

    if (!businesses.length) {
      await repository.finishHistory(history.id, {
        status: "error",
        details: { error: "Schedule resolved to zero enabled businesses." }
      });

      return {
        scheduleId: schedule.id,
        occurrenceKey: key,
        businesses: 0,
        jobsQueued: 0,
        error: "Schedule resolved to zero enabled businesses."
      };
    }

    const queuedJobs = [];
    const rejected = [];
    const scrapeOptions = schedule.scrape_options || {};

    for (const business of businesses) {
      try {
        const job = await scrapeJobRepository.enqueueJob({
          source: "scheduled",
          scriptName: "scrape.js",
          args: buildScheduleJobArgs(schedule, business),
          priority: scrapeOptions.queuePriority || 100,
          maxAttempts: scrapeOptions.maxAttempts || 3,
          timeoutSeconds: scrapeOptions.timeoutSeconds || 1800,
          scheduleId: schedule.id,
          scheduleHistoryId: history.id,
          occurrenceKey: key,
          dedupeKey: `schedule:${schedule.id}:${key}:business:${business.id}`,
          requestedBy: options.requestedBy || "scheduler",
          requestPayload: {
            scheduleId: schedule.id,
            scheduleName: schedule.name,
            businessId: business.business_id,
            businessName: business.business_name,
            occurrenceKey: key
          }
        });
        queuedJobs.push(job);
      } catch (error) {
        rejected.push({
          businessId: business.business_id,
          businessName: business.business_name,
          error: error.message
        });
      }
    }

    const acceptedJobs = queuedJobs.filter((job) => job.status !== "failed");
    const activeJobs = acceptedJobs.filter((job) =>
      ["queued", "running"].includes(job.status)
    );

    await repository.updateHistory(history.id, {
      status: acceptedJobs.length ? "queued" : "error",
      businessesSelected: businesses.length,
      jobsBuilt: acceptedJobs.length,
      jobsRejected: rejected.length,
      finished: acceptedJobs.length === 0,
      details: {
        queuedJobIds: activeJobs.map((job) => job.id),
        acceptedJobIds: acceptedJobs.map((job) => job.id),
        duplicateJobIds: acceptedJobs
          .filter((job) => job.alreadyExisted)
          .map((job) => job.id),
        rejected
      }
    });

    if (acceptedJobs.length) {
      await scrapeJobRepository.refreshScheduleHistory(history.id);
    }

    await repository.markScheduleEnqueued(
      schedule.id,
      occurrenceDate.toISOString()
    );

    return {
      scheduleId: schedule.id,
      scheduleName: schedule.name,
      occurrenceKey: key,
      businesses: businesses.length,
      jobsQueued: activeJobs.length,
      jobsAccepted: acceptedJobs.length,
      jobsRejected: rejected.length,
      jobIds: acceptedJobs.map((job) => job.id)
    };
  } catch (error) {
    if (history) {
      await repository.finishHistory(history.id, {
        status: "error",
        details: { error: error.message, stack: error.stack }
      }).catch(() => null);
    }
    await repository.markScheduleError(schedule.id, error.message).catch(() => null);
    throw error;
  } finally {
    await repository.releaseScheduleLock(schedule.id, key).catch(() => null);
  }
}

async function initializeScheduleNextRun(schedule, now = new Date()) {
  const exceptions = await getScheduleExceptions(schedule.id);
  const currentMinute = floorToMinute(now);
  const currentParts = localParts(currentMinute, schedule.timezone || DEFAULT_TIMEZONE);
  const exceptionMap = buildExceptionMap(exceptions);
  const exception = exceptionMap.get(currentParts.dateKey) || null;

  const next = isRuleDue(schedule, currentMinute, exception)
    ? currentMinute
    : findNextOccurrence(schedule, currentMinute, exceptions);

  await repository.updateNextRun(schedule.id, next.toISOString());
  return next;
}

async function runDueSchedules(options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  const schedules = options.force === true
    ? await repository.listEnabledSchedules()
    : await repository.getDueSchedules(now);
  const results = [];

  for (const schedule of schedules) {
    try {
      const exceptions = await getScheduleExceptions(schedule.id);
      let occurrenceDate = null;

      if (options.force === true) {
        occurrenceDate = floorToMinute(now);
      } else if (schedule.next_run_at) {
        occurrenceDate = floorToMinute(new Date(schedule.next_run_at));
      } else {
        const currentMinute = floorToMinute(now);
        const parts = localParts(currentMinute, schedule.timezone || DEFAULT_TIMEZONE);
        const exception = buildExceptionMap(exceptions).get(parts.dateKey) || null;

        if (isRuleDue(schedule, currentMinute, exception)) {
          occurrenceDate = currentMinute;
        } else {
          const next = findNextOccurrence(schedule, currentMinute, exceptions);
          await repository.updateNextRun(schedule.id, next.toISOString());
          results.push({
            scheduleId: schedule.id,
            scheduleName: schedule.name,
            skipped: true,
            reason: "not_due",
            nextRunAt: next.toISOString(),
            jobsQueued: 0
          });
          continue;
        }
      }

      if (!Number.isFinite(occurrenceDate?.getTime())) {
        throw new Error("Schedule occurrence date is invalid.");
      }

      if (options.force !== true && occurrenceDate.getTime() > now.getTime()) {
        continue;
      }

      const occurrenceParts = localParts(
        occurrenceDate,
        schedule.timezone || DEFAULT_TIMEZONE
      );
      const occurrenceException = buildExceptionMap(exceptions).get(
        occurrenceParts.dateKey
      ) || null;

      if (
        options.force !== true &&
        !isRuleDue(schedule, occurrenceDate, occurrenceException)
      ) {
        const next = findNextOccurrence(schedule, now, exceptions);
        await repository.updateNextRun(schedule.id, next.toISOString());
        results.push({
          scheduleId: schedule.id,
          scheduleName: schedule.name,
          skipped: true,
          reason: occurrenceException?.action === "skip"
            ? "schedule_exception"
            : "rules_changed",
          nextRunAt: next.toISOString(),
          jobsQueued: 0
        });
        continue;
      }

      const result = await queueScheduleOccurrence(schedule, occurrenceDate, {
        requestedBy: options.requestedBy || "scheduler"
      });
      results.push(result);

      // Availability scrapes should not replay every missed interval after an
      // outage. Queue one catch-up occurrence, then advance to the first valid
      // occurrence after the current time.
      const nextBase = occurrenceDate.getTime() < now.getTime()
        ? now
        : occurrenceDate;
      const next = findNextOccurrence(schedule, nextBase, exceptions);
      await repository.updateNextRun(schedule.id, next.toISOString());
      result.nextRunAt = next.toISOString();
    } catch (error) {
      await repository.markScheduleError(schedule.id, error.message).catch(() => null);
      results.push({
        scheduleId: schedule.id,
        scheduleName: schedule.name,
        error: error.message,
        jobsQueued: 0
      });
    }
  }

  return results;
}

if (require.main === module) {
  runDueSchedules()
    .then((results) => console.log(JSON.stringify(results, null, 2)))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}

module.exports = {
  runDueSchedules,
  queueScheduleOccurrence,
  initializeScheduleNextRun,
  isRuleDue,
  occurrenceKey,
  findNextOccurrence,
  localParts,
  normalizeCalendarRules,
  buildScheduleJobArgs
};