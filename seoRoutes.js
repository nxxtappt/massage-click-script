const express = require("express");
const businessManager = require("./businessManager");

const router = express.Router();

function getPublicSiteUrl() {
  return String(process.env.PUBLIC_SITE_URL || "https://nextappt.ai")
    .trim()
    .replace(/\/+$/, "");
}

function getConfiguredPublicPaths() {
  const configured = String(process.env.PUBLIC_INDEXABLE_PATHS || "/")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => (value.startsWith("/") ? value : `/${value}`));

  return [...new Set(configured)];
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function normalizeBusinessSlug(business = {}) {
  return String(
    business.businessSlug ||
      business.slug ||
      business.business_slug ||
      ""
  )
    .trim()
    .replace(/^\/+|\/+$/g, "");
}

async function getIndexableUrls() {
  const siteUrl = getPublicSiteUrl();
  const urls = new Set(
    getConfiguredPublicPaths().map((pathname) => `${siteUrl}${pathname === "/" ? "/" : pathname}`)
  );

  const businesses = await businessManager.getAllBusinesses({
    includeDisabled: false
  });

  for (const business of Array.isArray(businesses) ? businesses : []) {
    if (!business || business.enabled === false) continue;

    const slug = normalizeBusinessSlug(business);
    if (!slug) continue;

    urls.add(`${siteUrl}/business/${encodeURIComponent(slug)}`);
  }

  return [...urls].sort();
}

router.get("/sitemap.xml", async (req, res) => {
  try {
    const urls = await getIndexableUrls();
    const entries = urls
      .map((url) => `  <url>\n    <loc>${escapeXml(url)}</loc>\n  </url>`)
      .join("\n");

    const xml = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
      entries,
      "</urlset>",
      ""
    ].join("\n");

    res.set("Content-Type", "application/xml; charset=utf-8");
    res.set("Cache-Control", "public, max-age=300");
    res.status(200).send(xml);
  } catch (error) {
    console.error("[SITEMAP ERROR]", error);
    res.status(500).type("text/plain").send("Unable to generate sitemap.");
  }
});

router.get("/robots.txt", (req, res) => {
  const siteUrl = getPublicSiteUrl();
  const robots = [
    "User-agent: *",
    "Allow: /",
    "",
    "Disallow: /admin",
    "Disallow: /admin.html",
    "Disallow: /business-dashboard",
    "Disallow: /api/admin",
    "Disallow: /api/business-dashboard",
    "",
    `Sitemap: ${siteUrl}/sitemap.xml`,
    ""
  ].join("\n");

  res.set("Content-Type", "text/plain; charset=utf-8");
  res.set("Cache-Control", "public, max-age=300");
  res.status(200).send(robots);
});

module.exports = router;