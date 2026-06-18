// sensitiveSecurityAudit.js
// Checks whether public users can alter data or see sensitive info.

const BASE_URL = process.argv[2] || "https://nextappt.ai";

const findings = [];

function add(severity, title, evidence, fix) {
  findings.push({ severity, title, evidence, fix });
}

async function request(path, options = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    redirect: "manual",
    ...options,
    headers: {
      "user-agent": "NextAppt-SensitiveAudit/1.0",
      ...(options.headers || {})
    }
  });

  const text = await res.text();

  return {
    status: res.status,
    headers: Object.fromEntries(res.headers.entries()),
    text
  };
}

async function checkPublicWriteAccess() {
  const tests = [
    {
      name: "Admin API write",
      path: "/api/admin/settings",
      method: "POST",
      body: { test: true }
    },
    {
      name: "Business dashboard update",
      path: "/api/business-dashboard/profile",
      method: "POST",
      body: { businessName: "SECURITY TEST" }
    },
    {
      name: "Analytics write",
      path: "/api/analytics/appointment-click",
      method: "POST",
      body: { businessName: "SECURITY TEST", bookingUrl: "https://example.com" }
    }
  ];

  for (const test of tests) {
    const res = await request(test.path, {
      method: test.method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(test.body)
    });

    if (![401, 403, 404, 405].includes(res.status)) {
      add(
        "HIGH",
        `${test.name} may allow unauthenticated write`,
        `${test.method} ${test.path} returned ${res.status}`,
        "Require auth/session checks before accepting this write."
      );
    }
  }
}

async function checkSensitiveFileExposure() {
  const sensitivePaths = [
    "/businesses.json",
    "/results.json",
    "/errorLogs.json",
    "/admin-settings.json",
    "/secure/business-claims.json",
    "/secure/business-sessions.json",
    "/secure/business-login-codes.json",
    "/secure/api-credentials.json",
    "/.env",
    "/package.json"
  ];

  for (const path of sensitivePaths) {
    const res = await request(path);

    if (res.status === 200 && res.text.length > 20) {
      add(
        "CRITICAL",
        "Sensitive file may be publicly exposed",
        `GET ${path} returned 200`,
        "Block direct public access to JSON/config/secure files. Only serve files from /public."
      );
    }
  }
}

async function checkSecretPatternsInPublicPages() {
  const publicPages = ["/", "/austin/massage", "/business", "/business-dashboard"];

  const secretPatterns = [
    /sk-[a-zA-Z0-9_-]{20,}/,
    /AIza[0-9A-Za-z-_]{20,}/,
    /BEGIN PRIVATE KEY/,
    /ADMIN_PASSWORD/i,
    /api[_-]?key/i,
    /access[_-]?token/i,
    /developmentCode/i,
    /BUSINESS LOGIN CODE/i
  ];

  for (const page of publicPages) {
    const res = await request(page);

    for (const pattern of secretPatterns) {
      if (pattern.test(res.text)) {
        add(
          "CRITICAL",
          "Possible secret exposed in public page",
          `Pattern ${pattern} found on ${page}`,
          "Remove secrets/dev values from frontend HTML/JS/API responses."
        );
      }
    }
  }
}

async function checkLoginCodeLeak() {
  const res = await request("/api/business-dashboard/auth/request-code", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "security-test@example.com" })
  });

  if (/developmentCode|loginCode|code"\s*:/i.test(res.text)) {
    add(
      "CRITICAL",
      "Login code may leak through API",
      "request-code response appears to contain a code field",
      "Never return login codes to the browser. Send by email only."
    );
  }
}

async function checkDebugLeakage() {
  const res = await request("/api/search?showPast=true&showInvalidDates=true&limitPerBusiness=999999");

  const suspicious = [
    "stack",
    "errorLogs",
    "api-credentials",
    "business-login-codes",
    "business-sessions",
    "ADMIN_PASSWORD"
  ];

  for (const word of suspicious) {
    if (res.text.includes(word)) {
      add(
        "MEDIUM",
        "Possible debug/sensitive text in API response",
        `Found "${word}" in /api/search response`,
        "Return only public appointment/business data from public APIs."
      );
    }
  }
}

async function run() {
  console.log(`\nRunning sensitive security audit against: ${BASE_URL}\n`);

  await checkPublicWriteAccess();
  await checkSensitiveFileExposure();
  await checkSecretPatternsInPublicPages();
  await checkLoginCodeLeak();
  await checkDebugLeakage();

  console.log("===== SENSITIVE SECURITY AUDIT RESULTS =====");

  if (!findings.length) {
    console.log("No obvious public write access or sensitive data exposure found.");
    return;
  }

  findings.forEach((f, i) => {
    console.log(`\n${i + 1}. [${f.severity}] ${f.title}`);
    console.log(`Evidence: ${f.evidence}`);
    console.log(`Fix: ${f.fix}`);
  });

  console.log(`\nTotal findings: ${findings.length}`);
}

run().catch((error) => {
  console.error("Audit failed:", error);
  process.exit(1);
});