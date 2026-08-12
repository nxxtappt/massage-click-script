from pathlib import Path

ROOT = Path.cwd()


def read(rel):
    p = ROOT / rel
    if not p.exists():
        raise RuntimeError(f"{rel} not found")
    return p.read_text()


def backup(rel, source):
    p = ROOT / rel
    b = Path(str(p) + ".pre-square-v5")
    if not b.exists():
        b.write_text(source)
        print(f"[BACKUP] {rel} -> {b.name}")


def write(rel, source):
    (ROOT / rel).write_text(source)
    print(f"[PATCHED] {rel}")


def replace_between(source, start_marker, end_marker, replacement, label):
    start = source.find(start_marker)
    if start < 0:
        raise RuntimeError(f"Could not find {label} start marker")
    end = source.find(end_marker, start)
    if end < 0:
        raise RuntimeError(f"Could not find {label} end marker")
    return source[:start] + replacement + source[end:]


PARSE_BOOKING_HELPER = r'''function parseSquareBookingUrl(value = "") {
  const urlText = sanitizeSquareUrl(value);

  const result = {
    url: urlText,
    isDirectBooking: false,
    bookingBusinessId: "",
    locationId: "",
    routeType: ""
  };

  if (!urlText) return result;

  try {
    const parsed = new URL(urlText);
    const hostname = parsed.hostname.toLowerCase();
    const pathname = parsed.pathname;

    const directMatch = pathname.match(
      /\/appointments\/([^/]+)\/location\/([^/]+)(?:\/|$)/i
    );

    if (
      directMatch &&
      (hostname === "book.squareup.com" ||
        hostname === "app.squareup.com" ||
        hostname.endsWith(".squareup.com"))
    ) {
      result.isDirectBooking = true;
      result.bookingBusinessId = decodeURIComponent(directMatch[1]);
      result.locationId = decodeURIComponent(directMatch[2]);
      result.routeType = "book_squareup_appointments";
      return result;
    }

    const buyerStartMatch = pathname.match(
      /\/appointments\/book\/([^/]+)\/start(?:\/|$)/i
    );

    if (
      buyerStartMatch &&
      (hostname === "app.squareup.com" ||
        hostname === "book.squareup.com")
    ) {
      result.isDirectBooking = true;
      result.locationId = decodeURIComponent(buyerStartMatch[1]);
      result.routeType = "square_buyer_start";
      return result;
    }

    const legacyBookMatch = pathname.match(/^\/book\/([^/]+)(?:\/|$)/i);

    if (
      legacyBookMatch &&
      (hostname === "square.site" || hostname.endsWith(".square.site"))
    ) {
      result.isDirectBooking = true;
      result.locationId = decodeURIComponent(legacyBookMatch[1]);
      result.routeType = "square_site_book";
      return result;
    }
  } catch {
    // Leave the default empty parse result.
  }

  return result;
}
'''

NORMALIZE_TARGET = r'''function normalizeSquareTarget(input = {}) {
  const target = { ...input };

  const bookingUrl = sanitizeSquareUrl(
    getSquareField(target, ["bookingUrl", "booking_url"], target.bookingUrl || "")
  );

  const parsedBookingUrl = parseSquareBookingUrl(bookingUrl);

  const squareSiteUrl = sanitizeSquareUrl(
    getSquareField(target, [
      "squareSiteUrl",
      "square_site_url",
      "squareWebsiteUrl",
      "square_website_url"
    ])
  );

  const squareSyncBase = sanitizeSquareUrl(
    getSquareField(target, ["squareSyncBase", "square_sync_base"])
  );

  const explicitLocationId = String(
    getSquareField(target, [
      "squareLocationId",
      "square_location_id",
      "locationId",
      "location_id",
      "unitToken",
      "unit_token"
    ], "")
  );

  const explicitBookingBusinessId = String(
    getSquareField(target, [
      "squareBookingBusinessId",
      "square_booking_business_id",
      "bookingBusinessId",
      "booking_business_id"
    ], "")
  );

  return {
    ...target,
    bookingUrl,
    squareSiteUrl,
    squareSyncBase,
    squareBookingBusinessId:
      explicitBookingBusinessId || parsedBookingUrl.bookingBusinessId || "",
    squarePublishedUserId: String(
      getSquareField(target, [
        "squarePublishedUserId",
        "square_published_user_id",
        "publishedUserId",
        "published_user_id"
      ], "")
    ),
    squareSiteId: String(
      getSquareField(target, [
        "squareSiteId",
        "square_site_id",
        "siteId",
        "site_id"
      ], "")
    ),
    squareLocationId:
      explicitLocationId || parsedBookingUrl.locationId || "",
    squareServiceVariationId: String(
      getSquareField(target, [
        "squareServiceVariationId",
        "square_service_variation_id",
        "serviceVariationId",
        "service_variation_id",
        "platformServiceVariationId",
        "platform_service_variation_id"
      ], target.squareServiceVariationId || "")
    )
  };
}

'''

