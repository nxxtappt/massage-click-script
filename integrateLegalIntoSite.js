#!/usr/bin/env node
"use strict";

/*
  NextAppt.ai legal integration patch
  -----------------------------------
  Run from the repository root:

    node integrateLegalIntoSite.js

  This script is intentionally idempotent. It:
  - mounts /api/legal
  - adds /terms and /privacy routes
  - wires consumer clickwrap acceptance into userRoutes.js
  - wires business clickwrap acceptance into businessDashboardRoutes.js
  - adds legal acceptance UI to consumer and business login flows
  - adds standard Terms / Privacy footer links to public-facing pages
  - writes public/siteLegal.css
*/

const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();

function filePath(relativePath) {
  return path.join(ROOT, relativePath);
}

function read(relativePath) {
  const target = filePath(relativePath);
  if (!fs.existsSync(target)) {
    throw new Error(`Required file not found: ${relativePath}`);
  }
  return fs.readFileSync(target, "utf8");
}

function write(relativePath, content) {
  fs.writeFileSync(filePath(relativePath), content, "utf8");
  console.log(`[LEGAL INTEGRATION] Updated ${relativePath}`);
}

function replaceRequired(content, search, replacement, label) {
  if (content.includes(replacement)) {
    return content;
  }

  if (!content.includes(search)) {
    throw new Error(`Could not find expected code for: ${label}`);
  }

  return content.replace(search, replacement);
}

function insertBeforeOnce(content, marker, insertion, label) {
  if (content.includes(insertion.trim())) {
    return content;
  }

  const index = content.indexOf(marker);

  if (index === -1) {
    throw new Error(`Could not find insertion point for: ${label}`);
  }

  return content.slice(0, index) + insertion + content.slice(index);
}

function ensureCssLink(html) {
  if (html.includes("/siteLegal.css")) {
    return html;
  }

  return insertBeforeOnce(
    html,
    "</head>",
    '  <link rel="stylesheet" href="/siteLegal.css?v=20260808-legal-footer" />\n',
    "site legal stylesheet"
  );
}

const footerHtml = `
  <footer class="site-legal-footer">
    <div class="site-legal-footer-inner">
      <span>&copy; 2026 NextAppt.ai</span>

      <nav aria-label="Legal and account links">
        <a href="/terms">Terms of Service</a>
        <a href="/privacy">Privacy Policy</a>
        <a href="/account">My Account</a>
        <a href="/business">For Businesses</a>
      </nav>
    </div>
  </footer>
`;

function ensureFooter(html) {
  if (
    html.includes('class="site-legal-footer"') ||
    html.includes("class='site-legal-footer'") ||
    html.includes('class="legal-footer"')
  ) {
    return html;
  }

  return insertBeforeOnce(
    html,
    "</body>",
    footerHtml + "\n",
    "public legal footer"
  );
}

function ensurePublicFooter(relativePath) {
  if (!fs.existsSync(filePath(relativePath))) {
    console.log(`[LEGAL INTEGRATION] Skipping missing optional page ${relativePath}`);
    return;
  }

  let html = read(relativePath);
  html = ensureCssLink(html);
  html = ensureFooter(html);
  write(relativePath, html);
}

function patchServer() {
  let source = read("server.js");

  if (!source.includes('require("./legalRoutes")')) {
    const importAnchor = 'const userRoutes = require("./userRoutes");';

    source = replaceRequired(
      source,
      importAnchor,
      `${importAnchor}\nconst legalRoutes = require("./legalRoutes");`,
      "server legalRoutes import"
    );
  }

  if (!source.includes('app.use("/api/legal", legalRoutes);')) {
    const mountAnchor = 'app.use("/api/user", userRoutes);';

    source = replaceRequired(
      source,
      mountAnchor,
      `${mountAnchor}\napp.use("/api/legal", legalRoutes);`,
      "server legal API mount"
    );
  }

  if (!source.includes('app.get("/terms"')) {
    const routeAnchor = `app.get("/account", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "account.html"));
});
`;

    const legalRoutesBlock = `
app.get("/terms", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "terms.html"));
});

app.get("/privacy", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "privacy.html"));
});
`;

    source = replaceRequired(
      source,
      routeAnchor,
      routeAnchor + legalRoutesBlock,
      "clean /terms and /privacy routes"
    );
  }

  write("server.js", source);
}

