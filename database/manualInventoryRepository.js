const db = require("../db");
const inventoryRepository = require("./inventoryRepository");

const DEFAULT_TIMEZONE = "America/Chicago";
const MANUAL_INVENTORY_REASON = "manual_admin";

function toBigIntIdOrNull(value) {
  if (value === undefined || value === null || value === "") return null;

  const text = String(value).trim();
  if (!/^\d+$/.test(text)) return null;

  try {
    return BigInt(text) > 0n ? text : null;
  } catch {
    return null;
  }
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

function isValidDateKey(value) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));

  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() + 1 === month &&
    date.getUTCDate() === day
  );
}

function isValidTimeKey(value) {
  const match = String(value || "").match(/^(\d{2}):(\d{2})$/);
  if (!match) return false;

  const hour = Number(match[1]);
  const minute = Number(match[2]);

  return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59;
}

function getTimeZoneParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);

  const result = {};

  for (const part of parts) {
    if (part.type !== "literal") {
      result[part.type] = Number(part.value);
    }
  }

  return result;
}

function localDateTimeToUtcIso(dateKey, timeKey, timeZone = DEFAULT_TIMEZONE) {
  if (!isValidDateKey(dateKey) || !isValidTimeKey(timeKey)) {
    throw new Error(`Invalid local appointment date/time: ${dateKey} ${timeKey}`);
  }

  const [year, month, day] = dateKey.split("-").map(Number);
  const [hour, minute] = timeKey.split(":").map(Number);
  const desiredAsUtc = Date.UTC(year, month - 1, day, hour, minute, 0);

  let guess = desiredAsUtc;

  // Iteratively resolve the UTC instant whose wall clock time matches the requested
  // date/time in the business's IANA timezone. This avoids server-timezone drift.
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const parts = getTimeZoneParts(new Date(guess), timeZone);
    const representedAsUtc = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second || 0
    );

    const delta = desiredAsUtc - representedAsUtc;
    guess += delta;

    if (Math.abs(delta) < 1000) break;
  }

  return new Date(guess).toISOString();
}

function addMinutesToIso(isoString, durationMinutes) {
  const duration = Number(durationMinutes || 0);
  if (!Number.isFinite(duration) || duration <= 0) return null;

  const start = new Date(isoString);
  if (Number.isNaN(start.getTime())) return null;

  return new Date(start.getTime() + duration * 60000).toISOString();
}

