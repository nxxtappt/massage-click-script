"use strict";
const db = require("./db");
const { reconcileAppointmentInventoryScope, insertConfirmedAppointmentsFromResult } = require("./database/inventoryRepository");

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
    await client.query("COMMIT");
    return { reconciled, inserted };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}
module.exports = { replaceApiInventory };
