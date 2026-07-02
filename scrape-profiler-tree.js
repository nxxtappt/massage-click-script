const fs = require("fs");
const path = require("path");
const { spawn, execSync } = require("child_process");

const OUTPUT_FILE = path.join(__dirname, "scrape-profile-tree-results.json");

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

function kbToMb(kb) {
  return Number((Number(kb || 0) / 1024).toFixed(2));
}

function getChildPids(parentPid) {
  try {
    const output = execSync(`pgrep -P ${parentPid}`, { encoding: "utf8" }).trim();
    if (!output) return [];

    const directChildren = output
      .split("\n")
      .map((x) => Number(x.trim()))
      .filter(Boolean);

    const all = [...directChildren];

    for (const childPid of directChildren) {
      all.push(...getChildPids(childPid));
    }

    return [...new Set(all)];
  } catch {
    return [];
  }
}

function getProcessMemory(pid) {
  try {
    const output = execSync(`ps -o pid=,rss=,comm= -p ${pid}`, {
      encoding: "utf8"
    }).trim();

    if (!output) return null;

    const parts = output.trim().split(/\s+/);
    const processName = parts.slice(2).join(" ");

    return {
      pid,
      rssMb: kbToMb(parts[1]),
      processName
    };
  } catch {
    return null;
  }
}

function getProcessTreeMemory(rootPid) {
  const pids = [rootPid, ...getChildPids(rootPid)];
  const processes = pids.map(getProcessMemory).filter(Boolean);

  const totalRssMb = Number(
    processes.reduce((sum, p) => sum + Number(p.rssMb || 0), 0).toFixed(2)
  );

  return {
    rootPid,
    processCount: processes.length,
    totalRssMb,
    processes
  };
}

function buildScrapeArgs() {
  const business = getArg("business");
  const platform = getArg("platform");
  const serviceType = getArg("serviceType");
  const duration = getArg("duration");
  const lookaheadHours = getArg("lookaheadHours", "48");
  const forceRefresh = getArg("forceRefresh", "true");

  const args = [
    "scrape.js",
    "--manual=true",
    `--lookaheadHours=${lookaheadHours}`,
    `--forceRefresh=${forceRefresh}`
  ];

  if (business) args.push(`--business=${business}`);
  if (platform) args.push(`--platform=${platform}`);
  if (serviceType) args.push(`--serviceType=${serviceType}`);
  if (duration) args.push(`--duration=${duration}`);

  return args;
}

function runProfileOnce(runNumber) {
  return new Promise((resolve) => {
    const business = getArg("business");
    const platform = getArg("platform");
    const serviceType = getArg("serviceType");
    const duration = getArg("duration");
    const lookaheadHours = getArg("lookaheadHours", "48");
    const forceRefresh = getArg("forceRefresh", "true");

    const args = buildScrapeArgs();

    const startedAt = Date.now();
    const samples = [];

    console.log(`\n[PROFILE TREE] Run ${runNumber}: node ${args.join(" ")}`);

    const child = spawn("node", args, {
      stdio: "inherit"
    });

    const sampler = setInterval(() => {
      const snapshot = getProcessTreeMemory(child.pid);

      samples.push({
        sampledAt: new Date().toISOString(),
        ...snapshot
      });
    }, 500);

    child.on("close", (code) => {
      clearInterval(sampler);

      const durationMs = Date.now() - startedAt;

      const peakSample = samples.reduce((best, sample) => {
        if (!best) return sample;
        return sample.totalRssMb > best.totalRssMb ? sample : best;
      }, null);

      const result = {
        recordedAt: new Date().toISOString(),
        runNumber,
        business,
        platform,
        serviceType,
        duration,
        lookaheadHours,
        forceRefresh,
        exitCode: code,
        success: code === 0,
        durationMs,
        durationSeconds: Number((durationMs / 1000).toFixed(2)),
        sampleCount: samples.length,
        peakTotalRssMb: peakSample ? peakSample.totalRssMb : null,
        peakProcessCount: peakSample ? peakSample.processCount : null,
        peakProcesses: peakSample ? peakSample.processes : [],
        firstSample: samples[0] || null,
        lastSample: samples[samples.length - 1] || null
      };

      saveResult(result);

      console.log("\n[PROFILE TREE RESULT]");
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