DISCOVER_CONTEXT = r'''async function discoverSquareContext(target = {}) {
  target = normalizeSquareTarget(target);

  const parsedBookingUrl = parseSquareBookingUrl(target.bookingUrl);

  const explicitSyncBase = sanitizeSquareUrl(
    getSquareField(
      target,
      ["squareSyncBase", "square_sync_base"],
      target.squareSyncBase
    )
  );

  if (explicitSyncBase) {
    const base = explicitSyncBase.replace(/\/+$/, "");

    return {
      squareSiteOrigin:
        getSquareField(target, ["squareSiteOrigin", "square_site_origin"]) ||
        getSquareSiteOrigin(target) ||
        "",
      publishedUserId: target.squarePublishedUserId || "",
      siteId: target.squareSiteId || "",
      syncBase: base,
      bookingBusinessId:
        target.squareBookingBusinessId || parsedBookingUrl.bookingBusinessId || "",
      locationId:
        target.squareLocationId || parsedBookingUrl.locationId || "",
      directBookingUrl: target.bookingUrl || "",
      discoveryMethod: "explicit_sync_base"
    };
  }

  const squareSiteOrigin =
    getSquareField(target, ["squareSiteOrigin", "square_site_origin"]) ||
    getSquareSiteOrigin(target);

  const explicitUserId = target.squarePublishedUserId || "";
  const explicitSiteId = target.squareSiteId || "";

  if (squareSiteOrigin && explicitUserId && explicitSiteId) {
    return {
      squareSiteOrigin,
      publishedUserId: String(explicitUserId),
      siteId: String(explicitSiteId),
      syncBase:
        `${squareSiteOrigin}/app/square-sync/published/users/` +
        `${explicitUserId}/site/${explicitSiteId}/appointments`,
      bookingBusinessId:
        target.squareBookingBusinessId || parsedBookingUrl.bookingBusinessId || "",
      locationId:
        target.squareLocationId || parsedBookingUrl.locationId || "",
      directBookingUrl: target.bookingUrl || "",
      discoveryMethod: "explicit_ids"
    };
  }

  if (parsedBookingUrl.isDirectBooking) {
    return {
      squareSiteOrigin: "",
      publishedUserId: "",
      siteId: "",
      syncBase: "",
      bookingBusinessId:
        target.squareBookingBusinessId || parsedBookingUrl.bookingBusinessId || "",
      locationId:
        target.squareLocationId || parsedBookingUrl.locationId || "",
      directBookingUrl: target.bookingUrl || parsedBookingUrl.url || "",
      directRouteType: parsedBookingUrl.routeType || "",
      discoveryMethod: "direct_booking"
    };
  }

  if (!squareSiteOrigin) {
    throw new Error(
      "Square scraper could not determine a usable booking discovery path. " +
        "Save a public Square Booking URL. For Square Online sites you may also " +
        "save squareSiteUrl plus squarePublishedUserId/squareSiteId."
    );
  }

  const { text } = await fetchText(`${squareSiteOrigin}/`, {
    headers: {
      accept: "text/html,application/xhtml+xml"
    }
  });

  const discovered = findPublishedIdsInText(text);

  if (!discovered) {
    throw new Error(
      "Square site loaded, but published user/site IDs were not discoverable from HTML. " +
        "If this merchant has a book.squareup.com appointment URL, save that as Booking URL. " +
        "Otherwise save squarePublishedUserId and squareSiteId on the business integration. " +
        `Square site: ${squareSiteOrigin}`
    );
  }

  return {
    squareSiteOrigin,
    ...discovered,
    syncBase:
      `${squareSiteOrigin}/app/square-sync/published/users/` +
      `${discovered.publishedUserId}/site/${discovered.siteId}/appointments`,
    bookingBusinessId: target.squareBookingBusinessId || "",
    locationId: target.squareLocationId || "",
    directBookingUrl: target.bookingUrl || "",
    discoveryMethod: "square_site_html"
  };
}

'''

