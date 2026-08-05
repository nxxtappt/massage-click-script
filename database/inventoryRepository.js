const db = require("../db");

const DEFAULT_TIMEZONE = "America/Chicago";

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeTextArray(value = []) {
  const values =
    Array.isArray(value)
      ? value
      : [value];

  return [
    ...new Set(
      values
        .map(normalizeText)
        .filter(Boolean)
    )
  ];
}

function toNumberOrNull(value) {
  if (value === undefined || value === null || value === "") return null;

  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function toBigIntOrNull(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  const text = String(value).trim();

  if (!/^\d+$/.test(text)) {
    return null;
  }

  try {
    return BigInt(text) > 0n ? text : null;
  } catch {
    return null;
  }
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

  // Prevent time-only strings from becoming 1970-01-01.
  if (/^\d{1,2}:\d{2}(:\d{2})?(\.\d+)?$/.test(raw)) {
    return "";
  }

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

  if (!Number.isNaN(parsed.getTime()) && parsed.getFullYear() > 2000) {
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
    parseDateKey(appointment.startTime) ||
    parseDateKey(appointment.date) ||
    parseDateKey(appointment.rawDate) ||
    parseDateKey(appointment.rawTime) ||
    parseDateKey(appointment.localDateKey) ||
    parseDateKey(appointment.appointmentDate) ||
    parseDateKey(appointment.AvailableDate) ||
    parseDateKey(parentResult.scrapeStartDate) ||
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
  const safeId = toBigIntOrNull(id);
  if (!safeId) return null;

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
      safeId,
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
  return insertDynamic(
    "confirmed_appointments",
    {
      scrape_run_id: toBigIntOrNull(payload.scrapeRunId),
      raw_scrape_result_id: toBigIntOrNull(payload.rawScrapeResultId),
      business_service_id: toBigIntOrNull(payload.businessServiceId),
      business_name: payload.businessName || null,
      platform: payload.platform || null,
      service_name: payload.serviceName || payload.service || null,
      service_category: payload.serviceCategory || payload.serviceType || null,
      duration_minutes: toNumberOrNull(payload.durationMinutes),
      provider_name: payload.providerName || payload.therapistName || payload.provider || null,
      booking_url: payload.bookingUrl || null,
      appointment_start:
        payload.appointmentStart ||
        payload.startTime ||
        buildAppointmentStart(payload) ||
        null,
      appointment_end: payload.appointmentEnd || payload.endTime || null,
      local_date:
        payload.localDate ||
        payload.localDateKey ||
        buildLocalDate(payload) ||
        null,
      local_time:
        payload.localTime ||
        payload.localTimeKey ||
        buildLocalTime(payload) ||
        null,
      timezone: payload.timezone || DEFAULT_TIMEZONE,
      source_type: payload.sourceType || "confirmed",
      confidence: payload.confidence === undefined ? 1.0 : Number(payload.confidence),
      raw_json: payload.rawJson || null
    },
    client
  );
}

async function insertInferredAppointment(payload = {}, client = db) {
  const inferred = await insertDynamic(
    "inferred_appointments",
    {
      business_service_id: toBigIntOrNull(
        payload.businessServiceId || payload.inferredBusinessServiceId
      ),
      anchor_service_id: toBigIntOrNull(
        payload.anchorServiceId || payload.inferenceAnchorServiceId
      ),
      business_name: payload.businessName || null,
      platform: payload.platform || null,
      service_name: payload.serviceName || payload.service || null,
      service_category: payload.serviceCategory || payload.serviceType || null,
      duration_minutes: toNumberOrNull(payload.durationMinutes),
      provider_name: payload.providerName || payload.therapistName || payload.provider || null,
      booking_url: payload.bookingUrl || null,
      appointment_start: payload.appointmentStart || payload.startTime || null,
      appointment_end: payload.appointmentEnd || payload.endTime || null,
      local_date: payload.localDate || payload.localDateKey || null,
      local_time: payload.localTime || payload.localTimeKey || null,
      timezone: payload.timezone || DEFAULT_TIMEZONE,
      source_type: "inferred",
      inference_type:
        payload.inferenceType ||
        payload.inferenceMode ||
        "service_anchor",
      confidence:
        payload.confidenceScore ??
        payload.inferenceConfidence ??
        payload.confidence ??
        0.85,
      inference_reason: payload.inferenceReason || "service_anchor",
      raw_json: payload.rawJson || payload
    },
    client
  );

  await insertInventoryAppointment(
    {
      ...payload,
      inferredAppointmentId: inferred.id,
      businessServiceId:
        payload.businessServiceId ||
        payload.inferredBusinessServiceId ||
        null,
      anchorServiceId:
        payload.anchorServiceId ||
        payload.inferenceAnchorServiceId ||
        null,
      sourceType: "inferred",
      inventoryReason: payload.inferenceReason || "service_anchor"
    },
    client
  );

  return inferred;
}

async function insertInventoryAppointment(payload = {}, client = db) {
  return insertDynamic(
    "appointment_inventory",
    {
      appointment_source: payload.appointmentSource || payload.sourceType || "confirmed",

      confirmed_id: toBigIntOrNull(
        payload.confirmedAppointmentId || payload.confirmedId
      ),
      inferred_id: toBigIntOrNull(
        payload.inferredAppointmentId || payload.inferredId
      ),
      business_service_id: toBigIntOrNull(
        payload.businessServiceId || payload.inferredBusinessServiceId
      ),
      anchor_service_id: toBigIntOrNull(
        payload.anchorServiceId || payload.inferenceAnchorServiceId
      ),

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

      appointment_start:
        payload.appointmentStart ||
        payload.startTime ||
        buildAppointmentStart(payload) ||
        null,
      appointment_end: payload.appointmentEnd || payload.endTime || null,
      local_date:
        payload.localDate ||
        payload.localDateKey ||
        buildLocalDate(payload) ||
        null,
      local_time:
        payload.localTime ||
        payload.localTimeKey ||
        buildLocalTime(payload) ||
        null,
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

async function reconcileAppointmentInventoryScope(payload = {}, client = db) {
  const businessServiceId = toBigIntOrNull(payload.businessServiceId);
  const anchorServiceId = toBigIntOrNull(
    payload.anchorServiceId || payload.businessServiceId
  );

  if (!businessServiceId && !anchorServiceId) {
    return { deleted: 0 };
  }

  const values = [];
  const where = [];

  if (businessServiceId && anchorServiceId) {
    values.push(businessServiceId, anchorServiceId);
    where.push("(business_service_id = $1 OR anchor_service_id = $2)");
  } else if (businessServiceId) {
    values.push(businessServiceId);
    where.push("business_service_id = $1");
  } else {
    values.push(anchorServiceId);
    where.push("anchor_service_id = $1");
  }

  const startDate = payload.scrapeStartDate || payload.startDate || null;
  const endDate =
    payload.scrapeEndDate ||
    payload.endDate ||
    startDate ||
    null;

  if (startDate) {
    values.push(startDate);
    where.push(`local_date >= $${values.length}::date`);
  }

  if (endDate) {
    values.push(endDate);
    where.push(`local_date <= $${values.length}::date`);
  }

  const result = await client.query(
    `
      DELETE FROM appointment_inventory
      WHERE ${where.join(" AND ")}
      RETURNING id
    `,
    values
  );

  return {
    deleted: result.rowCount || result.rows.length
  };
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

      businessServiceId: toBigIntOrNull(
        appointment.businessServiceId ||
          result.businessServiceId ||
          result.serviceConfigId
      ),
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
  const columns = await getTableColumns("appointment_inventory");

  const showPast =
    filters.showPast === true ||
    String(filters.showPast) === "true" ||
    filters.includePast === true ||
    String(filters.includePast) === "true";

  if (!showPast) {
    where.push(`
      (
        local_date > (NOW() AT TIME ZONE 'America/Chicago')::date
        OR (
          local_date = (NOW() AT TIME ZONE 'America/Chicago')::date
          AND local_time > (NOW() AT TIME ZONE 'America/Chicago')::time
        )
      )
    `);
  }

  if (columns.has("searchable")) {
    where.push("searchable = true");
  }

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

  if (filters.categorySlug && columns.has("category_slug")) {
    addWhere("LOWER(category_slug) = LOWER(?)", filters.categorySlug);
  }

  if (filters.serviceCategory) {
    addWhere("LOWER(service_category) = LOWER(?)", filters.serviceCategory);
  }

  if (filters.serviceName) {
    addWhere("LOWER(service_name) LIKE LOWER(?)", `%${filters.serviceName}%`);
  }

  if (filters.durationMinutes) {
    addWhere("duration_minutes = ?", Number(filters.durationMinutes));
  }

  if (filters.targetLocalDateKey) {
    addWhere("local_date = ?::date", filters.targetLocalDateKey);
  }

  if (filters.startTimeKey) {
    addWhere("local_time >= ?::time", filters.startTimeKey);
  }

  if (filters.endTimeKey) {
    addWhere("local_time <= ?::time", filters.endTimeKey);
  }

  const sourceColumn = columns.has("appointment_source")
    ? "appointment_source"
    : columns.has("source_type")
      ? "source_type"
      : null;

  if (sourceColumn && filters.includeConfirmed === false) {
    where.push(`${sourceColumn} <> 'confirmed'`);
  }

  if (sourceColumn && filters.includeInferred === false) {
    where.push(`${sourceColumn} <> 'inferred'`);
  }

  if (!filters.includeInactive) {
    if (columns.has("inventory_status")) {
      where.push("COALESCE(inventory_status, 'active') NOT IN ('inactive', 'expired', 'archived', 'deleted')");
    } else if (columns.has("status")) {
      where.push("COALESCE(status, 'active') NOT IN ('inactive', 'expired', 'archived', 'deleted')");
    }
  }

  const limit = Number(filters.limit || 1000);
  const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.min(limit, 10000) : 1000;

  const result = await db.query(
    `
    SELECT *
    FROM appointment_inventory
    ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY appointment_start ASC NULLS LAST, local_date ASC NULLS LAST, local_time ASC NULLS LAST
    LIMIT ${safeLimit}
    `,
    values
  );

  return result.rows;
}

async function searchInventory(filters = {}) {
  const page =
    Math.max(
      1,
      Number(filters.page || 1) ||
        1
    );

  const limit =
    Math.min(
      100,
      Math.max(
        1,
        Number(filters.limit || 25) ||
          25
      )
    );

  const offset =
    (page - 1) * limit;

  const values = [];
  const where = [];

  const columns =
    await getTableColumns(
      "appointment_inventory"
    );

  const showPast =
    filters.showPast === true ||
    String(filters.showPast) ===
      "true";

  if (!showPast) {
    where.push(`
      (
        ai.local_date >
          (
            NOW() AT TIME ZONE
            COALESCE(
              ai.timezone,
              'America/Chicago'
            )
          )::date
        OR (
          ai.local_date =
            (
              NOW() AT TIME ZONE
              COALESCE(
                ai.timezone,
                'America/Chicago'
              )
            )::date
          AND ai.local_time >
            (
              NOW() AT TIME ZONE
              COALESCE(
                ai.timezone,
                'America/Chicago'
              )
            )::time
        )
      )
    `);
  }

  if (columns.has("searchable")) {
    where.push(
      "ai.searchable = true"
    );
  }

  function add(
    sql,
    value
  ) {
    values.push(value);

    where.push(
      sql.replace(
        "?",
        `$${values.length}`
      )
    );
  }

  if (filters.businessName) {
    add(
      "LOWER(ai.business_name) LIKE LOWER(?)",
      `%${filters.businessName}%`
    );
  }

  if (filters.platform) {
    add(
      "LOWER(ai.platform) = LOWER(?)",
      filters.platform
    );
  }

  if (
    filters.categorySlug &&
    columns.has("category_slug")
  ) {
    add(
      "LOWER(ai.category_slug) = LOWER(?)",
      filters.categorySlug
    );
  }

  if (filters.serviceCategory) {
    add(
      "LOWER(ai.service_category) LIKE LOWER(?)",
      `%${filters.serviceCategory}%`
    );
  }

  if (filters.serviceName) {
    add(
      "LOWER(ai.service_name) LIKE LOWER(?)",
      `%${filters.serviceName}%`
    );
  }

  if (filters.targetLocalDateKey) {
    add(
      "ai.local_date = ?::date",
      filters.targetLocalDateKey
    );
  }

  const sourceColumn =
    columns.has(
      "appointment_source"
    )
      ? "appointment_source"
      : columns.has(
          "source_type"
        )
        ? "source_type"
        : null;

  if (
    sourceColumn &&
    filters.sourceType
  ) {
    add(
      `LOWER(ai.${sourceColumn}) = LOWER(?)`,
      filters.sourceType
    );
  }

  const statusColumn =
    columns.has(
      "inventory_status"
    )
      ? "inventory_status"
      : columns.has("status")
        ? "status"
        : null;

  if (
    statusColumn &&
    filters.status
  ) {
    add(
      `LOWER(ai.${statusColumn}) = LOWER(?)`,
      filters.status
    );
  }

  if (
    !filters.includeInactive &&
    statusColumn
  ) {
    where.push(
      `COALESCE(ai.${statusColumn}, 'active') NOT IN ('inactive','expired','archived','deleted')`
    );
  }

  const metroTerms =
    normalizeTextArray(
      filters.metroTerms
    );

  if (metroTerms.length) {
    values.push(metroTerms);

    where.push(`
      EXISTS (
        SELECT 1
        FROM UNNEST(
          $${values.length}::text[]
        ) AS requested_metro(term)
        WHERE BTRIM(
          REGEXP_REPLACE(
            LOWER(
              CONCAT_WS(
                ' ',
                COALESCE(
                  business_match.metro,
                  ''
                ),
                COALESCE(
                  business_match.city,
                  ''
                ),
                COALESCE(
                  business_match.address,
                  ''
                )
              )
            ),
            '[^a-z0-9]+',
            ' ',
            'g'
          )
        ) ~ (
          '(^| )' ||
          requested_metro.term ||
          '( |$)'
        )
      )
    `);
  }

  const baseFrom = `
    FROM appointment_inventory ai
    LEFT JOIN LATERAL (
      SELECT
        COALESCE(
          NULLIF(
            b.raw_json->>'metro',
            ''
          ),
          bl.city,
          ''
        ) AS metro,
        bl.city,
        bl.state,
        bl.address
      FROM businesses b
      LEFT JOIN LATERAL (
        SELECT
          city,
          state,
          address
        FROM business_locations
        WHERE
          business_id = b.id
        ORDER BY id ASC
        LIMIT 1
      ) bl ON TRUE
      WHERE
        LOWER(
          b.business_name
        ) =
        LOWER(
          ai.business_name
        )
        OR (
          ai.business_service_id
            IS NOT NULL
          AND EXISTS (
            SELECT 1
            FROM business_services bs
            WHERE
              bs.id =
              ai.business_service_id
              AND
              bs.business_id =
              b.id
          )
        )
      ORDER BY b.id ASC
      LIMIT 1
    ) business_match ON TRUE
  `;

  const clause =
    where.length
      ? `WHERE ${where.join(
          " AND "
        )}`
      : "";

  const countResult =
    await db.query(
      `
        SELECT
          COUNT(*)::int AS total
        ${baseFrom}
        ${clause}
      `,
      values
    );

  const dataValues = [
    ...values,
    limit,
    offset
  ];

  const result =
    await db.query(
      `
        SELECT
          ai.*,
          business_match.metro
            AS admin_metro,
          business_match.city
            AS business_city,
          business_match.state
            AS business_state,
          business_match.address
            AS business_address
        ${baseFrom}
        ${clause}
        ORDER BY
          ai.appointment_start
            ASC NULLS LAST,
          ai.local_date
            ASC NULLS LAST,
          ai.local_time
            ASC NULLS LAST
        LIMIT $${dataValues.length - 1}
        OFFSET $${dataValues.length}
      `,
      dataValues
    );

  const total =
    Number(
      countResult.rows[0]?.total ||
      0
    );

  return {
    results: result.rows,
    page,
    limit,
    total,
    totalPages:
      Math.max(
        1,
        Math.ceil(
          total / limit
        )
      )
  };
}

module.exports = {
  createScrapeRun,
  finishScrapeRun,
  insertRawScrapeResult,
  insertConfirmedAppointment,
  insertInferredAppointment,
  insertConfirmedAppointmentsFromResult,
  insertInventoryAppointment,
  reconcileAppointmentInventoryScope,
  saveBusinessResult,
  getInventory,
  searchInventory,
  getRawResults,
  getResultKey,
  extractAppointments
};