function patchUserRoutes() {
  let source = read("userRoutes.js");

  if (!source.includes("recordConsumerClickwrap")) {
    const importAnchor =
      'const { buildAlertFromSearch } = require("./userAlertSearchBuilder");';

    source = replaceRequired(
      source,
      importAnchor,
      `${importAnchor}
const {
  recordConsumerClickwrap
} = require("./legalAcceptanceService");`,
      "consumer legal acceptance import"
    );
  }

  const acceptanceCall = `    await recordConsumerClickwrap(req, user);

    const activeUser = await userRepository.activateUserWithCode({`;

  if (!source.includes("await recordConsumerClickwrap(req, user);")) {
    const activationAnchor =
      `    const activeUser = await userRepository.activateUserWithCode({`;

    source = replaceRequired(
      source,
      activationAnchor,
      acceptanceCall,
      "consumer clickwrap recording"
    );
  }

  // Preserve status codes emitted by legal validation (400 / 409).
  const oldCatch = `  } catch (error) {
    console.error("[USER AUTH VERIFY CODE]", error);
    res.status(500).json({ success: false, error: error.message });
  }
});`;

  const newCatch = `  } catch (error) {
    console.error("[USER AUTH VERIFY CODE]", error);
    res
      .status(error.statusCode || 500)
      .json({ success: false, error: error.message });
  }
});`;

  if (source.includes(oldCatch)) {
    source = source.replace(oldCatch, newCatch);
  }

  write("userRoutes.js", source);
}

function patchBusinessRoutes() {
  let source = read("businessDashboardRoutes.js");

  if (!source.includes("recordBusinessClickwrap")) {
    const importAnchor =
      `const {
  sendBusinessLoginCode
} = require("./emailManager");`;

    source = replaceRequired(
      source,
      importAnchor,
      `${importAnchor}

const {
  recordBusinessClickwrap
} = require("./legalAcceptanceService");`,
      "business legal acceptance import"
    );
  }

  source = source.replace(
    'router.post("/auth/verify-code", (req, res) => {',
    'router.post("/auth/verify-code", async (req, res) => {'
  );

  if (!source.includes("await recordBusinessClickwrap(req, session);")) {
    const sessionAnchor = `    const session = verifyLoginCode({
      email,
      code
    });

    res.json({`;

    const sessionReplacement = `    const session = verifyLoginCode({
      email,
      code
    });

    try {
      await recordBusinessClickwrap(req, session);
    } catch (error) {
      if (session?.token) {
        destroySession(session.token);
      }

      throw error;
    }

    res.json({`;

    source = replaceRequired(
      source,
      sessionAnchor,
      sessionReplacement,
      "business clickwrap recording"
    );
  }

  const verifyRouteStart = source.indexOf(
    'router.post("/auth/verify-code", async (req, res) => {'
  );

  if (verifyRouteStart !== -1) {
    const nextRouteStart = source.indexOf(
      'router.get("/auth/session"',
      verifyRouteStart
    );

    if (nextRouteStart !== -1) {
      let verifyBlock = source.slice(verifyRouteStart, nextRouteStart);

      verifyBlock = verifyBlock.replace(
        `    res.status(401).json({
      success: false,
      error: error.message
    });`,
        `    res.status(error.statusCode || 401).json({
      success: false,
      error: error.message
    });`
      );

      source =
        source.slice(0, verifyRouteStart) +
        verifyBlock +
        source.slice(nextRouteStart);
    }
  }

  write("businessDashboardRoutes.js", source);
}