DIRECT_SCRAPER = r'''async function scrapeSquareDirectBookingBusiness(
  target = {},
  context = {},
  startedAt = Date.now()
) {
  const timeZone = target.timezone || DEFAULT_TIMEZONE;
  const window = resolveScrapeWindow({
    ...target,
    timezone: timeZone
  });

  const parsedBookingUrl = parseSquareBookingUrl(
    context.directBookingUrl || target.bookingUrl
  );

  const locationId =
    context.locationId ||
    target.squareLocationId ||
    parsedBookingUrl.locationId ||
    "";

  if (!locationId) {
    throw new Error(
      "Square direct booking flow is missing a location ID. " +
        "Use a booking URL containing /location/{LOCATION_ID}/ or save Square Location ID."
    );
  }

  const serviceItemId =
    target.platformServiceId ||
    target.serviceId ||
    target.serviceButtonId ||
    "";

  const serviceName = target.serviceName || target.service || "";

  console.log("[SQUARE] Direct booking discovery", {
    businessName: target.businessName || target.name,
    serviceName,
    bookingBusinessId:
      context.bookingBusinessId ||
      target.squareBookingBusinessId ||
      parsedBookingUrl.bookingBusinessId ||
      "",
    locationId,
    bookingUrl: context.directBookingUrl || target.bookingUrl
  });

  const availabilityPayload = await fetchSquareAvailabilityInBrowser({
    bookingUrl: context.directBookingUrl || target.bookingUrl || "",
    buyerStartUrl: context.directBookingUrl || target.bookingUrl || "",
    payload: null,
    serviceName,
    staffProfiles: [],
    timeoutMs: Math.max(Number(target.squareTimeoutMs || 20000), 35000)
  });

  const capturedRequest =
    availabilityPayload.__nextapptSquareCapturedRequest || null;

  const capturedFilter =
    capturedRequest?.search_availability_request?.query?.filter || null;

  const capturedSegment = capturedFilter?.segment_filters?.[0] || null;

  const resolvedLocationId = String(
    capturedFilter?.location_id || locationId || ""
  );

  const capturedVariationId = String(
    capturedSegment?.service_variation_id || ""
  );

  const resolvedVariationId =
    capturedVariationId || target.squareServiceVariationId || "";

  const capturedTeamMemberIds = Array.isArray(
    capturedSegment?.team_member_id_filter?.any
  )
    ? capturedSegment.team_member_id_filter.any.map(String)
    : [];

  const selectedService = {
    itemId: serviceItemId || resolvedVariationId || "",
    variationId: resolvedVariationId || serviceItemId || "",
    serviceName,
    variationName: "",
    description: "",
    durationMinutes: toNumberOrNull(target.durationMinutes),
    priceAmount: null,
    currency: "USD",
    priceDescription: "",
    teamMemberIds: capturedTeamMemberIds,
    transitionTimeMinutes: null,
    availableForBooking: true
  };

  const appointments = normalizeSquareAppointments(
    availabilityPayload,
    {
      target,
      service: selectedService,
      locationId: resolvedLocationId,
      timeZone
    }
  ).filter((appointment) => {
    const dateKey = appointment.localDateKey || "";
    if (window.startDate && dateKey && dateKey < window.startDate) return false;
    if (window.endDate && dateKey && dateKey > window.endDate) return false;
    return true;
  });

  return {
    businessName: target.businessName || target.name || "",
    bookingUrl: target.bookingUrl || "",
    platform: "square",
    service: serviceName,
    serviceName,
    serviceType: target.serviceType || target.serviceCategory || "hair",
    durationMinutes: toNumberOrNull(target.durationMinutes),
    platformServiceId:
      target.platformServiceId || target.serviceId || selectedService.itemId || null,
    provider: target.providerText || "Any available staff",
    date: null,
    times: appointments.map((appointment) => appointment.startTime),
    status: appointments.length > 0 ? "success" : "no_times_found",
    error: null,
    scrapeDurationMs: Date.now() - startedAt,
    lastChecked: new Date().toISOString(),
    appointments,
    openings: appointments,
    price: null,
    distanceMiles:
      typeof target.distanceMiles === "number" ? target.distanceMiles : null,
    scrapeStartDate: window.startDate,
    scrapeEndDate: window.endDate,
    lookaheadHours: target.lookaheadHours ? Number(target.lookaheadHours) : null,
    daysForward: target.daysForward ? Number(target.daysForward) : null,
    scrapeWindowMode: target.scrapeWindowMode || "",
    rawWidgetText: null,
    squareMeta: {
      scraperVersion: NEXTAPPT_SQUARE_SCRAPER_VERSION,
      availabilityTransport:
        availabilityPayload.__nextapptSquareTransport || "native_browser_capture",
      squareSiteOrigin: "",
      publishedUserId: "",
      siteId: "",
      syncBase: "",
      discoveryMethod: "direct_booking",
      directRouteType: context.directRouteType || parsedBookingUrl.routeType || "",
      bookingBusinessId:
        context.bookingBusinessId ||
        target.squareBookingBusinessId ||
        parsedBookingUrl.bookingBusinessId ||
        "",
      locationId: resolvedLocationId,
      serviceItemId: selectedService.itemId || null,
      serviceVariationId: resolvedVariationId || null,
      discoveredServiceName: serviceName,
      variationName: "",
      durationMinutes: selectedService.durationMinutes,
      priceAmount: null,
      currency: selectedService.currency,
      eligibleTeamMemberIds: capturedTeamMemberIds,
      staffProfiles: [],
      discoveredServiceCount: null,
      rawAvailabilityCount: collectAvailabilitySlots(availabilityPayload).length,
      normalizedAppointmentCount: appointments.length,
      buyerStartUrl:
        availabilityPayload.__nextapptSquareFinalUrl ||
        context.directBookingUrl ||
        target.bookingUrl ||
        "",
      requestWindow: {
        startAt: window.startAt,
        endAt: window.endAt
      },
      capturedNativeRequest: capturedRequest
    }
  };
}

'''

