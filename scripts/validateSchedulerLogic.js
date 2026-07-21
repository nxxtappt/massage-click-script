"use strict";

const assert = require("assert");
const {
  findNextOccurrence,
  isRuleDue,
  occurrenceKey,
  buildScheduleJobArgs
} = require("../schedulerV2");

const dailySchedule = {
  id: "validation-daily",
  timezone: "America/Chicago",
  calendar_rules: {
    daysOfWeek: ["MO", "TU", "WE", "TH", "FR", "SA", "SU"],
    times: ["10:15"]
  },
  scrape_options: {
    lookaheadHours: 48,
    forceRefresh: true
  }
};

const startingAtNineAmChicago = new Date("2026-07-21T14:00:00.000Z");
const nextDaily = findNextOccurrence(
  dailySchedule,
  startingAtNineAmChicago,
  []
);

assert.equal(nextDaily.toISOString(), "2026-07-21T15:15:00.000Z");
assert.equal(occurrenceKey(dailySchedule, nextDaily), "2026-07-21T10:15");
assert.equal(isRuleDue(dailySchedule, nextDaily), true);

const intervalSchedule = {
  id: "validation-interval",
  timezone: "America/Chicago",
  calendar_rules: {
    daysOfWeek: ["MO", "TU", "WE", "TH", "FR", "SA", "SU"],
    intervalMinutes: 15,
    windowStart: "08:00",
    windowEnd: "18:00"
  }
};

const nextInterval = findNextOccurrence(
  intervalSchedule,
  startingAtNineAmChicago,
  []
);
assert.equal(nextInterval.toISOString(), "2026-07-21T14:15:00.000Z");

const anchoredIntervalSchedule = {
  id: "validation-anchored-interval",
  timezone: "America/Chicago",
  calendar_rules: {
    daysOfWeek: ["MO", "TU", "WE", "TH", "FR", "SA", "SU"],
    intervalMinutes: 15,
    windowStart: "08:05",
    windowEnd: "18:00"
  }
};
const beforeAnchoredWindow = new Date("2026-07-21T13:00:00.000Z");
const nextAnchored = findNextOccurrence(
  anchoredIntervalSchedule,
  beforeAnchoredWindow,
  []
);
assert.equal(nextAnchored.toISOString(), "2026-07-21T13:05:00.000Z");

const skippedDate = findNextOccurrence(dailySchedule, startingAtNineAmChicago, [
  { exception_date: "2026-07-21", action: "skip" }
]);
assert.equal(skippedDate.toISOString(), "2026-07-22T15:15:00.000Z");

const args = buildScheduleJobArgs(dailySchedule, {
  business_name: "Deep Relief"
});
assert.deepEqual(args, [
  "--business=Deep Relief",
  "--manual=false",
  "--scheduleId=validation-daily",
  "--lookaheadHours=48",
  "--forceRefresh=true"
]);

console.log("Scheduler logic validation passed.");