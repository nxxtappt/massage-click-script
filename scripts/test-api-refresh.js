"use strict";
// Offline behavioral regression suite. No live database, credentials or API calls.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const root = path.resolve(__dirname, "..");
function load(file, mocks = {}) {
  const filename = path.join(root, file);
  const mod = new Module(filename, module);
  mod.filename = filename;
  mod.paths = Module._nodeModulePaths(path.dirname(filename));
  const nativeRequire = Module.createRequire(filename);
  mod.require = (name) => Object.hasOwn(mocks, name) ? mocks[name] : nativeRequire(name);
  mod._compile(fs.readFileSync(filename, "utf8"), filename);
  return mod.exports;
}
const settings = { scraping: { enabled: true }, serviceRules: {
  allowServicesWithoutPriority: true, allowServicesWithoutDiscoveryStatus: true
} };
const adminSettings = { loadAdminSettings: () => structuredClone(settings),
  initializeAdminSettings: async () => {}, isPlatformEnabled: () => true };
const builder = load("jobBuilder.js", { "./adminSettingsManager": adminSettings });
const integrations = require("../platformIntegrationRegistry");
const business = { businessId: "sample-studio", businessName: "Sample Studio",
  platform: "mindbody", enabled: true, integrations: [
    { id: "scrape", platform: "mindbody", integrationType: "scrape", isDefault: true,
      bookingUrl: "https://example.com/book", enabled: true },
    { id: "api", platform: "mindbody", integrationType: "api", apiProvider: "mindbody",
      credentialId: "fixture-credential", enabled: true }
  ], services: [{ id: "91", serviceName: "Custom massage", serviceType: "massage",
    durationMinutes: 60, platformServiceId: "777", sessionTypeId: "888", enabled: true,
    scrapeDirectly: false, inferenceRole: "inferred" }] };
let passed = 0;
async function check(name, fn) { await fn(); passed++; console.log(`PASS ${name}`); }