SQUARE_DEFINITION = r'''    square: {
      key: "square",
      label: "Square Appointments",
      description:
        "Square public booking pages with automatic Square Online or direct booking discovery.",
      capabilities: ["scrape", "service_discovery", "provider_selection"],
      integrationTypes: ["scrape"],
      integrationFields: [
        bookingUrl,
        text("squareBookingBusinessId", "Square Booking Business ID", {
          storage: "config",
          aliases: ["bookingBusinessId", "square_booking_business_id"],
          help:
            "Optional. Automatically parsed from book.squareup.com/appointments/{BUSINESS_ID}/... URLs when present."
        }),
        text("squareLocationId", "Square Location ID", {
          storage: "config",
          aliases: ["locationId", "unitToken", "square_location_id"],
          help:
            "Optional when the Booking URL contains /location/{LOCATION_ID}/ or square.site/book/{LOCATION_ID}/."
        }),
        url("squareSiteUrl", "Square Site URL", {
          storage: "config",
          aliases: ["squareWebsiteUrl", "square_site_url"],
          help:
            "Optional fast-discovery path for merchants with a public *.square.site Square Online site."
        }),
        text("squarePublishedUserId", "Square Published User ID", {
          storage: "config",
          aliases: ["publishedUserId", "square_published_user_id"],
          help:
            "Optional. Used with Square Site ID for the faster square-sync discovery path."
        }),
        text("squareSiteId", "Square Site ID", {
          storage: "config",
          aliases: ["siteId", "square_site_id"],
          help:
            "Optional. Used with Square Published User ID for the faster square-sync discovery path."
        }),
        text("businessLocationId", "Square Business Location UUID", {
          storage: "config",
          aliases: ["squareBusinessLocationId", "business_location_id"],
          help: "Optional Square booking business-location UUID when known."
        }),
        text("squareBusinessId", "Square Booking Business UUID", {
          storage: "config",
          aliases: ["businessId", "square_business_id"],
          help: "Optional legacy/internal Square booking business UUID when known."
        }),
        text("squareClientId", "Square Booking Client ID", {
          storage: "config",
          aliases: ["clientId", "square_client_id"],
          help: "Optional public Square booking client/application ID."
        })
      ],
      serviceFields: [
        ...commonServiceFields,
        text("platformServiceId", "Square Service Item / Variation ID", {
          required: true,
          storage: "service",
          aliases: [
            "serviceId",
            "serviceButtonId",
            "itemId",
            "serviceVariationId",
            "squareServiceVariationId"
          ],
          help:
            "Square service/item ID. square-sync mode resolves parent ITEM IDs; direct-booking mode captures the actual variation from Square's native buyer request."
        }),
        text("staffId", "Square Staff ID", {
          storage: "serviceConfig",
          aliases: ["squareStaffId"]
        }),
        text("providerText", "Provider Text", {
          storage: "serviceConfig",
          defaultValue: "Any available staff"
        })
      ]
    },'''


