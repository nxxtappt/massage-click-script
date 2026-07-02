function pad2(value) {
  return String(value).padStart(2, "0");
}

function parseTimeKey(timeKey = "") {
  const match = String(timeKey).trim().match(/^(\d{1,2}):(\d{2})$/);

  if (!match) {
    return null;
  }

  const hour = Number(match[1]);
  const minute = Number(match[2]);

  if (
    !Number.isFinite(hour) ||
    !Number.isFinite(minute) ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59
  ) {
    return null;
  }

  return {
    hour,
    minute,
    totalMinutes: hour * 60 + minute
  };
}

function minutesToTimeKey(totalMinutes) {
  const safeMinutes = Number(totalMinutes);

  if (!Number.isFinite(safeMinutes)) {
    return "";
  }

  const dayMinutes = 24 * 60;
  const normalized = ((safeMinutes % dayMinutes) + dayMinutes) % dayMinutes;

  const hour = Math.floor(normalized / 60);
  const minute = normalized % 60;

  return `${pad2(hour)}:${pad2(minute)}`;
}

function addMinutesToTimeKey(timeKey, minutesToAdd) {
  const parsed = parseTimeKey(timeKey);

  if (!parsed) {
    return "";
  }

  return minutesToTimeKey(parsed.totalMinutes + Number(minutesToAdd || 0));
}

function getEndTimeKey(startTimeKey, durationMinutes) {
  const parsed = parseTimeKey(startTimeKey);
  const duration = Number(durationMinutes || 0);

  if (!parsed || !Number.isFinite(duration) || duration <= 0) {
    return "";
  }

  return minutesToTimeKey(parsed.totalMinutes + duration);
}

function getInferredStartTimes({
  anchorStartTimeKey,
  anchorDurationMinutes,
  inferredDurationMinutes,
  intervalMinutes = 15
} = {}) {
  const start = parseTimeKey(anchorStartTimeKey);
  const anchorDuration = Number(anchorDurationMinutes || 0);
  const inferredDuration = Number(inferredDurationMinutes || 0);
  const interval = Number(intervalMinutes || 15);

  if (!start) {
    return [];
  }

  if (
    !Number.isFinite(anchorDuration) ||
    !Number.isFinite(inferredDuration) ||
    !Number.isFinite(interval) ||
    anchorDuration <= 0 ||
    inferredDuration <= 0 ||
    interval <= 0
  ) {
    return [];
  }

  if (inferredDuration > anchorDuration) {
    return [];
  }

  const latestStartOffset = anchorDuration - inferredDuration;
  const times = [];

  for (let offset = 0; offset <= latestStartOffset; offset += interval) {
    const startTimeKey = minutesToTimeKey(start.totalMinutes + offset);

    times.push({
      startTimeKey,
      endTimeKey: minutesToTimeKey(start.totalMinutes + offset + inferredDuration),
      offsetMinutes: offset,
      durationMinutes: inferredDuration
    });
  }

  return times;
}

function getInferredTimeMap({
  anchorStartTimeKey,
  anchorDurationMinutes,
  inferredDurations = [],
  intervalMinutes = 15
} = {}) {
  const uniqueDurations = [
    ...new Set(
      inferredDurations
        .map((duration) => Number(duration))
        .filter((duration) => Number.isFinite(duration) && duration > 0)
    )
  ].sort((a, b) => b - a);

  const map = {};

  uniqueDurations.forEach((duration) => {
    map[duration] = getInferredStartTimes({
      anchorStartTimeKey,
      anchorDurationMinutes,
      inferredDurationMinutes: duration,
      intervalMinutes
    });
  });

  return map;
}

function formatTimeKeyForDisplay(timeKey = "") {
  const parsed = parseTimeKey(timeKey);

  if (!parsed) {
    return "";
  }

  const suffix = parsed.hour >= 12 ? "PM" : "AM";
  const hour12 = parsed.hour % 12 || 12;

  return `${hour12}:${pad2(parsed.minute)} ${suffix}`;
}

module.exports = {
  parseTimeKey,
  minutesToTimeKey,
  addMinutesToTimeKey,
  getEndTimeKey,
  getInferredStartTimes,
  getInferredTimeMap,
  formatTimeKeyForDisplay
};