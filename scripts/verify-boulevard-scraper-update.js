"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const repoRoot = process.cwd();
const scrapePath = path.join(repoRoot, "scrape.js");
const scraperPath = path.join(repoRoot, "scrapers", "boulevard.js");
const failures = [];

function check(name, callback) {
  try {
    callback();
    console.log(`PASS ${name}`);
  } catch (error) {
    failures.push(`${name}: ${error.message}`);
    console.error(`FAIL ${name}: ${error.message}`);
  }
}

check("scrape.js exists", () => assert.ok(fs.existsSync(scrapePath)));
check("Boulevard scraper exists", () => assert.ok(fs.existsSync(scraperPath)));

if (fs.existsSync(scrapePath)) {
  const source = fs.readFileSync(scrapePath, "utf8");
  check("Boulevard import is wired", () =>
    assert.ok(source.includes('require("./scrapers/boulevard")'))
  );
  check("Boulevard dispatch is wired", () =>
    assert.ok(source.includes('scrapeTarget.platform === "boulevard"'))
  );
  check("Boulevard is supported", () =>
    assert.ok(
      /supportedPlatforms\s*=\s*\[[\s\S]*?["']boulevard["'][\s\S]*?\];/.test(source)
    )
  );
}

for (const file of [scrapePath, scraperPath].filter((file) => fs.existsSync(file))) {
  check(`${path.relative(repoRoot, file)} syntax`, () => {
    const result = spawnSync(process.execPath, ["--check", file], {
      cwd: repoRoot,
      encoding: "utf8"
    });
    assert.strictEqual(result.status, 0, result.stderr || result.stdout);
  });
}

if (fs.existsSync(scraperPath)) {
  const boulevard = require(scraperPath);

  check("opt-in guard rejects unapproved business", () => {
    assert.throws(
      () => boulevard.validateBoulevardAuthorization({ claimed: true }),
      /boulevardOptIn/
    );
  });

  check("verified opt-in business is accepted", () => {
    boulevard.validateBoulevardAuthorization({
      boulevardOptIn: true,
      verificationStatus: "verified"
    });
  });

  check("email resolves only through named environment variable", () => {
    const result = boulevard.resolveAuthorizedEmail(
      { boulevardAuthorizedEmailEnv: "BOULEVARD_EMAIL_TEST" },
      { BOULEVARD_EMAIL_TEST: "authorized@example.com" }
    );
    assert.strictEqual(result.email, "authorized@example.com");
  });

  check("GraphQL bookable starts normalize into appointments", () => {
    const fixture = {
      data: {
        cartBookableTimes: [
          { startTime: "2026-09-05T09:30:00-05:00" },
          { startTime: "2026-09-05T14:00:00-05:00" }
        ]
      }
    };
    const starts = boulevard.extractBookableStartTimes(fixture);
    const appointments = boulevard.appointmentsFromCapturedStarts(
      starts,
      {
        businessName: "Fixture Spa",
        serviceName: "60 Minute Massage",
        serviceType: "massage",
        durationMinutes: 60,
        bookingUrl: "https://example.com/book"
      },
      { startDate: "2026-09-05", endDate: "2026-09-05" }
    );
    assert.deepStrictEqual(
      appointments.map((item) => [item.localDateKey, item.time]),
      [
        ["2026-09-05", "9:30 AM"],
        ["2026-09-05", "2:00 PM"]
      ]
    );
  });
}

if (failures.length) {
  console.error(`\n${failures.length} verification check(s) failed.`);
  process.exit(1);
}

console.log("\nBoulevard scraper update verified.");