def patch_square_js():
    rel = "scrapers/square.js"
    source = read(rel)
    backup(rel, source)

    source = source.replace(
        'const NEXTAPPT_SQUARE_SCRAPER_VERSION = "4.0.0";',
        'const NEXTAPPT_SQUARE_SCRAPER_VERSION = "5.0.0";'
    )

    if "function parseSquareBookingUrl(" not in source:
        marker = "\nfunction getSquareConfigSources"
        if marker not in source:
            raise RuntimeError("Could not find Square config-source insertion marker")
        source = source.replace(
            marker,
            "\n" + PARSE_BOOKING_HELPER + "\nfunction getSquareConfigSources",
            1
        )

    source = replace_between(
        source,
        "function normalizeSquareTarget(input = {}) {",
        'function normalizeText(value = "") {',
        NORMALIZE_TARGET,
        "normalizeSquareTarget"
    )

    source = replace_between(
        source,
        "async function discoverSquareContext(target = {}) {",
        "function collectCatalogItems(payload) {",
        DISCOVER_CONTEXT,
        "discoverSquareContext"
    )

    source = source.replace(
        "    let result = await waitForNative(8000);",
        "    let result = null;\n    if (payload) {\n      result = await waitForNative(8000);\n    } else {\n      await page.waitForTimeout(2000);\n    }",
        1
    )

    native_old = '''    if (native) {
      native.__nextapptSquareTransport = "native_browser_capture";
      return native;
    }

    // If the UI did not naturally trigger availability, the session is now
    // initialized. Retry the exact payload from inside that browser session.'''

    native_new = r'''    if (native) {
      const captured = [...capturedResponses]
        .reverse()
        .find(
          (entry) =>
            entry.status === 200 &&
            entry.json === native
        ) || null;

      native.__nextapptSquareTransport = "native_browser_capture";
      native.__nextapptSquareCapturedRequest = captured?.postDataJson || null;
      native.__nextapptSquareFinalUrl = page.url();
      return native;
    }

    if (!payload) {
      const bodyText = await page
        .locator("body")
        .innerText({ timeout: 3000 })
        .catch(() => "");

      throw new Error(
        "Square direct booking flow did not emit a native availability request. " +
          `Final URL: ${page.url()}. ` +
          `Native requests: ${capturedRequests.length}; responses: ${capturedResponses.length}. ` +
          `Actions: ${actionLog.join(", ") || "none"}. ` +
          `Page text sample: ${String(bodyText).replace(/\s+/g, " ").slice(0, 500)}`
      );
    }

    // If the UI did not naturally trigger availability, the session is now
    // initialized. Retry the exact payload from inside that browser session.'''

    if "__nextapptSquareCapturedRequest" not in source:
        if native_old not in source:
            raise RuntimeError("Could not find Square native-browser return block")
        source = source.replace(native_old, native_new, 1)

    if "async function scrapeSquareDirectBookingBusiness(" not in source:
        marker = "async function scrapeSquareBusiness(target = {}) {"
        if marker not in source:
            raise RuntimeError("Could not find scrapeSquareBusiness insertion marker")
        source = source.replace(marker, DIRECT_SCRAPER + marker, 1)

    context_old = '''  const context = await discoverSquareContext(target);
  const discovery = await fetchSquareDiscoveryData(context, target);'''
    context_new = '''  const context = await discoverSquareContext(target);

  if (context.discoveryMethod === "direct_booking") {
    return scrapeSquareDirectBookingBusiness(target, context, startedAt);
  }

  const discovery = await fetchSquareDiscoveryData(context, target);'''

    if 'context.discoveryMethod === "direct_booking"' not in source:
        if context_old not in source:
            raise RuntimeError("Could not find scrapeSquareBusiness discovery block")
        source = source.replace(context_old, context_new, 1)

    if "  parseSquareBookingUrl," not in source:
        source = source.replace(
            "  sanitizeSquareUrl,\n",
            "  sanitizeSquareUrl,\n  parseSquareBookingUrl,\n",
            1
        )

    if "  scrapeSquareDirectBookingBusiness," not in source:
        source = source.replace(
            "  scrapeSquareBusiness,\n",
            "  scrapeSquareBusiness,\n  scrapeSquareDirectBookingBusiness,\n",
            1
        )

    write(rel, source)


