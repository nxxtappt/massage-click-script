// securityAudit.js
// Defensive security audit for your own NextAppt.ai site.
// Usage:
//   node securityAudit.js https://nextappt.ai
//   node securityAudit.js http://localhost:3000

const BASE_URL = process.argv[2] || "https://nextappt.ai";

const findings = [];

function addFinding(severity, title, evidence, fix) {
  findings.push({ severity, title, evidence, fix });
}

async function request(path, options = {}) {
  const url = `${BASE_URL}${path}`;
  const started = Date.now();

  try {
    const res = await fetch(url, {
      redirect: "manual",
      ...options,
      headers: {
        "user-agent": "NextAppt-SecurityAudit/1.0",
        ...(options.headers || {})
      }
    });

    const text = await res.text();

    return {
      url,
      ok: true,
      status: res.status,
      headers: Object.fromEntries(res.headers.entries()),
      text,
      ms: Date.now() - started
    };
  } catch (error) {
    return {
      url,
      ok: false,
      error: error.message,
      ms: Date.now() - started
    };
  }
}

function hasHeader(result, headerName) {
  return Boolean(result.headers?.[headerName.toLowerCase()]);
}

async function checkSecurityHeaders() {
  const res = await request("/");

  if (!res.ok) {
    addFinding("HIGH", "Homepage unreachable", res.error, "Confirm the site is online.");
    return;
  }

  const required = [
    ["strict-transport-security", "Add HSTS for HTTPS-only enforcement."],
    ["content-security-policy", "Add a Content-Security-Policy header."],
    ["x-content-type-options", "Add X-Content-Type-Options: nosniff."],
    ["referrer-policy", "Add Referrer-Policy."],
    ["permissions-policy", "Add Permissions-Policy."]
  ];

  for (const [header, fix] of required) {
    if (!hasHeader(res, header)) {
      addFinding("MEDIUM", `Missing security header: ${header}`, `GET / returned no ${header}`, fix);
    }
  }
}

async function checkAdminProtection() {
  const res = await request("/admin");

  if (res.status === 200) {
    addFinding(
      "HIGH",
      "/admin may be publicly accessible",
      "GET /admin returned 200 without credentials.",
      "Require Basic Auth/session auth before serving admin.html."
    );
  }

  const api = await request("/api/admin");

  if (![401, 403, 404].includes(api.status)) {
    addFinding(
      "HIGH",
      "/api/admin may be insufficiently protected",
      `GET /api/admin returned ${api.status}.`,
      "Require auth middleware on every /api/admin route."
    );
  }
}

async function checkBusinessDashboardCodeLeak() {
  const testEmail = `security-test-${Date.now()}@example.com`;

  const res = await request("/api/business-dashboard/auth/request-code", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: testEmail })
  });

  if (res.text && res.text.includes("developmentCode")) {
    addFinding(
      "CRITICAL",
      "Business login code is exposed in API response",
      `POST /api/business-dashboard/auth/request-code returned developmentCode.`,
      "Remove developmentCode from production responses. Only send codes by email/SMS. Also remove console logging of codes."
    );
  }
}

async function checkUnauthenticatedBusinessDashboard() {
  const res = await request("/api/business-dashboard/dashboard");

  if (![401, 403].includes(res.status)) {
    addFinding(
      "HIGH",
      "Business dashboard may allow unauthenticated access",
      `GET /api/business-dashboard/dashboard returned ${res.status}.`,
      "Require a valid server-side session for all dashboard data."
    );
  }
}

async function checkOnDemandScrapeExposure() {
  const res = await request("/api/search?search=60%20minute%20massage&onDemand=true");

  if (res.status === 200 && res.text.includes('"onDemand":true')) {
    addFinding(
      "HIGH",
      "Public on-demand scraping is exposed",
      "GET /api/search?...&onDemand=true appears callable without auth.",
      "Disable public onDemand by default, add IP/user rate limiting, require specificity, and cap jobs/timeouts."
    );
  }
}

async function checkErrorLeakage() {
  const res = await request("/api/search?showInvalidDates=true&showPast=true&limitPerBusiness=999999");

  if (res.status >= 500 && /stack|trace|at\s+\w+\s+\(/i.test(res.text)) {
    addFinding(
      "MEDIUM",
      "Server error details may leak",
      "A 500 response appears to include stack trace data.",
      "Return generic errors to clients and log detailed errors server-side only."
    );
  }
}

async function run() {
  console.log(`\nRunning defensive audit against: ${BASE_URL}\n`);

  await checkSecurityHeaders();
  await checkAdminProtection();
  await checkBusinessDashboardCodeLeak();
  await checkUnauthenticatedBusinessDashboard();
  await checkOnDemandScrapeExposure();
  await checkErrorLeakage();

  console.log("===== SECURITY AUDIT RESULTS =====");

  if (!findings.length) {
    console.log("No obvious issues found by this basic audit.");
    return;
  }

  findings.forEach((finding, index) => {
    console.log(`\n${index + 1}. [${finding.severity}] ${finding.title}`);
    console.log(`Evidence: ${finding.evidence}`);
    console.log(`Fix: ${finding.fix}`);
  });

  console.log(`\nTotal findings: ${findings.length}`);
}

run().catch((error) => {
  console.error("Audit failed:", error);
  process.exit(1);
});