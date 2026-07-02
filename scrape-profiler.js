const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const OUTPUT_FILE = path.join(__dirname, "scrape-profile-results.json");

function getArg(name, fallback = "") {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length) : fallback;
}

function loadResults() {
  if (!fs.existsSync(OUTPUT_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(OUTPUT_FILE, "utf8"));
  } catch {
    return [];
  }
}

function saveResult(result) {
  const results = loadResults();
  results.unshift(result);
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(results, null, 2));
}

function mb(bytes) {
  return Number((bytes / 1024 / 1024).toFixed(2));
}

function runProfileOnce(runNumber) {
  return new Promise((resolve) => {
    const business = getArg("business");
    const platform = getArg("platform");
    const serviceType = getArg("serviceType");
    const duration = getArg("duration");
    const lookaheadHours = getArg("lookaheadHours", "48");

    const args = ["scrape.js", "--manual=true", `--lookaheadHours=${lookaheadHours}`];

    if (business) args.push(`--business=${business}`);
    if (platform) args.push(`--platform=${platform}`);
    if (serviceType) args.push(`--serviceType=${serviceType}`);
    if (duration) args.push(`--duration=${duration}`);

    const startedAt = Date.now();
    const samples = [];

    console.log(`\n[PROFILE] Run ${runNumber}: node ${args.join(" ")}`);

    const child = spawn("node", args, {
      stdio: "inherit"
    });

    const sampler = setInterval(() => {
      try {
        const usage = process.memoryUsage();

        samples.push({
          rssMb: mb(usage.rss),
          heapUsedMb: mb(usage.heapUsed),
          heapTotalMb: mb(usage.heapTotal),
          externalMb: mb(usage.external),
          sampledAt: new Date().toISOString()
        });
      } catch {}
    }, 500);

    child.on("close", (code) => {
      clearInterval(sampler);

      const durationMs = Date.now() - startedAt;

      const peakRssMb = samples.length
        ? Math.max(...samples.map((s) => s.rssMb))
        : null;

      const peakHeapUsedMb = samples.length
        ? Math.max(...samples.map((s) => s.heapUsedMb))
        : null;

      const result = {
        recordedAt: new Date().toISOString(),
        runNumber,
        business,
        platform,
        serviceType,
        duration,
        lookaheadHours,
        exitCode: code,
        success: code === 0,
        durationMs,
        durationSeconds: Number((durationMs / 1000).toFixed(2)),
        sampleCount: samples.length,
        peakRssMb,
        peakHeapUsedMb,
        firstSample: samples[0] || null,
        lastSample: samples[samples.length - 1] || null
      };

      saveResult(result);

      console.log("\n[PROFILE RESULT]");
      console.log(JSON.stringify(result, null, 2));

      resolve(result);
    });
  });
}

async function main() {
  const runs = Number(getArg("runs", "1"));

  for (let i = 1; i <= runs; i += 1) {
    await runProfileOnce(i);
  }

  console.log(`\nSaved results to ${OUTPUT_FILE}`);
}

main();
