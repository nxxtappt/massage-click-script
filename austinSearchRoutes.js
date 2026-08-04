const express = require("express");
const fs = require("fs/promises");
const path = require("path");
const serviceCategoryRepository = require(
  "./database/serviceCategoryRepository"
);
const {
  listMarketplaceMetros,
  getMarketplaceMetro
} = require("./marketplaceMetros");

const router = express.Router();

const SEARCH_PAGE_PATH = path.join(
  __dirname,
  "public",
  "index.html"
);

function escapeHtmlText(value = "") {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeHtmlAttribute(value = "") {
  return escapeHtmlText(value)
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function escapeRegularExpression(value = "") {
  return String(value || "").replace(
    /[.*+?^${}()|[\]\\]/g,
    "\\$&"
  );
}

function replaceDocumentTitle(html, value) {
  return html.replace(
    /<title>[\s\S]*?<\/title>/i,
    `<title>${escapeHtmlText(value)}</title>`
  );
}

function replaceAttributeById(
  html,
  elementId,
  attributeName,
  attributeValue
) {
  const idPattern =
    escapeRegularExpression(elementId);

  const elementPattern = new RegExp(
    `<([a-zA-Z][\\w:-]*)([^>]*\\bid=(["'])${idPattern}\\3[^>]*)>`,
    "i"
  );

  return html.replace(
    elementPattern,
    (
      fullMatch,
      tagName,
      attributes
    ) => {
      const attributePattern =
        new RegExp(
          `\\s${escapeRegularExpression(
            attributeName
          )}=(["']).*?\\1`,
          "i"
        );

      const escapedValue =
        escapeHtmlAttribute(
          attributeValue
        );

      if (
        attributePattern.test(
          attributes
        )
      ) {
        return `<${tagName}${attributes.replace(
          attributePattern,
          ` ${attributeName}="${escapedValue}"`
        )}>`;
      }

      return `<${tagName}${attributes} ${attributeName}="${escapedValue}">`;
    }
  );
}

function replaceElementTextById(
  html,
  elementId,
  textValue
) {
  const idPattern =
    escapeRegularExpression(elementId);

  const elementPattern =
    new RegExp(
      `(<([a-zA-Z][\\w:-]*)[^>]*\\bid=(["'])${idPattern}\\3[^>]*>)[\\s\\S]*?(<\\/\\2>)`,
      "i"
    );

  return html.replace(
    elementPattern,
    `$1${escapeHtmlText(
      textValue
    )}$4`
  );
}

function replaceBodyContext(
  html,
  context
) {
  const bodyTag = [
    "<body",
    ` data-metro-slug="${escapeHtmlAttribute(
      context.metroSlug
    )}"`,
    ` data-metro-name="${escapeHtmlAttribute(
      context.metroName
    )}"`,
    ` data-metro-timezone="${escapeHtmlAttribute(
      context.metroTimezone
    )}"`,
    ` data-metro-latitude="${escapeHtmlAttribute(
      context.metroLatitude
    )}"`,
    ` data-metro-longitude="${escapeHtmlAttribute(
      context.metroLongitude
    )}"`,
    ` data-metro-zoom="${escapeHtmlAttribute(
      context.metroZoom
    )}"`,
    ` data-category-slug="${escapeHtmlAttribute(
      context.categorySlug
    )}"`,
    ` data-category-name="${escapeHtmlAttribute(
      context.categoryName
    )}"`,
    ` data-category-description="${escapeHtmlAttribute(
      context.categoryDescription
    )}"`,
    ">"
  ].join("");

  return html.replace(
    /<body\b[^>]*>/i,
    bodyTag
  );
}

function buildMarketplacePageContext(
  metro,
  category = null,
  businessCount = 0
) {
  const categorySlug =
    category?.slug || "";

  const categoryName =
    category?.display_name || "";

  const categoryDescription =
    category?.description || "";

  const lowercaseCategory =
    categoryName.toLowerCase();

  const pathname = categorySlug
    ? `/${metro.slug}/${categorySlug}`
    : `/${metro.slug}`;

  const title = categoryName
    ? `${categoryName} Appointments in ${metro.seoLabel} | Live Availability | NextAppt.ai`
    : `Appointments in ${metro.seoLabel} | Live Availability | NextAppt.ai`;

  const description = categoryName
    ? [
        categoryDescription ||
          `Find ${lowercaseCategory} appointments in ${metro.name}.`,
        `Search live ${lowercaseCategory} appointment availability across the ${metro.name} area with NextAppt.ai.`
      ].join(" ")
    : `Search live appointment availability across the ${metro.name} area. Compare fresh openings from local appointment-based businesses with NextAppt.ai.`;

  const keywords = categoryName
    ? [
        `${lowercaseCategory} ${metro.name}`,
        `${lowercaseCategory} appointments ${metro.name}`,
        `${lowercaseCategory} near me`,
        `${lowercaseCategory} availability`,
        `${metro.name} appointment booking`
      ].join(", ")
    : [
        `appointments ${metro.name}`,
        `appointment availability ${metro.name}`,
        "appointments near me",
        `${metro.name} appointment booking`
      ].join(", ");

  const heroTitle = categoryName
    ? `Available ${categoryName} Appointments in ${metro.name}`
    : `Available Appointments in ${metro.name}`;

  const heroSubtitle = categoryName
    ? categoryDescription ||
      `Search freshly updated ${lowercaseCategory} appointment availability across the ${metro.name} area.`
    : `Search freshly updated appointment availability from businesses across the ${metro.name} area.`;

  const searchPlaceholder = categoryName
    ? categorySlug === "massage"
      ? `Example: I need a prenatal massage tomorrow afternoon in ${metro.name}...`
      : `Example: I need a ${lowercaseCategory} appointment tomorrow afternoon...`
    : `Example: I need an appointment tomorrow afternoon in ${metro.name}...`;

  const indexable =
    !categorySlug ||
    Number(businessCount || 0) > 0;

  return {
    metroSlug: metro.slug,
    metroName: metro.name,
    metroTimezone: metro.timezone,
    metroLatitude: metro.latitude,
    metroLongitude: metro.longitude,
    metroZoom: metro.mapZoom,
    categorySlug,
    categoryName,
    categoryDescription,
    businessCount:
      Number(businessCount || 0),
    pathname,
    canonicalUrl:
      `https://nextappt.ai${pathname}`,
    title,
    description,
    keywords,
    robots: indexable
      ? "index,follow"
      : "noindex,follow",
    heroTitle,
    heroSubtitle,
    searchPlaceholder,
    openGraphTitle: categoryName
      ? `${categoryName} Appointments in ${metro.seoLabel} | Live Availability`
      : `Appointments in ${metro.seoLabel} | Live Availability`,
    twitterDescription: categoryName
      ? `Search live ${lowercaseCategory} appointment availability across ${metro.name} with NextAppt.ai.`
      : `Search live appointment availability across ${metro.name} with NextAppt.ai.`
  };
}

function renderMarketplaceSearchHtml(
  templateHtml,
  context
) {
  let html =
    String(templateHtml || "");

  html = replaceDocumentTitle(
    html,
    context.title
  );

  html = replaceAttributeById(
    html,
    "metaDescription",
    "content",
    context.description
  );

  html = replaceAttributeById(
    html,
    "metaKeywords",
    "content",
    context.keywords
  );

  html = replaceAttributeById(
    html,
    "metaRobots",
    "content",
    context.robots
  );

  html = replaceAttributeById(
    html,
    "canonicalUrl",
    "href",
    context.canonicalUrl
  );

  html = replaceAttributeById(
    html,
    "openGraphTitle",
    "content",
    context.openGraphTitle
  );

  html = replaceAttributeById(
    html,
    "openGraphDescription",
    "content",
    context.description
  );

  html = replaceAttributeById(
    html,
    "openGraphUrl",
    "content",
    context.canonicalUrl
  );

  html = replaceAttributeById(
    html,
    "twitterTitle",
    "content",
    context.openGraphTitle
  );

  html = replaceAttributeById(
    html,
    "twitterDescription",
    "content",
    context.twitterDescription
  );

  html = replaceElementTextById(
    html,
    "heroTitle",
    context.heroTitle
  );

  html = replaceElementTextById(
    html,
    "heroSubtitle",
    context.heroSubtitle
  );

  html = replaceAttributeById(
    html,
    "searchInput",
    "placeholder",
    context.searchPlaceholder
  );

  html = replaceBodyContext(
    html,
    context
  );

  return html;
}

async function getMetroCategoryBusinessCount(
  metro,
  categorySlug
) {
  if (!categorySlug) {
    return 0;
  }

  const rows =
    await serviceCategoryRepository
      .getCategoryBusinessCounts({
        metroTerms:
          metro.searchTerms
      });

  const match =
    rows.find(
      (row) =>
        row.slug === categorySlug
    );

  return Number(
    match?.business_count || 0
  );
}

async function sendMarketplaceSearchPage(
  res,
  metro,
  category = null
) {
  const businessCount =
    await getMetroCategoryBusinessCount(
      metro,
      category?.slug || ""
    );

  const context =
    buildMarketplacePageContext(
      metro,
      category,
      businessCount
    );

  const templateHtml =
    await fs.readFile(
      SEARCH_PAGE_PATH,
      "utf8"
    );

  const html =
    renderMarketplaceSearchHtml(
      templateHtml,
      context
    );

  res.set(
    "Cache-Control",
    "public, max-age=60"
  );

  res
    .status(200)
    .type("html")
    .send(html);
}

for (
  const metro
  of listMarketplaceMetros()
) {
  router.get(
    `/${metro.slug}`,
    async (req, res) => {
      try {
        await sendMarketplaceSearchPage(
          res,
          metro
        );
      } catch (error) {
        console.error(
          "[MARKETPLACE METRO PAGE ERROR]",
          {
            metro: metro.slug,
            error
          }
        );

        res
          .status(500)
          .type("text")
          .send(
            `Unable to load ${metro.name} appointments.`
          );
      }
    }
  );

  router.get(
    `/${metro.slug}/:category`,
    async (req, res) => {
      try {
        const categorySlug =
          serviceCategoryRepository
            .normalizeCategorySlug(
              req.params.category
            );

        if (
          categorySlug &&
          req.params.category !==
            categorySlug
        ) {
          return res.redirect(
            301,
            `/${metro.slug}/${categorySlug}`
          );
        }

        const category =
          await serviceCategoryRepository
            .getCategoryBySlug(
              categorySlug
            );

        if (!category) {
          return res
            .status(404)
            .type("text")
            .send(
              "Appointment category not found."
            );
        }

        await sendMarketplaceSearchPage(
          res,
          metro,
          category
        );
      } catch (error) {
        console.error(
          "[MARKETPLACE CATEGORY PAGE ERROR]",
          {
            metro: metro.slug,
            category:
              req.params.category,
            error
          }
        );

        res
          .status(500)
          .type("text")
          .send(
            "Unable to load this appointment category."
          );
      }
    }
  );
}

module.exports = router;
module.exports.buildMarketplacePageContext =
  buildMarketplacePageContext;
module.exports.renderMarketplaceSearchHtml =
  renderMarketplaceSearchHtml;
module.exports.getMetroCategoryBusinessCount =
  getMetroCategoryBusinessCount;
module.exports.sendMarketplaceSearchPage =
  sendMarketplaceSearchPage;

/*
 * Backward-compatible exports retained for the existing
 * Austin verification script and any older imports.
 */
module.exports.buildAustinPageContext =
  (category = null, businessCount = 0) =>
    buildMarketplacePageContext(
      getMarketplaceMetro("austin"),
      category,
      businessCount
    );

module.exports.renderAustinSearchHtml =
  renderMarketplaceSearchHtml;

module.exports.getAustinCategoryBusinessCount =
  async (categorySlug) =>
    getMetroCategoryBusinessCount(
      getMarketplaceMetro("austin"),
      categorySlug
    );