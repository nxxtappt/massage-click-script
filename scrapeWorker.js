"use strict";

require("dotenv").config();

const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const {
  initializeAdminSettings,
  refreshAdminSettings,
  loadAdminSettings
} = require("./adminSettingsManager");
const scrapeJobRepository = require("./database/scrapeJobRepository");
const { runDueSchedules } = require("./schedulerV2");

const workerId = String(
  process.env.SCRAPE_WORKER_ID ||
  `${os.hostname()}-${process.pid}`
).slice(0, 200);

const pollMilliseconds = Math.max(
  1000,
  Number(process.env.SCRAPE_WORKER_POLL_MS || 3000)
);
const heartbeatMilliseconds = Math.max(
  5000,
  Number(process.env.SCRAPE_WORKER_HEARTBEAT_MS || 15000)
);
const staleJobMinutes = Math.max(
  2,
  Number(process.env.SCRAPE_WORKER_STALE_MINUTES || 20)
);
const schedulerPollOverrideMilliseconds = process.env.SCHEDULER_POLL_MS
  ? Math.max(10000, Number(process.env.SCHEDULER_POLL_MS))
  : null;
const captureLimitBytes = Math.max(
  8192,
  Number(process.env.SCRAPE_JOB_LOG_TAIL_BYTES || 65536)
);
const workerRunsScheduler =
  String(process.env.WORKER_RUN_SCHEDULER || "true").toLowerCase() !== "false";

let stopping = false;
let currentChild = null;
let currentJob = null;
let lastRecoveryAt = 0;
let lastSchedulerRunAt = 0;

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function appendTail(current, chunk) {
  const combined = `${current || ""}${String(chunk || "")}`;
  if (Buffer.byteLength(combined, "utf8") <= captureLimitBytes) {
    return combined;
  }

  let output = combined;
  while (Buffer.byteLength(output, "utf8") > captureLimitBytes) {
    output = output.slice(Math.max(1, Math.floor(output.length * 0.1)));
  }
  return output;
}

function resolveScriptPath(scriptName) {
  if (!scrapeJobRepository.ALLOWED_SCRIPTS.has(scriptName)) {
    throw new Error(`Worker refused unsupported script: ${scriptName}`);
  }

  const resolved = path.join(__dirname, scriptName);
  if (path.dirname(resolved) !== __dirname) {
    throw new Error("Worker script path escaped the repository root.");
  }
  return resolved;
}

async function runSchedulerTick() {
  if (!workerRunsScheduler || stopping) return [];

  const settings = await refreshAdminSettings();
  if (
    settings.scraping?.enabled === false ||
    settings.scraping?.scheduledScrapingEnabled === false ||
    settings.scheduler?.enabled === false ||
    settings.scheduler?.workerRunsScheduler === false
  ) {
    return [];
  }

  const schedulerPollMilliseconds = schedulerPollOverrideMilliseconds || Math.max(
    10000,
    Number(settings.scheduler?.pollIntervalSeconds || 30) * 1000
  );
  const now = Date.now();
  if (now - lastSchedulerRunAt < schedulerPollMilliseconds) return [];
  lastSchedulerRunAt = now;

  try {
    const results = await runDueSchedules({
      requestedBy: `worker:${workerId}`
    });

    if (results.length) {
      const queued = results.reduce(
        (sum, result) => sum + Number(result.jobsQueued || 0),
        0
      );
      console.log(
        `[SCHEDULER] Evaluated ${results.length} due schedule(s); queued ${queued} job(s).`
      );
    }

    return results;
  } catch (error) {
    console.error("[SCHEDULER] Tick failed:", error);
    return [];
  }
}

async function recoverStaleWork() {
  const now = Date.now();
  if (now - lastRecoveryAt < 60000) return [];
  lastRecoveryAt = now;

  try {
    const settings = loadAdminSettings();
    const effectiveStaleMinutes = Math.max(
      2,
      Number(settings.scheduler?.staleJobMinutes || staleJobMinutes)
    );
    const recovered = await scrapeJobRepository.recoverStaleJobs(effectiveStaleMinutes);
    if (recovered.length) {
      console.warn(`[WORKER] Recovered ${recovered.length} stale job(s).`);
    }
    return recovered;
  } catch (error) {
    console.error("[WORKER] Stale-job recovery failed:", error);
    return [];
  }
}

function childIsActive(child) {
  return Boolean(child) && child.exitCode === null && child.signalCode === null;
}

function terminateChild(child, signal = "SIGTERM") {
  if (!childIsActive(child)) return false;
  try {
    return child.kill(signal);
  } catch {
    return false;
  }
}

