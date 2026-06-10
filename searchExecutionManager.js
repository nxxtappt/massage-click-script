const {
  createIntentLock,
  removeIntentLock,
  getActiveLock
} = require("./searchLockManager");

const {
  decideSearchAction
} = require("./searchDecisionEngine");

const {
  runScrapeBatch
} = require("./scrapeRunner");

async function executeSearch(
  query = {}
) {
  const decision =
    decideSearchAction(
      query
    );

  console.log(
    "\n===== EXECUTION DECISION ====="
  );

  console.log(
    JSON.stringify(
      decision,
      null,
      2
    )
  );

  if (
    !decision.liveScrapeNow
  ) {
    return {
      success: true,
      skippedScrape: true,
      reason:
        decision.reason,

      decision
    };
  }

  const existingLock =
    getActiveLock(
      decision.intentKey
    );

  if (existingLock) {
    return {
      success: true,
      skippedScrape: true,

      reason:
        "Another scrape is already running for this intent.",

      decision
    };
  }

  createIntentLock(
    decision.intentKey,
    {
      minutes: 10,

      metadata: {
        createdBy:
          "searchExecutionManager",

        search:
          decision.intent
            .rawSearch
      }
    }
  );

  try {
    const scrapeTargets =
      Array.isArray(
        decision.targetsToScrape
      )
        ? decision.targetsToScrape
        : [];

    console.log(
      "\n===== TARGETS TO SCRAPE ====="
    );

    console.log(
      JSON.stringify(
        scrapeTargets,
        null,
        2
      )
    );

(async () => {
  try {
    console.log(
      "\n===== BACKGROUND SCRAPE STARTED ====="
    );

    await runScrapeBatch(
      scrapeTargets
    );

    console.log(
      "\n===== BACKGROUND SCRAPE COMPLETE ====="
    );
  } catch (error) {
    console.error(
      "\n[BACKGROUND SCRAPE ERROR]",
      error
    );
  } finally {
    removeIntentLock(
      decision.intentKey
    );
  }
})();

return {
  success: true,

  backgroundScrapeStarted: true,

  servedFreshCache:
    Array.isArray(
      decision
        .freshCachedResults
    ) &&
    decision
      .freshCachedResults
      .length > 0,

  freshCachedResults:
    decision
      .freshCachedResults ||
    [],

  scrapedTargets:
    scrapeTargets,

  decision
};
  } catch (error) {
    console.error(
      "\n[EXECUTION ERROR]",
      error
    );

    return {
      success: false,

      error:
        error.message,

      decision
    };
  }
}

async function runCli() {
  const query = {};

  process.argv
    .slice(2)
    .forEach((arg) => {
      if (
        !arg.startsWith(
          "--"
        )
      ) {
        return;
      }

      const [key, value] =
        arg
          .replace(
            /^--/,
            ""
          )
          .split("=");

      query[key] =
        value === undefined
          ? true
          : value;
    });

  const result =
    await executeSearch(
      query
    );

  console.log(
    "\n===== EXECUTION RESULT ====="
  );

  console.log(
    JSON.stringify(
      result,
      null,
      2
    )
  );
}

if (require.main === module) {
  runCli();
}

module.exports = {
  executeSearch
};