const db = require("../db");

const DEFAULT_TIMEZONE = "America/Chicago";

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function toNumberOrNull(value) {
  if (value === undefined || value === null || value === "") return null;

  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function toJson(value) {
  if (value === undefined) return null;
  return value;
}

function getResultKey(result = {}) {
  return [
    result.businessName || "",
    result.platform || "",
    result.serviceName || result.service || "",
    result.serviceType || result.serviceCategory || "",
    result.durationMinutes || "",
    result.platformServiceId || result.serviceId || result.serviceButtonId || "",
    result.provider || result.providerText || ""
  ]
    .map(normalizeText)
    .join("||");
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

function parseDateKey(value) {
  if (!value) return "";

  const raw = String(value).trim();

  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return raw;
  }

  if (raw.includes("T")) {
    const datePart = raw.split("T")[0];
    if (/^\d{4}-\d{2}-\d{2}$/.test(datePart)) {
      return datePart;
    }
  }

  const parsed = new Date(raw);

  if (!Number.isNaN(parsed.getTime())) {
    return `${parsed.getFullYear()}-${pad2(parsed.getMonth() + 1)}-${pad2(
      parsed.getDate()
    )}`;
  }

  return "";
}

function parseTimeKey(value) {
  if (!value) return "";

  const raw = String(value).trim();

  const normalMatch = raw.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);

  if (normalMatch) {
    let hour = Number(normalMatch[1]);
    const minute = Number(normalMatch[2]);
    const ampm = normalMatch[3].toUpperCase();

    if (ampm === "PM" && hour !== 12) hour += 12;
    if (ampm === "AM" && hour === 12) hour = 0;

    return `${pad2(hour)}:${pad2(minute)}`;
  }

  const isoMatch = raw.match(/T(\d{1,2}):(\d{2})/);

  if (isoMatch) {
    return `${pad2(isoMatch[1])}:${pad2(isoMatch[2])}`;
  }

  const looseMatch = raw.match(/^(\d{1,2}):(\d{2})$/);

  if (looseMatch) {
    return `${pad2(looseMatch[1])}:${pad2(looseMatch[2])}`;
  }

  return "";
}

function buildAppointmentStart(appointment = {}, parentResult = {}) {
  const direct =
    appointment.appointmentStart ||
    appointment.startTime ||
    appointment.startDateTime ||
    appointment.dateTime ||
    appointment.datetime ||
    "";

  if (direct && String(direct).includes("T")) {
    return direct;
  }

  const date =
    appointment.localDateKey ||
    appointment.date ||
    appointment.appointmentDate ||
    appointment.AvailableDate ||
    parentResult.localDateKey ||
    parentResult.date ||
    "";

  const time =
    appointment.localTimeKey ||
    appointment.time ||
    appointment.appointmentTime ||
    appointment.startTime ||
    "";

  const dateKey = parseDateKey(date);
  const timeKey = parseTimeKey(time);

  if (dateKey && timeKey) {
    return `${dateKey}T${timeKey}:00`;
  }

  return direct || null;
}

function buildLocalDate(appointment = {}, parentResult = {}) {
  return (
    parseDateKey(appointment.localDateKey) ||
    parseDateKey(appointment.date) ||
    parseDateKey(appointment.appointmentDate) ||
    parseDateKey(appointment.AvailableDate) ||
    parseDateKey(appointment.startTime) ||
    parseDateKey(parentResult.localDateKey) ||
    parseDateKey(parentResult.date) ||
    null
  );
}

function buildLocalTime(appointment = {}, parentResult = {}) {
  return (
    parseTimeKey(appointment.localTimeKey) ||
    parseTimeKey(appointment.time) ||
    parseTimeKey(appointment.appointmentTime) ||
    parseTimeKey(appointment.startTime) ||
    parseTimeKey(parentResult.localTimeKey) ||
    parseTimeKey(parentResult.time) ||
    null
  );
}

function extractAppointments(result = {}) {
  const appointmentArrays = [
    result.appointments,
    result.openings,
    result.availability,
    result.results,
    result.data?.appointments,
    result.data?.openings,
    result.data?.availability
  ];

  for (const value of appointmentArrays) {
    if (Array.isArray(value) && value.length > 0) {
      return value;
    }
  }

  if (Array.isArray(result.times) && result.times.length > 0) {
    return result.times.map((time) => ({
      time,
      date: result.date || result.localDateKey || null
    }));
  }

  return [];
}