function patchAccountHtml() {
  let html = read("public/account.html");

  html = ensureCssLink(html);
  html = ensureFooter(html);

  if (!html.includes('id="legalAgreementAccepted"')) {
    const buttonAnchor = `        <button type="submit">Verify & sign in</button>`;

    const legalBlock = `        <div class="legal-clickwrap">
          <label class="legal-clickwrap-row">
            <input
              id="legalAgreementAccepted"
              type="checkbox"
              required
            />
            <span>
              I am at least 18 and agree to the
              <a href="/terms" target="_blank" rel="noopener">Terms of Service</a>,
              including the arbitration and class-action waiver, and acknowledge the
              <a href="/privacy" target="_blank" rel="noopener">Privacy Policy</a>.
            </span>
          </label>
        </div>

${buttonAnchor}`;

    html = replaceRequired(
      html,
      buttonAnchor,
      legalBlock,
      "consumer account clickwrap UI"
    );
  }

  if (!html.includes("/legalAcceptanceUi.js")) {
    html = insertBeforeOnce(
      html,
      '  <script src="/account.js',
      '  <script src="/legalAcceptanceUi.js?v=20260808"></script>\n',
      "consumer legal acceptance helper script"
    );
  }

  write("public/account.html", html);
}

function patchAccountJs() {
  let source = read("public/account.js");

  if (!source.includes("window.NextApptLegal.consumerPayload()")) {
    const bodyPattern = /body:\s*\n\s*JSON\.stringify\(\{\s*\n\s*email:\s*\n\s*pendingEmail\s*\|\|\s*\n\s*emailInput\.value,\s*\n\s*code:\s*\n\s*codeInput\.value\s*\n\s*\}\)/m;

    if (!bodyPattern.test(source)) {
      throw new Error(
        "Could not find consumer verify-code request body in public/account.js"
      );
    }

    source = source.replace(
      bodyPattern,
      `body:
              JSON.stringify({
                email:
                  pendingEmail ||
                  emailInput.value,
                code:
                  codeInput.value,
                acceptance:
                  window.NextApptLegal.consumerPayload()
              })`
    );
  }

  write("public/account.js", source);
}

function patchBusinessDashboardHtml() {
  let html = read("public/business-dashboard.html");

  html = ensureCssLink(html);
  html = ensureFooter(html);

  if (!html.includes("/legalAcceptanceUi.js")) {
    html = insertBeforeOnce(
      html,
      '  <script src="/business-dashboard.js',
      '  <script src="/legalAcceptanceUi.js?v=20260808"></script>\n',
      "business legal acceptance helper script"
    );
  }

  write("public/business-dashboard.html", html);
}

function patchBusinessDashboardJs() {
  let source = read("public/business-dashboard.js");

  if (!source.includes("getBusinessMarkup()")) {
    const actionsAnchor = `      <div class="settings-actions">
        <button id="verifyCodeBtn" class="primary-btn">`;

    const insertion = `      ${
        "${window.NextApptLegal ? window.NextApptLegal.getBusinessMarkup() : \"\"}"
      }

${actionsAnchor}`;

    source = replaceRequired(
      source,
      actionsAnchor,
      insertion,
      "business dashboard clickwrap UI"
    );
  }

  if (!source.includes("window.NextApptLegal.businessPayload()")) {
    const verifyFetchPattern =
      /body:\s*JSON\.stringify\(\{\s*email,\s*code\s*\}\)/m;

    if (!verifyFetchPattern.test(source)) {
      throw new Error(
        "Could not find business verify-code request body in public/business-dashboard.js"
      );
    }

    source = source.replace(
      verifyFetchPattern,
      `body: JSON.stringify({
      email,
      code,
      acceptance: window.NextApptLegal.businessPayload()
    })`
    );
  }

  write("public/business-dashboard.js", source);
}

