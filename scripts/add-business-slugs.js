const fs = require("fs");
const path = require("path");

const filePath = path.join(__dirname, "..", "businesses.json");

function slugify(value = "") {
  return String(value || "business")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 90);
}

const businesses = JSON.parse(fs.readFileSync(filePath, "utf8"));

if (!Array.isArray(businesses)) {
  throw new Error("businesses.json must be an array");
}

const usedSlugs = new Set();

const updated = businesses.map((business) => {
  const businessName = business.businessName || business.name || "business";
  let baseSlug = business.businessSlug || business.slug || slugify(businessName);
  let finalSlug = baseSlug;
  let count = 2;

  while (usedSlugs.has(finalSlug)) {
    finalSlug = `${baseSlug}-${count}`;
    count += 1;
  }

  usedSlugs.add(finalSlug);

  return {
    ...business,
    businessSlug: finalSlug,
    publicPageEnabled: business.publicPageEnabled !== false
  };
});

fs.writeFileSync(filePath, JSON.stringify(updated, null, 2));

console.log(`Added/updated slugs for ${updated.length} businesses.`);