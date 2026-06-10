const chrono = require("chrono-node");

function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function inferServiceCategory(text = "") {
  const normalized = normalize(text);

  const serviceMap = [
    {
      key: "swedish",
      aliases: ["swedish"]
    },

    {
      key: "deep_tissue",
      aliases: ["deep tissue", "deep"]
    },

    {
      key: "sports",
      aliases: ["sports", "sport"]
    },

    {
      key: "prenatal",
      aliases: [
        "prenatal",
        "pregnancy",
        "pregnant"
      ]
    },

    {
      key: "ashiatsu",
      aliases: ["ashiatsu"]
    },

    {
      key: "lomi_lomi",
      aliases: [
        "lomi lomi",
        "lomi"
      ]
    },

    {
      key: "relaxation",
      aliases: [
        "relaxation",
        "relaxing"
      ]
    },

    {
      key: "massage",
      aliases: ["massage"]
    }
  ];

  for (const item of serviceMap) {
    const matched = item.aliases.some(
      (alias) =>
        normalized.includes(alias)
    );

    if (matched) {
      return item.key;
    }
  }

  return "";
}

function inferDurationMinutes(text = "") {
  const normalized = normalize(text);

  const match =
    normalized.match(
      /\b(30|45|50|60|75|80|90|110|120)\s*(minute|min|minutes|mins|hour|hr|hrs)?\b/
    );

  if (match) {
    const number = Number(match[1]);

    const unit =
      match[2] || "";

    if (
      unit.includes("hour") ||
      unit.includes("hr")
    ) {
      return number * 60;
    }

    return number;
  }

  if (
    /\b(one|1)\s*(hour|hr)\b/.test(
      normalized
    )
  ) {
    return 60;
  }

  if (
    /\b(two|2)\s*(hour|hr)\b/.test(
      normalized
    )
  ) {
    return 120;
  }

  return null;
}

