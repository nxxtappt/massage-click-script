function normalizeMetroValue(value = "") {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const MARKETPLACE_METROS = [
  {
    slug: "austin",
    name: "Austin",
    seoLabel: "Austin, TX",
    stateCode: "TX",
    timezone: "America/Chicago",
    latitude: 30.2672,
    longitude: -97.7431,
    mapZoom: 10,
    aliases: [
      "austin",
      "austin tx",
      "austin texas"
    ],
    searchTerms: [
      "austin",
      "round rock",
      "cedar park",
      "pflugerville",
      "georgetown",
      "leander",
      "bee cave",
      "lakeway",
      "buda",
      "kyle",
      "dripping springs",
      "bastrop"
    ]
  },
  {
    slug: "miami",
    name: "Miami",
    seoLabel: "Miami, FL",
    stateCode: "FL",
    timezone: "America/New_York",
    latitude: 25.7617,
    longitude: -80.1918,
    mapZoom: 10,
    aliases: [
      "miami",
      "miami fl",
      "miami florida",
      "miami dade",
      "miami-dade"
    ],
    searchTerms: [
      "miami",
      "miami beach",
      "coral gables",
      "doral",
      "hialeah",
      "kendall",
      "aventura",
      "north miami",
      "homestead",
      "miami gardens",
      "key biscayne"
    ]
  },
  {
    slug: "san-antonio",
    name: "San Antonio",
    seoLabel: "San Antonio, TX",
    stateCode: "TX",
    timezone: "America/Chicago",
    latitude: 29.4241,
    longitude: -98.4936,
    mapZoom: 10,
    aliases: [
      "san antonio",
      "san antonio tx",
      "san antonio texas"
    ],
    searchTerms: [
      "san antonio",
      "new braunfels",
      "schertz",
      "cibolo",
      "boerne",
      "universal city",
      "live oak",
      "converse"
    ]
  },
  {
    slug: "dallas-fort-worth",
    name: "Dallas-Fort Worth",
    seoLabel: "Dallas-Fort Worth, TX",
    stateCode: "TX",
    timezone: "America/Chicago",
    latitude: 32.8998,
    longitude: -97.0403,
    mapZoom: 9,
    aliases: [
      "dallas fort worth",
      "dallas-fort-worth",
      "dfw",
      "dallas",
      "fort worth"
    ],
    searchTerms: [
      "dallas fort worth",
      "dfw",
      "dallas",
      "fort worth",
      "arlington",
      "plano",
      "frisco",
      "irving",
      "garland",
      "richardson",
      "carrollton",
      "addison",
      "grapevine",
      "southlake",
      "colleyville",
      "mckinney",
      "denton"
    ]
  },
  {
    slug: "houston",
    name: "Houston",
    seoLabel: "Houston, TX",
    stateCode: "TX",
    timezone: "America/Chicago",
    latitude: 29.7604,
    longitude: -95.3698,
    mapZoom: 10,
    aliases: [
      "houston",
      "houston tx",
      "houston texas",
      "greater houston"
    ],
    searchTerms: [
      "houston",
      "katy",
      "sugar land",
      "pearland",
      "the woodlands",
      "cypress",
      "spring",
      "humble",
      "pasadena",
      "baytown"
    ]
  }
].map((metro) => ({
  ...metro,
  aliases: [
    ...new Set(
      [
        metro.slug,
        metro.name,
        metro.seoLabel,
        ...(metro.aliases || [])
      ]
        .map(normalizeMetroValue)
        .filter(Boolean)
    )
  ],
  searchTerms: [
    ...new Set(
      (metro.searchTerms || [])
        .map(normalizeMetroValue)
        .filter(Boolean)
    )
  ]
}));

const METRO_LOOKUP = new Map();

for (const metro of MARKETPLACE_METROS) {
  for (const alias of metro.aliases) {
    METRO_LOOKUP.set(alias, metro);
  }
}

function listMarketplaceMetros() {
  return MARKETPLACE_METROS.map((metro) => ({
    ...metro,
    aliases: [...metro.aliases],
    searchTerms: [...metro.searchTerms]
  }));
}

function getMarketplaceMetro(value = "") {
  const normalized = normalizeMetroValue(value);

  if (!normalized) {
    return null;
  }

  return METRO_LOOKUP.get(normalized) || null;
}

function getMarketplaceMetroSearchTerms(value = "") {
  const metro =
    typeof value === "object" && value
      ? value
      : getMarketplaceMetro(value);

  return metro
    ? [...metro.searchTerms]
    : [];
}

function getMarketplaceTimeZone(value = "") {
  return (
    getMarketplaceMetro(value)?.timezone ||
    "America/Chicago"
  );
}

function matchesMarketplaceMetro(
  record = {},
  metroValue = ""
) {
  const metro =
    typeof metroValue === "object" &&
    metroValue
      ? metroValue
      : getMarketplaceMetro(metroValue);

  if (!metro) {
    return false;
  }

  const searchableText =
    normalizeMetroValue(
      [
        record.metro,
        record.metroName,
        record.market,
        record.region,
        record.city,
        record.state,
        record.postalCode,
        record.postal_code,
        record.address
      ]
        .filter(Boolean)
        .join(" ")
    );

  if (!searchableText) {
    return false;
  }

  const paddedText =
    ` ${searchableText} `;

  return metro.searchTerms.some(
    (term) =>
      paddedText.includes(
        ` ${term} `
      )
  );
}

module.exports = {
  normalizeMetroValue,
  listMarketplaceMetros,
  getMarketplaceMetro,
  getMarketplaceMetroSearchTerms,
  getMarketplaceTimeZone,
  matchesMarketplaceMetro
};