function writeFooterCss() {
  const css = `/* Shared public footer + legal clickwrap styling */

.site-legal-footer {
  margin-top: 48px;
  border-top: 1px solid #dbe3ea;
  background: #f4f7f9;
  color: #5f6b76;
  font-family: Arial, Helvetica, sans-serif;
}

.site-legal-footer-inner {
  width: min(1100px, calc(100% - 32px));
  min-height: 72px;
  margin: 0 auto;
  padding: 20px 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  flex-wrap: wrap;
  font-size: 13px;
}

.site-legal-footer nav {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
}

.site-legal-footer a {
  color: #005f95;
  text-decoration: none;
}

.site-legal-footer a:hover {
  text-decoration: underline;
}

.legal-clickwrap,
.legal-acceptance-box {
  margin: 16px 0;
  padding: 14px;
  border: 1px solid #dbe3ea;
  border-radius: 10px;
  background: #f6f9fb;
}

.legal-clickwrap-row {
  display: flex !important;
  align-items: flex-start;
  gap: 10px;
  margin: 0 !important;
  font-weight: 400 !important;
  cursor: pointer;
}

.legal-clickwrap-row input,
.legal-acceptance-box input[type="checkbox"] {
  width: auto !important;
  margin-top: 3px;
  flex: 0 0 auto;
}

.legal-clickwrap-row span,
.legal-acceptance-box span {
  font-size: 13px;
  line-height: 1.45;
}

.legal-clickwrap-row a,
.legal-acceptance-box a {
  color: #005f95;
}

@media (max-width: 680px) {
  .site-legal-footer-inner {
    align-items: flex-start;
    flex-direction: column;
  }
}
`;

  write("public/siteLegal.css", css);
}

function checkRequiredLegalFiles() {
  const required = [
    "public/terms.html",
    "public/privacy.html",
    "public/legal.css",
    "public/legalAcceptanceUi.js",
    "legalPolicy.js",
    "legalRoutes.js",
    "legalAcceptanceService.js",
    "database/legalAcceptanceRepository.js",
    "db/migrations/013_legal_acceptance.sql"
  ];

  for (const relativePath of required) {
    if (!fs.existsSync(filePath(relativePath))) {
      throw new Error(
        `Missing legal package file: ${relativePath}. Copy the legal package into the repo before running this integration.`
      );
    }
  }
}

function patchLegalPageNavigation(relativePath) {
  let html = read(relativePath);

  // Normalize any accidental direct .html links to clean site routes.
  html = html
    .replaceAll('href="/terms.html"', 'href="/terms"')
    .replaceAll('href="/privacy.html"', 'href="/privacy"');

  write(relativePath, html);
}

function main() {
  console.log("\n=== NextAppt.ai legal site integration ===\n");

  checkRequiredLegalFiles();
  writeFooterCss();

  patchServer();
  patchUserRoutes();
  patchBusinessRoutes();

  patchAccountHtml();
  patchAccountJs();

  patchBusinessDashboardHtml();
  patchBusinessDashboardJs();

  const publicPages = [
    "public/landing.html",
    "public/index.html",
    "public/business.html",
    "public/business-page.html",
    "public/ai.html"
  ];

  for (const page of publicPages) {
    ensurePublicFooter(page);
  }

  patchLegalPageNavigation("public/terms.html");
  patchLegalPageNavigation("public/privacy.html");

  console.log(`
=== Integration complete ===

Next steps:

1. Run syntax checks:
   node --check server.js
   node --check userRoutes.js
   node --check businessDashboardRoutes.js
   node --check legalRoutes.js
   node --check legalAcceptanceService.js
   node --check database/legalAcceptanceRepository.js
   node --check public/account.js
   node --check public/business-dashboard.js

2. If migration 013 has NOT already been run:
   node runMigration.js db/migrations/013_legal_acceptance.sql

3. Inspect:
   git diff -- server.js userRoutes.js businessDashboardRoutes.js public

4. Commit:
   git add server.js userRoutes.js businessDashboardRoutes.js \\
     legalRoutes.js legalPolicy.js legalAcceptanceService.js \\
     database/legalAcceptanceRepository.js db/migrations/013_legal_acceptance.sql \\
     public/terms.html public/privacy.html public/legal.css \\
     public/legalAcceptanceUi.js public/siteLegal.css \\
     public/landing.html public/index.html public/business.html \\
     public/business-page.html public/ai.html public/account.html \\
     public/account.js public/business-dashboard.html public/business-dashboard.js

   git commit -m "Integrate Terms Privacy and clickwrap acceptance into site"
   git push origin main
`);
}

try {
  main();
} catch (error) {
  console.error("\n[LEGAL INTEGRATION FAILED]");
  console.error(error.message);
  process.exit(1);
}