function buildDateKey(date) {
  if (!(date instanceof Date)) {
    return "";
  }

  const year = date.getFullYear();

  const month = String(
    date.getMonth() + 1
  ).padStart(2, "0");

  const day = String(
    date.getDate()
  ).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function inferTimeWindow(text = "") {
  const normalized = normalize(text);

  if (
    normalized.includes("now") ||
    normalized.includes("asap") ||
    normalized.includes("right now")
  ) {
    return {
      label: "next_2_hours",
      hours: 2
    };
  }

  if (
    normalized.includes("today")
  ) {
    return {
      label: "today",
      hours: 24
    };
  }

  if (
    normalized.includes("tonight")
  ) {
    return {
      label: "tonight",
      hours: 12
    };
  }

  if (
    normalized.includes("tomorrow")
  ) {
    return {
      label: "tomorrow",
      hours: 48
    };
  }

  return {
    label: "",
    hours: null
  };
}

function extractChronoDateInfo(searchText = "") {
  try {
    const parsed = chrono.parse(searchText, new Date(), {
  forwardDate: true
});

    let startDate = null;
    let endDate = null;

    if (Array.isArray(parsed) && parsed.length > 0) {
      const first = parsed[0];

      startDate = first.start ? first.start.date() : null;
      endDate = first.end ? first.end.date() : null;
    }

    const text = normalize(searchText);

    const betweenMatch = text.match(
      /\bbetween\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s+(and|to|-)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i
    );

    if (betweenMatch && startDate) {
      let startHour = Number(betweenMatch[1]);
      const startMinute = betweenMatch[2] ? Number(betweenMatch[2]) : 0;
      const startAmpm = betweenMatch[3] || betweenMatch[7];
      let endHour = Number(betweenMatch[5]);
      const endMinute = betweenMatch[6] ? Number(betweenMatch[6]) : 0;
      const endAmpm = betweenMatch[7];

      if (startAmpm === "pm" && startHour !== 12) startHour += 12;
      if (startAmpm === "am" && startHour === 12) startHour = 0;

      if (endAmpm === "pm" && endHour !== 12) endHour += 12;
      if (endAmpm === "am" && endHour === 12) endHour = 0;

      startDate.setHours(startHour, startMinute, 0, 0);

      endDate = new Date(startDate);
      endDate.setHours(endHour, endMinute, 0, 0);
    }

    const afterMatch = text.match(
      /\bafter\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i
    );

    if (afterMatch && startDate) {
      let hour = Number(afterMatch[1]);
      const minute = afterMatch[2] ? Number(afterMatch[2]) : 0;
      const ampm = afterMatch[3];

      if (ampm === "pm" && hour !== 12) hour += 12;
      if (ampm === "am" && hour === 12) hour = 0;

      startDate.setHours(hour, minute, 0, 0);
    }

    const beforeMatch = text.match(
      /\bbefore\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i
    );

    if (beforeMatch && startDate) {
      let hour = Number(beforeMatch[1]);
      const minute = beforeMatch[2] ? Number(beforeMatch[2]) : 0;
      const ampm = beforeMatch[3];

      if (ampm === "pm" && hour !== 12) hour += 12;
      if (ampm === "am" && hour === 12) hour = 0;

      endDate = new Date(startDate);
      endDate.setHours(hour, minute, 0, 0);
    }

    const startTimeKey =
      startDate && (betweenMatch || afterMatch)
        ? `${String(startDate.getHours()).padStart(2, "0")}:${String(
            startDate.getMinutes()
          ).padStart(2, "0")}`
        : "";

    const endTimeKey =
      endDate
        ? `${String(endDate.getHours()).padStart(2, "0")}:${String(
            endDate.getMinutes()
          ).padStart(2, "0")}`
        : "";

    return {
      targetDate: startDate,
      targetDateKey: buildDateKey(startDate),
      startTimeKey,
      endTimeKey
    };
  } catch (error) {
    console.error("[INTENT ENGINE] chrono parse failed:", error.message);

    return {
      targetDate: null,
      targetDateKey: "",
      startTimeKey: "",
      endTimeKey: ""
    };
  }
}
function removeDatePhrases(
  text = ""
) {
  return String(text || "")
    .replace(
      /\b(today|tomorrow|tonight)\b/gi,
      ""
    )

    .replace(
      /\b(after|before|between)\b.*$/gi,
      ""
    )

    .replace(
      /\b(next)\s+\w+/gi,
      ""
    )

    .replace(
      /\bmay\b\s+\d{1,2}(th|st|nd|rd)?/gi,
      ""
    )

    .replace(
      /\b\d{1,2}(:\d{2})?\s*(am|pm)\b/gi,
      ""
    )

    .replace(/\s+/g, " ")
    .trim();
}

function buildSearchIntent(
  query = {}
) {
  const rawSearch =
    String(
      query.search ||
      query.query ||
      ""
    );

  const cleanedSearch =
    removeDatePhrases(
      rawSearch
    );

  const serviceCategory =
    normalize(
      query.serviceCategory ||
      ""
    ) ||
    inferServiceCategory(
      cleanedSearch
    );

  const durationMinutes =
    query.durationMinutes
      ? Number(
          query.durationMinutes
        )
      : query.duration
        ? Number(
            query.duration
          )
        : inferDurationMinutes(
            cleanedSearch
          );

  const chronoData =
    extractChronoDateInfo(
      rawSearch
    );

  const timeWindow =
    inferTimeWindow(
      rawSearch
    );

  return {
    rawSearch,

    cleanedSearch,

    serviceCategory,

    durationMinutes,

    targetDate:
      chronoData.targetDate,

    targetDateKey:
      chronoData.targetDateKey,

    startTimeKey:
      chronoData.startTimeKey,

    endTimeKey:
      chronoData.endTimeKey,

    hours:
      timeWindow.hours,

    timeWindow:
      timeWindow.label
  };
}

module.exports = {
  buildSearchIntent,
  inferServiceCategory,
  inferDurationMinutes
};