def patch_platform_definitions():
    rel = "public/platformDefinitions.js"
    source = read(rel)
    backup(rel, source)
    source = replace_between(
        source,
        "    square: {",
        "\n\n    mangomint:",
        SQUARE_DEFINITION,
        "Square platform definition"
    )
    write(rel, source)


def patch_admin():
    rel = "public/admin.js"
    source = read(rel)
    backup(rel, source)

    old_keys = '''  const keys = [
    "squareSiteUrl",
    "squarePublishedUserId",
    "squareSiteId",
    "squareLocationId"
  ];'''
    new_keys = '''  const keys = [
    "squareSiteUrl",
    "squarePublishedUserId",
    "squareSiteId",
    "squareBookingBusinessId",
    "squareLocationId"
  ];'''

    if '"squareBookingBusinessId"' not in source:
        if old_keys not in source:
            raise RuntimeError("Could not find Admin Square config key list")
        source = source.replace(old_keys, new_keys, 1)

    if "<span>Square Booking Business ID</span>" not in source:
        marker = '''          <label class="admin-field">
            <span>Square Location ID</span>'''
        field = '''          <label class="admin-field">
            <span>Square Booking Business ID</span>
            <input
              type="text"
              data-square-business-index="${index}"
              data-square-config-key="squareBookingBusinessId"
              value="${escapeHtml(getSquareIntegrationConfigValue(business, "squareBookingBusinessId"))}"
              placeholder="s4hhr5q8oh2ok8"
            />
          </label>

'''
        if marker not in source:
            raise RuntimeError("Could not find Admin Square Location ID field")
        source = source.replace(marker, field + marker, 1)

    write(rel, source)


if __name__ == "__main__":
    try:
        print("Applying NextAppt universal Square v5 integration...")
        patch_square_js()
        patch_platform_definitions()
        patch_admin()
        print("\nSquare v5 integration applied.")
        print("Run: node scripts/verify-square-universal-v5.js")
    except Exception as exc:
        print(f"\n[SQUARE V5 PATCH FAILED] {exc}")
        raise SystemExit(1)