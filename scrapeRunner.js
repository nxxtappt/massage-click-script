const { spawn } = require("child_process");

function buildArgsForTarget(target = {}) {
  const args = [];

  if (target.platform) {
    args.push(
      `--platform=${target.platform}`
    );
  }

  if (target.businessName) {
    args.push(
      `--business=${target.businessName}`
    );
  }

  if (target.serviceType) {
    args.push(
      `--serviceType=${target.serviceType}`
    );
  }

  if (
    target.durationMinutes
  ) {
    args.push(
      `--duration=${target.durationMinutes}`
    );
  }

  args.push("--manual=true");

  return args;
}

function runSingleScrape(
  target = {}
) {
  return new Promise(
    (resolve) => {
      const args =
        buildArgsForTarget(target);

      console.log(
        `\n[SCRAPE RUNNER] node scrape.js ${args.join(
          " "
        )}`
      );

      const child = spawn(
        "node",
        ["scrape.js", ...args],
        {
          stdio: "inherit"
        }
      );

      child.on(
        "close",
        (code) => {
          resolve({
            success: code === 0,
            exitCode: code,
            target
          });
        }
      );

      child.on(
        "error",
        (error) => {
          resolve({
            success: false,
            error:
              error.message,
            target
          });
        }
      );
    }
  );
}

async function runScrapeBatch(
  targets = []
) {
  const results = [];

  for (const target of targets) {
    console.log(
      `\n===== SCRAPING TARGET =====`
    );

    console.log(
      `${target.businessName} | ${target.serviceName}`
    );

    const result =
      await runSingleScrape(
        target
      );

    results.push(result);
  }

  return {
    success: true,
    totalTargets:
      targets.length,
    results
  };
}

module.exports = {
  runSingleScrape,
  runScrapeBatch
};