async function executeJob(job) {
  currentJob = job;
  let stdoutTail = "";
  let stderrTail = "";
  let timedOut = false;
  let cancelled = false;
  const scriptPath = resolveScriptPath(job.script_name);
  const args = Array.isArray(job.args) ? job.args.map(String) : [];
  const timeoutMilliseconds = Math.max(
    60000,
    Number(job.timeout_seconds || 1800) * 1000
  );

  console.log(
    `[WORKER] Starting job ${job.id} (attempt ${job.attempt_count}/${job.max_attempts}): ${job.script_name} ${args.join(" ")}`
  );

  return new Promise((resolve) => {
    let settled = false;
    let cancellationCheck = null;
    let heartbeatTimer = null;
    let timeoutTimer = null;
    let killTimer = null;

    const finish = async (code, signal, spawnError = null) => {
      if (settled) return;
      settled = true;

      clearInterval(cancellationCheck);
      clearInterval(heartbeatTimer);
      clearTimeout(timeoutTimer);
      clearTimeout(killTimer);
      currentChild = null;

      try {
        if (cancelled) {
          await scrapeJobRepository.markJobCancelled(job.id, workerId, {
            errorMessage: "Cancelled by administrator.",
            stdoutTail,
            stderrTail
          });
          console.warn(`[WORKER] Job ${job.id} cancelled.`);
        } else if (!spawnError && !timedOut && Number(code) === 0) {
          await scrapeJobRepository.markJobSucceeded(job.id, workerId, {
            exitCode: 0,
            stdoutTail,
            stderrTail,
            result: {
              signal: signal || null,
              completedAt: new Date().toISOString()
            }
          });
          console.log(`[WORKER] Job ${job.id} succeeded.`);
        } else {
          const errorMessage = spawnError
            ? spawnError.message
            : timedOut
              ? `Scrape job exceeded ${job.timeout_seconds || 1800} seconds.`
              : `Scrape process exited with code ${code ?? "unknown"}${signal ? ` (${signal})` : ""}.`;

          const updated = await scrapeJobRepository.markJobFailed(job.id, workerId, {
            exitCode: Number.isInteger(code) ? code : null,
            errorMessage,
            stdoutTail,
            stderrTail,
            retryable: !timedOut || Number(job.attempt_count || 0) < Number(job.max_attempts || 1),
            result: {
              signal: signal || null,
              timedOut,
              failedAt: new Date().toISOString()
            }
          });

          console.error(
            `[WORKER] Job ${job.id} ${updated?.status === "queued" ? "will retry" : "failed"}: ${errorMessage}`
          );
        }
      } catch (error) {
        console.error(`[WORKER] Failed to persist result for job ${job.id}:`, error);
      } finally {
        currentJob = null;
        resolve();
      }
    };

    try {
      currentChild = spawn(process.execPath, [scriptPath, ...args], {
        cwd: __dirname,
        shell: false,
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"]
      });
    } catch (error) {
      finish(null, null, error);
      return;
    }

    currentChild.stdout?.on("data", (chunk) => {
      process.stdout.write(chunk);
      stdoutTail = appendTail(stdoutTail, chunk);
    });

    currentChild.stderr?.on("data", (chunk) => {
      process.stderr.write(chunk);
      stderrTail = appendTail(stderrTail, chunk);
    });

    currentChild.on("error", (error) => finish(null, null, error));
    currentChild.on("close", (code, signal) => finish(code, signal));

    heartbeatTimer = setInterval(() => {
      scrapeJobRepository
        .heartbeatWorker(workerId, job.id, {
          pid: process.pid,
          hostname: os.hostname()
        })
        .catch((error) => console.error("[WORKER] Heartbeat failed:", error));
    }, heartbeatMilliseconds);

    cancellationCheck = setInterval(async () => {
      try {
        cancelled = await scrapeJobRepository.isCancellationRequested(job.id);
        if (cancelled && terminateChild(currentChild, "SIGTERM")) {
          killTimer = setTimeout(() => {
            terminateChild(currentChild, "SIGKILL");
          }, 10000);
        }
      } catch (error) {
        console.error("[WORKER] Cancellation check failed:", error);
      }
    }, 5000);

    timeoutTimer = setTimeout(() => {
      timedOut = true;
      if (terminateChild(currentChild, "SIGTERM")) {
        killTimer = setTimeout(() => {
          terminateChild(currentChild, "SIGKILL");
        }, 10000);
      }
    }, timeoutMilliseconds);
  });
}

async function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  console.log(`[WORKER] Received ${signal}; stopping after current cleanup.`);

  await scrapeJobRepository
    .heartbeatWorker(workerId, currentJob?.id || null, { stopping: true })
    .catch(() => null);

  if (terminateChild(currentChild, "SIGTERM")) {
    setTimeout(() => {
      terminateChild(currentChild, "SIGKILL");
    }, 10000).unref();
  }
}

async function runWorker(options = {}) {
  await initializeAdminSettings();
  await scrapeJobRepository.registerWorker(workerId, {
    pid: process.pid,
    hostname: os.hostname(),
    schedulerEnabled: workerRunsScheduler
  });

  console.log(`[WORKER] Started ${workerId}.`);
  console.log(`[WORKER] Scheduler polling: ${workerRunsScheduler ? "enabled" : "disabled"}.`);

  while (!stopping) {
    await recoverStaleWork();
    await runSchedulerTick();

    const job = await scrapeJobRepository.claimNextJob(workerId);
    if (!job) {
      if (options.once) break;
      await sleep(pollMilliseconds);
      continue;
    }

    await executeJob(job);
    if (options.once) break;
  }

  await scrapeJobRepository.markWorkerStopped(workerId).catch(() => null);
  console.log(`[WORKER] Stopped ${workerId}.`);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

if (require.main === module) {
  runWorker({ once: process.argv.includes("--once") })
    .then(() => process.exit(0))
    .catch(async (error) => {
      console.error("[WORKER] Fatal error:", error);
      await scrapeJobRepository.markWorkerStopped(workerId).catch(() => null);
      process.exit(1);
    });
}

module.exports = {
  runWorker,
  executeJob,
  runSchedulerTick,
  recoverStaleWork,
  workerId
};