async function getTableColumns(tableName) {
  const result = await db.query(
    `
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = $1
    `,
    [tableName]
  );

  return new Set(result.rows.map((row) => row.column_name));
}

async function insertDynamic(tableName, values = {}, client = db) {
  const columns = await getTableColumns(tableName);

  const entries = Object.entries(values).filter(([key, value]) => {
    return columns.has(key) && value !== undefined;
  });

  if (!entries.length) {
    throw new Error(`[InventoryRepository] No matching columns for ${tableName}.`);
  }

  const columnNames = entries.map(([key]) => key);
  const params = entries.map(([, value]) => value);
  const placeholders = params.map((_, index) => `$${index + 1}`);

  const result = await client.query(
    `
    INSERT INTO ${tableName} (${columnNames.join(", ")})
    VALUES (${placeholders.join(", ")})
    RETURNING *
    `,
    params
  );

  return result.rows[0];
}

async function createScrapeRun(payload = {}, client = db) {
  const result = await client.query(
    `
    INSERT INTO scrape_runs (
      run_status,
      trigger_type,
      business_name,
      platform,
      service_name,
      service_type,
      duration_minutes,
      scrape_start_date,
      scrape_end_date,
      lookahead_hours,
      days_forward,
      scrape_window_mode
    )
    VALUES (
      $1, $2, $3, $4, $5, $6,
      $7, $8, $9, $10, $11, $12
    )
    RETURNING *
    `,
    [
      payload.runStatus || "running",
      payload.triggerType || "manual",
      payload.businessName || null,
      payload.platform || null,
      payload.serviceName || null,
      payload.serviceType || payload.serviceCategory || null,
      toNumberOrNull(payload.durationMinutes),
      payload.scrapeStartDate || null,
      payload.scrapeEndDate || null,
      toNumberOrNull(payload.lookaheadHours),
      toNumberOrNull(payload.daysForward),
      payload.scrapeWindowMode || null
    ]
  );

  return result.rows[0];
}

async function finishScrapeRun(id, payload = {}, client = db) {
  if (!id) return null;

  const result = await client.query(
    `
    UPDATE scrape_runs
    SET
      run_finished_at = NOW(),
      run_status = $2,
      appointments_found = $3,
      error_message = $4
    WHERE id = $1
    RETURNING *
    `,
    [
      id,
      payload.runStatus || "success",
      Number(payload.appointmentsFound || 0),
      payload.errorMessage || null
    ]
  );

  return result.rows[0] || null;
}

async function insertRawScrapeResult(payload = {}, client = db) {
  const rawJson = payload.rawResponseJson || payload.rawResult || payload;

  const result = await client.query(
    `
    INSERT INTO raw_scrape_results (
      scrape_run_id,
      business_name,
      platform,
      service_name,
      service_type,
      duration_minutes,
      scrape_start_date,
      scrape_end_date,
      raw_response_json,
      response_size_bytes,
      scraper_version
    )
    VALUES (
      $1, $2, $3, $4, $5, $6,
      $7, $8, $9, $10, $11
    )
    RETURNING *
    `,
    [
      payload.scrapeRunId || null,
      payload.businessName || null,
      payload.platform || null,
      payload.serviceName || payload.service || null,
      payload.serviceType || payload.serviceCategory || null,
      toNumberOrNull(payload.durationMinutes),
      payload.scrapeStartDate || null,
      payload.scrapeEndDate || null,
      toJson(rawJson),
      Buffer.byteLength(JSON.stringify(rawJson || {}), "utf8"),
      payload.scraperVersion || null
    ]
  );

  return result.rows[0];
}

