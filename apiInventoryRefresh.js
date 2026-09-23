"use strict";
const db = require("./db");
const { localDateTime } = require("./crmProviders/mindbody");
const { reconcileAppointmentInventoryScope, insertConfirmedAppointmentsFromResult, insertInferredAppointment } = require("./database/inventoryRepository");

function localSlotToInstant(value, timeZone) {
  if (!value) return null;
  const match = String(value).match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})$/);
  return match ? localDateTime(match[1], match[2], timeZone) : value;
}

// Publish one API service response atomically, including a legitimate empty list.
async function replaceApiInventory(result, scope, options) {
  if (result.status === "error") throw new Error("Cannot publish failed API availability.");
  if (!/^\d+$/.test(String(scope.businessServiceId || ""))) throw new Error("API inventory requires a business service ID.");
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    // Serialize overlapping manual/scheduled writes for this service.
    await client.query("SELECT pg_advisory_xact_lock($1::bigint)", [scope.businessServiceId]);
    const reconciled = await reconcileAppointmentInventoryScope(scope, client);
    const inserted = await insertConfirmedAppointmentsFromResult(result, options, client);
    // The legacy insert helper catches inventory errors. Treat a missing row
    // as failure here so an aborted transaction can never report success.
    if (inserted.length !== result.appointments.length || inserted.some((row) => !row.inventory)) {
      throw new Error("API inventory could not be fully published; previous inventory preserved.");
    }
    const inferred = [];
    for (const appointment of options.inferredAppointments || []) {
      const confidence = Number(appointment.confidenceScore ?? appointment.inferenceConfidence ?? appointment.confidence ?? 0.85);
      const row = await insertInferredAppointment({
        ...appointment,
        appointmentStart: localSlotToInstant(appointment.startTime, appointment.timezone || "America/Chicago"),
        appointmentEnd: localSlotToInstant(appointment.endTime, appointment.timezone || "America/Chicago"),
        businessName: appointment.businessName || result.businessName,
        platform: appointment.platform || result.platform,
        businessServiceId: appointment.businessServiceId || appointment.inferredBusinessServiceId || null,
        anchorServiceId: appointment.anchorServiceId || appointment.inferenceAnchorServiceId || scope.businessServiceId,
        confidence: Number.isFinite(confidence) ? confidence : 0.85,
        inferenceReason: appointment.inferenceReason || "service_anchor",
        rawJson: appointment
      }, client);
      if (!row?.id) throw new Error("API inferred inventory could not be published; previous inventory preserved.");
      inferred.push(row);
    }
    await client.query("COMMIT");
    return { reconciled, inserted, inferred };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}
module.exports = { replaceApiInventory };