async function getTableColumns(tableName, client = db) {
  const result = await client.query(
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

function buildSlotWhere(payload, columns, options = {}) {
  const values = [];
  const where = [];

  function add(sql, value) {
    values.push(value);
    where.push(sql.replace("?", `$${values.length}`));
  }

  const businessServiceId = toBigIntIdOrNull(payload.businessServiceId);

  if (businessServiceId && columns.has("business_service_id")) {
    add("business_service_id = ?", businessServiceId);
  } else {
    add("LOWER(business_name) = LOWER(?)", payload.businessName || "");
    add("LOWER(COALESCE(service_name, '')) = LOWER(?)", payload.serviceName || "");

    if (payload.durationMinutes) {
      add("duration_minutes = ?", Number(payload.durationMinutes));
    }
  }

  add("local_date = ?::date", payload.localDate);
  add("local_time = ?::time", payload.localTime);

  if (columns.has("appointment_source")) {
    where.push("appointment_source = 'confirmed'");
  }

  if (columns.has("searchable")) {
    where.push("searchable = true");
  }

  const statusColumn = columns.has("inventory_status")
    ? "inventory_status"
    : columns.has("status")
      ? "status"
      : null;

  if (statusColumn && options.includeInactive !== true) {
    where.push(
      `COALESCE(${statusColumn}, 'active') NOT IN ('inactive','expired','archived','deleted')`
    );
  }

  return { values, where };
}

async function findExistingConfirmedInventory(payload, client, columns) {
  const { values, where } = buildSlotWhere(payload, columns);

  const result = await client.query(
    `
      SELECT *
      FROM appointment_inventory
      WHERE ${where.join(" AND ")}
      ORDER BY id DESC
      LIMIT 1
    `,
    values
  );

  return result.rows[0] || null;
}

async function deleteReplaceableInventoryForSlot(payload, client, columns) {
  const { values, where } = buildSlotWhere(payload, columns);

  if (columns.has("scrape_overwrite_protected")) {
    where.push("COALESCE(scrape_overwrite_protected, false) = false");
  }

  if (columns.has("inventory_reason")) {
    where.push(`COALESCE(inventory_reason, '') <> '${MANUAL_INVENTORY_REASON}'`);
  }

  const result = await client.query(
    `
      DELETE FROM appointment_inventory
      WHERE ${where.join(" AND ")}
      RETURNING id
    `,
    values
  );

  return result.rowCount || result.rows.length;
}

function buildManualPayload(business, service, slot, protectFromScrape) {
  const timezone = business.timezone || DEFAULT_TIMEZONE;
  const appointmentStart = localDateTimeToUtcIso(slot.date, slot.time, timezone);
  const durationMinutes = Number(service.durationMinutes || 0) || null;

  return {
    businessServiceId:
      service.businessServiceId ||
      service.id ||
      null,
    businessName: business.businessName || business.name || "",
    platform: business.platform || "manual",
    serviceName: service.serviceName || "",
    serviceCategory:
      service.serviceType ||
      service.serviceCategory ||
      "",
    durationMinutes,
    providerName: null,
    bookingUrl: business.bookingUrl || "",
    appointmentStart,
    appointmentEnd: addMinutesToIso(appointmentStart, durationMinutes),
    localDate: slot.date,
    localTime: slot.time,
    timezone,
    sourceType: "confirmed",
    confidence: 1.0,
    inventoryReason: MANUAL_INVENTORY_REASON,
    scrapeOverwriteProtected: protectFromScrape === true,
    searchable: true,
    rawJson: {
      entryMethod: "manual_admin",
      scrapeOverwriteProtected: protectFromScrape === true,
      enteredAt: new Date().toISOString(),
      localDate: slot.date,
      localTime: slot.time
    }
  };
}

async function createManualInventoryBatch(options = {}) {
  const business = options.business || {};
  const services = Array.isArray(options.services) ? options.services : [];
  const slots = Array.isArray(options.slots) ? options.slots : [];
  const protectFromScrape = options.protectFromScrape === true;

  if (!business.businessName && !business.name) {
    throw new Error("Manual inventory requires a business.");
  }

  if (!services.length) {
    throw new Error("Manual inventory requires at least one service.");
  }

  if (!slots.length) {
    throw new Error("Manual inventory requires at least one appointment time.");
  }

  const client = await db.connect();

  try {
    await client.query("BEGIN");

    const columns = await getTableColumns("appointment_inventory", client);

    if (protectFromScrape && !columns.has("scrape_overwrite_protected")) {
      throw new Error(
        "Manual inventory protection column is missing. Run db/migrations/016_manual_inventory_admin.sql first."
      );
    }

    let created = 0;
    let skipped = 0;
    let protectionUpdated = 0;
    let replacedExistingInventory = 0;
    const createdRows = [];

    for (const service of services) {
      for (const slot of slots) {
        const payload = buildManualPayload(
          business,
          service,
          slot,
          protectFromScrape
        );

        const existing = await findExistingConfirmedInventory(
          payload,
          client,
          columns
        );

        if (existing) {
          const isExistingManual =
            String(existing.inventory_reason || "") === MANUAL_INVENTORY_REASON;
          const existingProtected = existing.scrape_overwrite_protected === true;

          if (isExistingManual) {
            if (
              protectFromScrape &&
              !existingProtected &&
              columns.has("scrape_overwrite_protected")
            ) {
              await client.query(
                `
                  UPDATE appointment_inventory
                  SET scrape_overwrite_protected = true,
                      updated_at = NOW()
                  WHERE id = $1
                `,
                [existing.id]
              );

              protectionUpdated += 1;
            }

            skipped += 1;
            continue;
          }

          if (!protectFromScrape) {
            // A confirmed record already exists for this exact service/date/time.
            // Do not create a duplicate manual row when normal scraper overwrite is allowed.
            skipped += 1;
            continue;
          }

          // A protected manual row is intended to become authoritative for this exact
          // slot. Remove only replaceable inventory rows; historical confirmed rows stay.
          replacedExistingInventory += await deleteReplaceableInventoryForSlot(
            payload,
            client,
            columns
          );
        }

        const confirmed = await inventoryRepository.insertConfirmedAppointment(
          payload,
          client
        );

        const inventory = await inventoryRepository.insertInventoryAppointment(
          {
            ...payload,
            confirmedAppointmentId: confirmed.id
          },
          client
        );

        created += 1;
        createdRows.push({
          inventoryId: inventory?.id || null,
          confirmedId: confirmed?.id || null,
          businessServiceId: payload.businessServiceId,
          serviceName: payload.serviceName,
          localDate: payload.localDate,
          localTime: payload.localTime,
          scrapeOverwriteProtected: protectFromScrape
        });
      }
    }

    await client.query("COMMIT");

    return {
      requested: services.length * slots.length,
      created,
      skipped,
      protectionUpdated,
      replacedExistingInventory,
      createdRows
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function listManualInventory(filters = {}) {
  const values = [];
  const where = ["COALESCE(ai.inventory_reason, '') = $1"];
  values.push(MANUAL_INVENTORY_REASON);

  function add(sql, value) {
    values.push(value);
    where.push(sql.replace("?", `$${values.length}`));
  }

  const business = String(filters.business || filters.businessName || "").trim();
  const date = String(filters.date || "").trim();
  const protection = String(filters.protection || "").trim().toLowerCase();

  if (business) {
    add("LOWER(ai.business_name) LIKE LOWER(?)", `%${business}%`);
  }

  if (date) {
    add("ai.local_date = ?::date", date);
  }

  if (protection === "protected") {
    where.push("COALESCE(ai.scrape_overwrite_protected, false) = true");
  } else if (protection === "replaceable") {
    where.push("COALESCE(ai.scrape_overwrite_protected, false) = false");
  }

  const limit = Math.min(500, Math.max(1, Number(filters.limit || 200) || 200));

  const countResult = await db.query(
    `
      SELECT COUNT(*)::int AS total
      FROM appointment_inventory ai
      WHERE ${where.join(" AND ")}
    `,
    values
  );

  const result = await db.query(
    `
      SELECT
        ai.id,
        ai.confirmed_id,
        ai.business_service_id,
        ai.business_name,
        ai.platform,
        ai.service_name,
        ai.service_category,
        ai.duration_minutes,
        ai.booking_url,
        ai.appointment_start,
        ai.appointment_end,
        ai.local_date,
        ai.local_time,
        ai.timezone,
        ai.inventory_reason,
        COALESCE(ai.scrape_overwrite_protected, false) AS scrape_overwrite_protected,
        ai.searchable,
        ai.created_at,
        ai.updated_at
      FROM appointment_inventory ai
      WHERE ${where.join(" AND ")}
      ORDER BY
        ai.local_date ASC NULLS LAST,
        ai.local_time ASC NULLS LAST,
        ai.business_name ASC,
        ai.service_name ASC
      LIMIT ${limit}
    `,
    values
  );

  return {
    rows: result.rows,
    total: Number(countResult.rows[0]?.total || 0),
    limit
  };
}

function normalizeInventoryIds(ids = []) {
  return [
    ...new Set(
      (Array.isArray(ids) ? ids : [])
        .map(toBigIntIdOrNull)
        .filter(Boolean)
        .map(String)
    )
  ].slice(0, 1000);
}

async function setManualInventoryProtection(ids = [], protectedValue = false) {
  const safeIds = normalizeInventoryIds(ids);
  if (!safeIds.length) return { updated: 0 };

  const result = await db.query(
    `
      UPDATE appointment_inventory
      SET scrape_overwrite_protected = $2,
          updated_at = NOW()
      WHERE id = ANY($1::bigint[])
        AND COALESCE(inventory_reason, '') = $3
      RETURNING id
    `,
    [safeIds, protectedValue === true, MANUAL_INVENTORY_REASON]
  );

  return {
    updated: result.rowCount || result.rows.length,
    ids: result.rows.map((row) => String(row.id))
  };
}

async function deleteManualInventory(ids = []) {
  const safeIds = normalizeInventoryIds(ids);
  if (!safeIds.length) return { deleted: 0, confirmedDeleted: 0 };

  const client = await db.connect();

  try {
    await client.query("BEGIN");

    const selected = await client.query(
      `
        SELECT id, confirmed_id
        FROM appointment_inventory
        WHERE id = ANY($1::bigint[])
          AND COALESCE(inventory_reason, '') = $2
        FOR UPDATE
      `,
      [safeIds, MANUAL_INVENTORY_REASON]
    );

    const inventoryIds = selected.rows.map((row) => String(row.id));
    const confirmedIds = selected.rows
      .map((row) => toBigIntIdOrNull(row.confirmed_id))
      .filter(Boolean)
      .map(String);

    if (inventoryIds.length) {
      await client.query(
        `DELETE FROM appointment_inventory WHERE id = ANY($1::bigint[])`,
        [inventoryIds]
      );
    }

    let confirmedDeleted = 0;

    if (confirmedIds.length) {
      const confirmedResult = await client.query(
        `DELETE FROM confirmed_appointments WHERE id = ANY($1::bigint[]) RETURNING id`,
        [confirmedIds]
      );

      confirmedDeleted = confirmedResult.rowCount || confirmedResult.rows.length;
    }

    await client.query("COMMIT");

    return {
      deleted: inventoryIds.length,
      confirmedDeleted
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  MANUAL_INVENTORY_REASON,
  createManualInventoryBatch,
  listManualInventory,
  setManualInventoryProtection,
  deleteManualInventory,
  localDateTimeToUtcIso,
  isValidDateKey,
  isValidTimeKey
};