async function insertConfirmedAppointment(payload = {}, client = db) {
  const result = await client.query(
    `
    INSERT INTO confirmed_appointments (
      scrape_run_id,
      raw_scrape_result_id,
      business_name,
      platform,
      service_name,
      service_category,
      duration_minutes,
      provider_name,
      booking_url,
      appointment_start,
      appointment_end,
      local_date,
      local_time,
      timezone,
      source_type,
      confidence
    )
    VALUES (
      $1, $2, $3, $4, $5, $6,
      $7, $8, $9, $10, $11, $12,
      $13, $14, $15, $16
    )
    RETURNING *
    `,
    [
      payload.scrapeRunId || null,
      payload.rawScrapeResultId || null,
      payload.businessName || null,
      payload.platform || null,
      payload.serviceName || payload.service || null,
      payload.serviceCategory || payload.serviceType || null,
      toNumberOrNull(payload.durationMinutes),
      payload.providerName || payload.therapistName || payload.provider || null,
      payload.bookingUrl || null,
      payload.appointmentStart,
      payload.appointmentEnd || payload.endTime || null,
      payload.localDate || null,
      payload.localTime || null,
      payload.timezone || DEFAULT_TIMEZONE,
      payload.sourceType || "confirmed",
      payload.confidence === undefined ? 1.0 : Number(payload.confidence)
    ]
  );

  return result.rows[0];
}

async function insertInventoryAppointment(payload = {}, client = db) {
  return insertDynamic(
    "appointment_inventory",
    {
      appointment_source: payload.appointmentSource || payload.sourceType || "confirmed",

      confirmed_id: payload.confirmedAppointmentId || payload.confirmedId || null,
      inferred_id: payload.inferredAppointmentId || payload.inferredId || null,

      business_name: payload.businessName || null,
      platform: payload.platform || null,
      service_name: payload.serviceName || payload.service || null,
      service_category: payload.serviceCategory || payload.serviceType || null,
      duration_minutes: toNumberOrNull(payload.durationMinutes),
      provider_name:
        payload.providerName ||
        payload.therapistName ||
        payload.provider ||
        null,
      booking_url: payload.bookingUrl || null,

      appointment_start: payload.appointmentStart || null,
      appointment_end: payload.appointmentEnd || payload.endTime || null,
      local_date: payload.localDate || null,
      local_time: payload.localTime || null,
      timezone: payload.timezone || DEFAULT_TIMEZONE,

      confidence:
        payload.confidence === undefined || payload.confidence === null
          ? 1.0
          : Number(payload.confidence),

      inventory_reason:
        payload.inventoryReason ||
        payload.reason ||
        "confirmed_scrape",

      inventory_horizon:
        payload.inventoryHorizon ||
        payload.horizon ||
        null,

      searchable:
        payload.searchable === undefined ? true : Boolean(payload.searchable)
    },
    client
  );
}

async function insertConfirmedAppointmentsFromResult(result = {}, options = {}, client = db) {
  const appointments = extractAppointments(result);
  const inserted = [];

  for (const appointment of appointments) {
    const appointmentStart = buildAppointmentStart(appointment, result);
    const localDate = buildLocalDate(appointment, result);
    const localTime = buildLocalTime(appointment, result);

    if (!appointmentStart && !localDate && !localTime) {
      continue;
    }

    const payload = {
      scrapeRunId: options.scrapeRunId || result.scrapeRunId || null,
      rawScrapeResultId: options.rawScrapeResultId || result.rawScrapeResultId || null,

      businessName: appointment.businessName || result.businessName,
      platform: appointment.platform || result.platform,
      serviceName: appointment.serviceName || appointment.service || result.serviceName || result.service,
      serviceCategory:
        appointment.serviceCategory ||
        appointment.serviceType ||
        result.serviceCategory ||
        result.serviceType,
      durationMinutes: appointment.durationMinutes || result.durationMinutes,
      providerName:
        appointment.providerName ||
        appointment.therapistName ||
        appointment.staffName ||
        appointment.employeeName ||
        appointment.provider ||
        result.provider ||
        result.providerText,
      bookingUrl: appointment.bookingUrl || result.bookingUrl,

      appointmentStart,
      appointmentEnd: appointment.appointmentEnd || appointment.endTime || null,
      localDate,
      localTime,
      timezone: appointment.timezone || result.timezone || DEFAULT_TIMEZONE,
      sourceType: "confirmed",
      confidence: 1.0,
      rawJson: appointment
    };

    const confirmed = await insertConfirmedAppointment(payload, client);

    let inventory = null;

    try {
      inventory = await insertInventoryAppointment(
        {
          ...payload,
          confirmedAppointmentId: confirmed.id,
          rawJson: appointment
        },
        client
      );
    } catch (error) {
      console.warn(
        "[InventoryRepository] appointment_inventory insert skipped:",
        error.message
      );
    }

    inserted.push({
      confirmed,
      inventory
    });
  }

  return inserted;
}

