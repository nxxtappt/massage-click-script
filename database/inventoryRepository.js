const db = require("../db");

async function createScrapeRun(payload = {}) {
  const result = await db.query(
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
      payload.businessName,
      payload.platform,
      payload.serviceName || null,
      payload.serviceType || null,
      payload.durationMinutes || null,
      payload.scrapeStartDate || null,
      payload.scrapeEndDate || null,
      payload.lookaheadHours || null,
      payload.daysForward || null,
      payload.scrapeWindowMode || null
    ]
  );

  return result.rows[0];
}

async function finishScrapeRun(id, payload = {}) {
  const result = await db.query(
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

  return result.rows[0];
}
async function insertRawScrapeResult(payload = {}) {
  const rawJson = payload.rawResponseJson || payload.rawResult || payload;

  const result = await db.query(
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
      payload.businessName,
      payload.platform,
      payload.serviceName || null,
      payload.serviceType || null,
      payload.durationMinutes || null,
      payload.scrapeStartDate || null,
      payload.scrapeEndDate || null,
      rawJson,
      Buffer.byteLength(JSON.stringify(rawJson), "utf8"),
      payload.scraperVersion || null
    ]
  );

  return result.rows[0];
}
async function insertConfirmedAppointment(payload = {}) {
  const result = await db.query(
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
      payload.businessName,
      payload.platform,
      payload.serviceName || null,
      payload.serviceCategory || payload.serviceType || null,
      payload.durationMinutes || null,
      payload.providerName || payload.therapistName || null,
      payload.bookingUrl || null,
      payload.appointmentStart,
      payload.appointmentEnd || null,
      payload.localDate || null,
      payload.localTime || null,
      payload.timezone || "America/Chicago",
      "confirmed",
      1.0
    ]
  );

  return result.rows[0];
}
module.exports = {
  createScrapeRun,
  finishScrapeRun,
  insertRawScrapeResult,
  insertConfirmedAppointment
};
