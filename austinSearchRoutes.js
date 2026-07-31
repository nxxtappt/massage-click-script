const express = require("express");
const fs = require("fs/promises");
const path = require("path");
const serviceCategoryRepository = require(
  "./database/serviceCategoryRepository"
);

const router = express.Router();

const AUSTIN_METRO_NAME = "Austin";
const AUSTIN_METRO_SLUG = "austin";
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
  const idPattern = escapeRegularExpression(elementId);
  const elementPattern = new RegExp(
    `<([a-zA-Z][\\w:-]*)([^>]*\\bid=(["'])${idPattern}\\3[^>]*)>`,
    "i"
  );

  return html.replace(
    elementPattern,
    (fullMatch, tagName, attributes) => {
      const attributePattern = new RegExp(
        `\\s${escapeRegularExpression(attributeName)}=(["']).*?\\1`,
        "i"
      );
      const escapedValue =
        escapeHtmlAttribute(attributeValue);

      if (attributePattern.test(attributes)) {
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
  const idPattern = escapeRegularExpression(elementId);
  const elementPattern = new RegExp(
    `(<([a-zA-Z][\\w:-]*)[^>]*\\bid=(["'])${idPattern}\\3[^>]*>)[\\s\\S]*?(<\\/\\2>)`,
    "i"
  );

  return html.replace(
    elementPattern,
    `$1${escapeHtmlText(textValue)}$4`
  );
}

function replaceBodyContext(html, context) {
  const bodyTag = [
    "<body",
    ` data-metro-slug="${escapeHtmlAttribute(context.metroSlug)}"`,
    ` data-metro-name="${escapeHtmlAttribute(context.metroName)}"`,
    ` data-category-slug="${escapeHtmlAttribute(context.categorySlug)}"`,
    ` data-category-name="${escapeHtmlAttribute(context.categoryName)}"`,
    ` data-category-description="${escapeHtmlAttribute(
      context.categoryDescription
    )}"`,
    ">"
  ].join("");

  return html.replace(/<body\b[^>]*>/i, bodyTag);
}

function buildAustinPageContext(
  category = null,
  businessCount = 0
) {
  const categorySlug = category?.slug || "";
  const categoryName = category?.display_name || "";
  const categoryDescription =
    category?.description || "";
  const lowercaseCategory =
    categoryName.toLowerCase();

  const pathname = categorySlug
    ? `/austin/${categorySlug}`
    : "/austin";

  const title = categoryName
    ? `${categoryName} Appointments in Austin, TX | Live Availability | NextAppt.ai`
    : "Appointments in Austin, TX | Live Availability | NextAppt.ai";

  const description = categoryName
    ? [
        categoryDescription ||
          `Find ${lowercaseCategory} appointments in Austin.`,
        `Search live ${lowercaseCategory} appointment availability across Austin, Texas with NextAppt.ai.`
      ].join(" ")
    : "Search live appointment availability across Austin, Texas. Compare fresh openings from local appointment-based businesses with NextAppt.ai.";

  const keywords = categoryName
    ? [
        `${lowercaseCategory} Austin`,
        `${lowercaseCategory} appointments Austin`,
        `${lowercaseCategory} near me`,
        `${lowercaseCategory} availability`,
        "Austin appointment booking"
      ].join(", ")
    : [
        "appointments Austin",
        "appointment availability Austin",
        "appointments near me",
        "Austin appointment booking"
      ].join(", ");

  const heroTitle = categoryName
    ? `Available ${categoryName} Appointments in Austin`
    : "Available Appointments in Austin";

  const heroSubtitle = categoryName
    ? categoryDescription ||
      `Search freshly updated ${lowercaseCategory} appointment availability across Austin.`
    : "Search freshly updated appointment availability from businesses across the Austin area.";

  const searchPlaceholder = categoryName
    ? categorySlug === "massage"
      ? "Example: I need a prenatal massage tomorrow between 2 and 6..."
      : `Example: I need a ${lowercaseCategory} appointment tomorrow afternoon...`
    : "Example: I need an appointment tomorrow between 2 and 6...";

  const indexable =
    !categorySlug || Number(businessCount || 0) > 0;

  return {
    metroSlug: AUSTIN_METRO_SLUG,
    metroName: AUSTIN_METRO_NAME,
    categorySlug,
    categoryName,
    categoryDescription,
    businessCount: Number(businessCount || 0),
    pathname,
    canonicalUrl: `https://nextappt.ai${pathname}`,
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
      ? `${categoryName} Appointments in Austin, TX | Live Availability`
      : "Appointments in Austin, TX | Live Availability",
    twitterDescription: categoryName
      ? `Search live ${lowercaseCategory} appointment availability across Austin with NextAppt.ai.`
      : "Search live appointment availability across Austin with NextAppt.ai."
  };
}

function renderAustinSearchHtml(
  templateHtml,
  context
) {
  let html = String(templateHtml || "");

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

  html = replaceBodyContext(html, context);

  return html;
}

async function getAustinCategoryBusinessCount(
  categorySlug
) {
  if (!categorySlug) {
    return 0;
  }

  const rows =
    await serviceCategoryRepository
      .getCategoryBusinessCounts({
        metro: AUSTIN_METRO_NAME
      });

  const match = rows.find(
    (row) => row.slug === categorySlug
  );

  return Number(match?.business_count || 0);
}

async function sendAustinSearchPage(
  res,
  category = null
) {
  const businessCount =
    await getAustinCategoryBusinessCount(
      category?.slug || ""
    );

  const context = buildAustinPageContext(
    category,
    businessCount
  );

  const templateHtml = await fs.readFile(
    SEARCH_PAGE_PATH,
    "utf8"
  );

  const html = renderAustinSearchHtml(
    templateHtml,
    context
  );

  res.set(
    "Cache-Control",
    "public, max-age=60"
  );

  res.status(200).type("html").send(html);
}

router.get("/austin", async (req, res) => {
  try {
    await sendAustinSearchPage(res);
  } catch (error) {
    console.error(
      "[AUSTIN SEARCH PAGE ERROR]",
      error
    );

    res.status(500).type("text").send(
      "Unable to load Austin appointments."
    );
  }
});

router.get(
  "/austin/:category",
  async (req, res) => {
    try {
      const categorySlug =
        serviceCategoryRepository
          .normalizeCategorySlug(
            req.params.category
          );

      if (
        categorySlug &&
        req.params.category !== categorySlug
      ) {
        return res.redirect(
          301,
          `/austin/${categorySlug}`
        );
      }

      const category =
        await serviceCategoryRepository
          .getCategoryBySlug(categorySlug);

      if (!category) {
        return res
          .status(404)
          .type("text")
          .send("Appointment category not found.");
      }

      await sendAustinSearchPage(
        res,
        category
      );
    } catch (error) {
      console.error(
        "[AUSTIN CATEGORY PAGE ERROR]",
        error
      );

      res.status(500).type("text").send(
        "Unable to load this appointment category."
      );
    }
  }
);

module.exports = router;
module.exports.buildAustinPageContext =
  buildAustinPageContext;
module.exports.renderAustinSearchHtml =
  renderAustinSearchHtml;
module.exports.getAustinCategoryBusinessCount =
  getAustinCategoryBusinessCount;