async function saveBusinessResult(result = {}, options = {}) {
  if (!result.businessName) {
    throw new Error("[InventoryRepository] Cannot save result without businessName.");
  }

  const client = await db.connect();

  try {
    await client.query("BEGIN");

    const scrapeRun = await createScrapeRun(
      {
        runStatus: "running",
        triggerType: options.triggerType || result.triggerType || "manual",
        businessName: result.businessName,
        platform: result.platform,
        serviceName: result.serviceName || result.service,
        serviceType: result.serviceType || result.serviceCategory,
        durationMinutes: result.durationMinutes,
        scrapeStartDate: result.scrapeStartDate,
        scrapeEndDate: result.scrapeEndDate,
        lookaheadHours: result.lookaheadHours,
        daysForward: result.daysForward,
        scrapeWindowMode: result.scrapeWindowMode
      },
      client
    );

    const rawScrapeResult = await insertRawScrapeResult(
      {
        ...result,
        scrapeRunId: scrapeRun.id,
        rawResult: result
      },
      client
    );

    const insertedAppointments = await insertConfirmedAppointmentsFromResult(
      result,
      {
        scrapeRunId: scrapeRun.id,
        rawScrapeResultId: rawScrapeResult.id
      },
      client
    );

    await finishScrapeRun(
      scrapeRun.id,
      {
        runStatus: result.status === "error" ? "error" : "success",
        appointmentsFound: insertedAppointments.length,
        errorMessage: result.error || null
      },
      client
    );

    await client.query("COMMIT");

    return {
      scrapeRun,
      rawScrapeResult,
      appointmentsInserted: insertedAppointments.length,
      insertedAppointments
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function getRawResults(limit = 500) {
  const result = await db.query(
    `
    SELECT raw_response_json
    FROM raw_scrape_results
    ORDER BY created_at DESC NULLS LAST, id DESC
    LIMIT $1
    `,
    [Number(limit || 500)]
  );

  return result.rows.map((row) => row.raw_response_json).filter(Boolean);
}

async function getInventory(filters = {}) {
  const values = [];
  const where = [];
  where.push("appointment_start > NOW()");
  where.push("searchable = true");

  function addWhere(sql, value) {
    values.push(value);
    where.push(sql.replace("?", `$${values.length}`));
  }

  if (filters.businessName) {
    addWhere("LOWER(business_name) LIKE LOWER(?)", `%${filters.businessName}%`);
  }

  if (filters.platform) {
    addWhere("LOWER(platform) = LOWER(?)", filters.platform);
  }

  if (filters.serviceCategory) {
    addWhere("LOWER(service_category) = LOWER(?)", filters.serviceCategory);
  }

  if (filters.durationMinutes) {
    addWhere("duration_minutes = ?", Number(filters.durationMinutes));
  }

  if (filters.targetLocalDateKey) {
    addWhere("local_date::text = ?", filters.targetLocalDateKey);
  }

  if (filters.startTimeKey) {
    addWhere("local_time::text >= ?", filters.startTimeKey);
  }

  if (filters.endTimeKey) {
    addWhere("local_time::text <= ?", filters.endTimeKey);
  }

  if (filters.includeConfirmed === false) {
    where.push("source_type <> 'confirmed'");
  }

  if (filters.includeInferred === false) {
    where.push("source_type <> 'inferred'");
  }

  const limit = Number(filters.limit || 1000);

  const result = await db.query(
    `
    SELECT *
    FROM appointment_inventory
    ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY appointment_start ASC NULLS LAST, local_date ASC NULLS LAST, local_time ASC NULLS LAST
    LIMIT ${Number.isFinite(limit) && limit > 0 ? limit : 1000}
    `,
    values
  );

  return result.rows;
}

module.exports = {
  createScrapeRun,
  finishScrapeRun,
  insertRawScrapeResult,
  insertConfirmedAppointment,
  insertConfirmedAppointmentsFromResult,
  insertInventoryAppointment,
  saveBusinessResult,
  getInventory,
  getRawResults,
  getResultKey,
  extractAppointments
};