async function main() {
  const oldFetch = global.fetch;
  global.fetch = async () => { throw new Error("Unexpected network call in offline test"); };
  try {
    await check("Shared vault decrypts a business-bound credential and rejects a wrong worker key", async () => {
      const savedKey = process.env.NEXTAPPT_CREDENTIALS_KEY;
      try {
        process.env.NEXTAPPT_CREDENTIALS_KEY = require("node:crypto").randomBytes(32).toString("base64");
        const vault = require("../crmCredentialVault");
        const encrypted = vault.encryptCredential("offline-only", {
          credentialId: "fixture-credential", publicBusinessId: "sample-studio", provider: "mindbody" });
        const repository = load("database/crmCredentialRepository.js", { "../db": { query: async (_, args) => {
          assert.deepEqual(args, ["fixture-credential", "sample-studio"]);
          return { rows: [{ ...encrypted, provider: "mindbody", publicBusinessId: "sample-studio", metadata: { locationId: 9 } }] };
        } } });
        assert.equal((await repository.readCredential("fixture-credential", "sample-studio")).apiKey, "offline-only");
        process.env.NEXTAPPT_CREDENTIALS_KEY = require("node:crypto").randomBytes(32).toString("base64");
        await assert.rejects(() => repository.readCredential("fixture-credential", "sample-studio"));
      } finally {
        if (savedKey === undefined) delete process.env.NEXTAPPT_CREDENTIALS_KEY;
        else process.env.NEXTAPPT_CREDENTIALS_KEY = savedKey;
      }
    });
    await check("API only selects API even when scraping is default; mapping survives job building", () => {
      const jobs = builder.buildScrapeJobs([business], { integrationType: "api", manual: true });
      assert.equal(jobs.length, 1); assert.equal(jobs[0].sessionTypeId, "888");
      assert.equal(jobs[0].credentialId, "fixture-credential");
      assert.equal(integrations.resolveEnabledIntegration({ ...business, integrations: [business.integrations[0]] },
        { integrationType: "api" }), null);
      assert.equal(builder.buildScrapeJobs([business], { integrationType: "scrape", manual: true }).length, 0);
      assert.throws(() => builder.buildScrapeJobs([business], { integrationType: "typo" }));
    });
    const scheduler = load("schedulerV2.js", { "./database/schedulerRepository": {}, "./database/scrapeJobRepository": {} });
    await check("Scheduled API choice and window reach job builder; automatic schedules remain automatic", () => {
      const args = scheduler.buildScheduleJobArgs({ id: 5, scrape_options: {
        integrationType: "api", daysForward: 2, forceRefresh: true } }, { business_name: business.businessName });
      const jobs = builder.buildScrapeJobs([business], builder.parseCliFilters(["node", "scrape.js", ...args]));
      assert.equal(jobs.length, 1); assert.equal(jobs[0].integrationType, "api");
      assert(!scheduler.buildScheduleJobArgs({ id: 5 }, { business_name: "A" }).some((a) => a.includes("integrationType")));
      assert.throws(() => scheduler.buildScheduleJobArgs({ scrape_options: { integrationType: "typo" } }, { business_name: "A" }));
    });
    await check("Admin forms serialize API choices for manual and scheduled requests", () => {
      const vm = require("node:vm");
      const source = fs.readFileSync(path.join(root, "public/admin.js"), "utf8");
      function uiFunction(name, context) {
        const start = source.indexOf(`function ${name}(`);
        const rest = source.slice(start);
        const end = rest.slice(1).search(/\n(?:async )?function /);
        return vm.runInNewContext(`(${end < 0 ? rest : rest.slice(0, end + 1)})`, context);
      }
      const values = { targetIntegrationType: "api", targetBusiness: "Sample Studio",
        scheduleIntegrationType: "api", scheduleName: "API refresh", scheduleBusinessId: "sample-studio",
        scheduleTimingMode: "times", scheduleTimes: "09:00", scheduleLookaheadHours: "48" };
      const context = { getSelectValue: (id) => values[id] || "", getCheckboxValue: () => false,
        getInputValue: (id) => values[id] || "", getInputChecked: () => true,
        getCheckedSchedulerDays: () => [1, 2], schedulerNumber: (value) => value ? Number(value) : null,
        schedulerStringList: (value) => value.split(",").map((x) => x.trim()).filter(Boolean) };
      assert.equal(uiFunction("buildTargetedPayload", context)().integrationType, "api");
      assert.equal(uiFunction("buildSchedulePayload", context)().scrapeOptions.integrationType, "api");
      values.scheduleIntegrationType = "";
      assert.equal(uiFunction("buildSchedulePayload", context)().scrapeOptions.integrationType, undefined);
    });
    const express = require("express");
    let queued;
    const admin = load("adminRoutes.js", {
      "./adminSettingsManager": adminSettings, "./cacheManager": {},
      "./adminManualInventoryRoutes": express.Router(), "./businessManager": {},
      "./database/serviceCategoryRepository": {}, "./database/inventoryRepository": {},
      "./database/runtimeStateRepository": {}, "./businessClaimManager": {},
      "./database/scrapeJobRepository": { enqueueJob: async (job) => { queued = job; return { id: 42 }; } },
      "./schedulerV2": scheduler
    });
    await check("Manual admin endpoint queues API method without keys and returns a job ID", async () => {
      const handler = admin.stack.find((s) => s.route?.path === "/scrape/targeted").route.stack[0].handle;
      let payload;
      const res = { status(code) { assert.equal(code, 202); return this; }, json(data) { payload = data; } };
      await handler({ body: { business: business.businessName, integrationType: "api" } }, res);
      assert(queued.args.includes("--integrationType=api")); assert.equal(payload.jobId, 42);
      assert.equal(builder.buildScrapeJobs([business], builder.parseCliFilters(["node", "scrape.js", ...queued.args])).length, 1);
      await assert.rejects(() => handler({ body: { business: "A", integrationType: "typo" } }, res));
    });
    const provider = require("../crmProviders/mindbody");
    await check("Studio date boundaries and naive appointment times use the correct DST offset", () => {
      assert.equal(provider.localDateTime("2026-03-08", "00:00:00", "America/Chicago"), "2026-03-08T00:00:00-06:00");
      assert.equal(provider.localDateTime("2026-03-08", "23:59:59", "America/Chicago"), "2026-03-08T23:59:59-05:00");
      assert.equal(provider.localDateTime("2026-09-17", "10:05:00", "America/Los_Angeles"), "2026-09-17T10:05:00-07:00");
    });
    await check("Provider paginates and distinguishes valid empty, malformed and HTTP failures", async () => {
      let requests = 0;
      global.fetch = async (url) => { requests++; return { ok: true, json: async () => ({
        Availabilities: [{ StartDateTime: "2026-09-17T10:05:00" }],
        PaginationResponse: { TotalResults: requests === 1 ? 101 : 101 }
      }) }; };
      const opts = { sessionTypeId: 888, locationId: 9, startDate: "2026-09-17", endDate: "2026-09-17" };
      assert.equal((await provider.getBookableItems({ apiKey: "dummy", siteId: "123" }, opts)).length, 2);
      assert.equal(requests, 2);
      global.fetch = async () => ({ ok: true, json: async () => ({ Availabilities: [] }) });
      assert.deepEqual(await provider.getBookableItems({}, opts), []);
      global.fetch = async () => ({ ok: true, json: async () => ({}) });
      await assert.rejects(() => provider.getBookableItems({}, opts), /invalid availability/);
      global.fetch = async () => ({ ok: false, status: 401, json: async () => ({}) });
      await assert.rejects(() => provider.getBookableItems({}, opts), /HTTP 401/);
    });
    let apiFailure = false;
    let empty = false;
    const adapter = { getBookableItems: async (credential, options) => {
      assert.equal(credential.siteId, "123"); assert.equal(options.locationId, 9);
      assert.equal(options.sessionTypeId, 888);
      if (apiFailure) throw new Error("Fixture API failure");
      return empty ? [] : [{ StartDateTime: "2026-09-17T10:05:00", Staff: { Id: 7, Name: "Fixture" } }];
    } };
    const sync = load("syncMindbodyBusiness.js", {
      "./crmProviders/registry": { getAdapter: () => adapter },
      "./database/crmCredentialRepository": { readCredential: async (id, owner) => {
        assert.equal(id, "fixture-credential"); assert.equal(owner, "sample-studio");
        return { provider: "mindbody", apiKey: "dummy", metadata: { siteId: "123", locationId: 9, timeZone: "America/Chicago" } };
      } }
    });
    adapter.syncAppointments = sync.syncMindbodyBusiness;
    const router = load("apiSyncRouter.js", { "./crmProviders/registry": { getAdapter: () => adapter } });
    let deletes = 0, inserts = 0, finished = [], browserLaunches = 0;
    const inventory = { createScrapeRun: async () => ({ id: 1 }), finishScrapeRun: async (_, info) => finished.push(info),
      insertRawScrapeResult: async () => ({ id: 1 }),
      reconcileAppointmentInventoryScope: async () => { deletes++; return { deleted: 0 }; },
      insertConfirmedAppointmentsFromResult: async (result) => {
        inserts++;
        if (result.appointments.length) {
          assert.equal(result.appointments[0].localTimeKey, "10:05");
          assert.equal(result.appointments[0].startTime, "2026-09-17T10:05:00-05:00");
          assert.equal(result.appointments[0].timezone, "America/Chicago");
        }
        return result.appointments.map((appointment) => ({ inventory: { id: 1 }, appointment }));
      } };
    const transactions = [];
    const client = { query: async (sql) => { transactions.push(sql); }, release() { transactions.push("release"); } };
    const publisher = load("apiInventoryRefresh.js", { "./db": { connect: async () => client },
      "./database/inventoryRepository": inventory });
    await check("API inventory rolls back when legacy insert helper swallows an error", async () => {
      const broken = load("apiInventoryRefresh.js", { "./db": { connect: async () => client },
        "./database/inventoryRepository": { reconcileAppointmentInventoryScope: async () => ({ deleted: 1 }),
          insertConfirmedAppointmentsFromResult: async () => [{ inventory: null }] } });
      await assert.rejects(() => broken.replaceApiInventory({ appointments: [{}] }, { businessServiceId: "91" }, {}), /fully published/);
      assert(transactions.includes("ROLLBACK")); assert(!transactions.includes("COMMIT"));
      assert.equal(transactions.at(-1), "release"); transactions.length = 0;
    });
    const mocks = { dotenv: { config() {} }, playwright: { chromium: { launch() { browserLaunches++; throw new Error("API launched a browser"); } } },
      "./jobBuilder": builder, "./adminSettingsManager": adminSettings,
      "./businessManager": { getAllBusinesses: async () => [business] },
      "./apiSyncRouter": router, "./apiInventoryRefresh": publisher, "./inventoryManager": {},
      "./availabilityInferenceEngine": { mergeConfirmedAndInferredAppointments() { throw new Error("API inferred slots"); } },
      "./database/inventoryRepository": inventory, "./database/runtimeStateRepository": { logScrapeError: async () => {} }
    };
    for (const match of fs.readFileSync(path.join(root, "scrape.js"), "utf8").matchAll(/require\("(\.\/scrapers\/[^"\n]+)"\)/g)) mocks[match[1]] = {};
    const runner = load("scrape.js", mocks);
    const oldArgv = process.argv;
    process.argv = ["node", "scrape.js", "--business=Sample Studio", "--integrationType=api", "--manual=true",
      "--scrapeStartDate=2026-09-17", "--scrapeEndDate=2026-09-17"];
    try {
      await check("Worker API run uses shared adapter, preserves off-quarter-hour times, writes confirmed inventory without browser", async () => {
        await runner.run(); assert.equal(deletes, 1); assert.equal(inserts, 1);
        assert.equal(finished.at(-1).appointmentsFound, 1); assert.equal(browserLaunches, 0);
      });
      await check("Failed API run preserves inventory and rejects so worker reports failure", async () => {
        apiFailure = true; await assert.rejects(() => runner.run(), /refresh\(es\) failed/);
        assert.equal(deletes, 1); assert.equal(inserts, 1); assert.equal(finished.at(-1).runStatus, "error");
      });
      await check("Successful zero availability reconciles old slots", async () => {
        apiFailure = false; empty = true; await runner.run();
        assert.equal(deletes, 2); assert.equal(finished.at(-1).appointmentsFound, 0);
      });
      await check("API-only request with no matching API integration fails visibly", async () => {
        const saved = business.integrations; business.integrations = [saved[0]];
        try { await assert.rejects(() => runner.run(), /No eligible refresh jobs/); }
        finally { business.integrations = saved; }
      });
      await check("Unmapped API service fails before changing inventory", async () => {
        const saved = business.services[0];
        business.services[0] = { ...saved, platformServiceId: "", sessionTypeId: "" };
        try { await assert.rejects(() => runner.run(), /Invalid API service configuration/); }
        finally { business.services[0] = saved; }
        assert.equal(deletes, 2);
      });
    } finally { process.argv = oldArgv; }
  } finally { global.fetch = oldFetch; }
  console.log(`\n${passed} behavioral checks passed. Offline fixtures only; production sync still needs validation.`);
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
