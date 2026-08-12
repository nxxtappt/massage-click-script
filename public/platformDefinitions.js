(function exposeNextApptPlatformDefinitions(root, factory) {
  const definitions = factory();

  if (typeof module !== "undefined" && module.exports) {
    module.exports = definitions;
  }

  if (root) {
    root.NEXTAPPT_PLATFORM_DEFINITIONS = definitions;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function buildDefinitions() {
  "use strict";

  const text = (key, label, options = {}) => ({
    key,
    label,
    type: "text",
    ...options
  });

  const boolean = (key, label, options = {}) => ({
    key,
    label,
    type: "checkbox",
    ...options
  });

  const number = (key, label, options = {}) => ({
    key,
    label,
    type: "number",
    ...options
  });

  const url = (key, label, options = {}) => ({
    key,
    label,
    type: "url",
    ...options
  });

  const commonServiceFields = [
    text("serviceName", "Service Name", {
      required: true,
      storage: "service",
      help: "The public service name used by the scraper and appointment inventory."
    }),
    text("serviceType", "Service Type", {
      required: true,
      storage: "service",
      help: "Canonical type such as massage, prenatal, sports, or facial."
    }),
    number("durationMinutes", "Duration Minutes", {
      required: true,
      storage: "service"
    })
  ];

  const serviceIdField = (options = {}) =>
    text("serviceId", "Service ID", {
      required: true,
      storage: "service",
      aliases: ["platformServiceId", "serviceButtonId", "itemId"],
      help: "The CRM service, item, or appointment-type identifier.",
      ...options
    });

  const bookingUrl = url("bookingUrl", "Booking URL", {
    requiredFor: ["scrape"],
    storage: "integration",
    topLevel: true
  });

  const definitions = {
    mindbody: {
      key: "mindbody",
      label: "Mindbody",
      description: "Modern Mindbody booking widget or Mindbody API integration.",
      capabilities: ["scrape", "api", "service_discovery", "provider_selection"],
      integrationTypes: ["scrape", "api"],
      integrationFields: [
        bookingUrl,
        text("credentialId", "Credential ID", {
          requiredFor: ["api"],
          storage: "integration",
          topLevel: true
        }),
        text("apiProvider", "API Provider", {
          requiredFor: ["api"],
          storage: "integration",
          topLevel: true,
          defaultValue: "mindbody"
        }),
        text("siteId", "Site ID", {
          storage: "config",
          help: "Required by some Mindbody API credentials and legacy booking links."
        }),
        text("locationId", "Location ID", { storage: "config" })
      ],
      serviceFields: [
        ...commonServiceFields,
        text("categoryText", "Category Text", {
          requiredFor: ["scrape"],
          storage: "serviceConfig",
          aliases: ["categoryName"],
          defaultValue: "Massage"
        }),
        text("serviceButtonId", "Service Button ID", {
          requiredFor: ["scrape"],
          storage: "service",
          aliases: ["platformServiceId", "serviceId"]
        }),
        text("sessionTypeId", "Session Type ID", {
          requiredFor: ["api"],
          storage: "serviceConfig",
          aliases: ["serviceId", "platformServiceId"]
        }),
        text("providerText", "Provider Text", {
          storage: "serviceConfig",
          defaultValue: "First Available"
        }),
        boolean("skipProvider", "Skip Provider Selection", {
          storage: "serviceConfig"
        })
      ]
    },

    "mindbody-old": {
      key: "mindbody-old",
      label: "Mindbody Legacy",
      description: "Legacy HealCode or older Mindbody appointment widget.",
      capabilities: ["scrape", "provider_selection"],
      integrationTypes: ["scrape"],
      integrationFields: [bookingUrl],
      serviceFields: [
        ...commonServiceFields,
        text("sessionTypeId", "Session Type ID", {
          storage: "serviceConfig",
          aliases: ["serviceId", "platformServiceId"]
        }),
        text("providerText", "Provider Text", {
          storage: "serviceConfig",
          defaultValue: "First Available"
        })
      ]
    },

    schedulista: {
      key: "schedulista",
      label: "Schedulista",
      description: "Schedulista schedule pages and embedded booking widgets.",
      capabilities: ["scrape", "service_discovery"],
      integrationTypes: ["scrape"],
      integrationFields: [
        bookingUrl,
        url("schedulistaScheduleUrl", "Schedulista Schedule URL", {
          storage: "config",
          aliases: ["scheduleUrl"],
          help: "Optional direct schedulista.com/schedule URL when it cannot be discovered from the website."
        }),
        boolean("allowLooseServiceMatch", "Allow Loose Service Name Match", {
          storage: "config"
        })
      ],
      serviceFields: [
        ...commonServiceFields,
        text("platformServiceId", "Service ID", {
          storage: "service",
          aliases: ["serviceId"]
        })
      ]
    },

    meevo: {
      key: "meevo",
      label: "Meevo",
      description: "Meevo online booking API discovered through the business booking page.",
      capabilities: ["scrape", "service_discovery", "provider_selection"],
      integrationTypes: ["scrape"],
      integrationFields: [bookingUrl],
      serviceFields: [
        ...commonServiceFields,
        text("categoryName", "Meevo Category Name", {
          required: true,
          storage: "serviceConfig",
          aliases: ["categoryText"],
          help: "Must match or be contained in the Meevo service category display name."
        }),
        text("providerText", "Provider Text", {
          storage: "serviceConfig",
          defaultValue: "First Available"
        })
      ]
    },

    vagaro: {
      key: "vagaro",
      label: "Vagaro",
      description: "Vagaro marketplace and business booking discovery.",
      capabilities: ["scrape", "marketplace_discovery", "service_discovery"],
      integrationTypes: ["scrape"],
      integrationFields: [
        bookingUrl,
        text("marketplaceBusinessId", "Marketplace Business ID", {
          storage: "config"
        }),
        text("city", "Marketplace City", {
          storage: "config",
          defaultValue: "austin"
        }),
        text("state", "Marketplace State", {
          storage: "config",
          defaultValue: "tx"
        }),
        number("maxResults", "Maximum Marketplace Results", {
          storage: "config",
          defaultValue: 20
        })
      ],
      serviceFields: [
        ...commonServiceFields,
        text("platformServiceId", "Vagaro Service ID", {
          storage: "service",
          aliases: ["serviceId"]
        }),
        text("providerText", "Provider Text", { storage: "serviceConfig" })
      ]
    },

    axl3: {
      key: "axl3",
      label: "Acuity / AXL3",
      description: "Acuity/AXL3 appointment booking flow.",
      capabilities: ["scrape", "service_discovery"],
      integrationTypes: ["scrape"],
      integrationFields: [bookingUrl],
      serviceFields: [
        ...commonServiceFields,
        text("platformServiceId", "Appointment Type ID", {
          storage: "service",
          aliases: ["serviceId", "serviceButtonId"]
        }),
        text("categoryText", "Category Text", { storage: "serviceConfig" })
      ]
    },

    booker: {
      key: "booker",
      label: "Booker",
      description: "Booker appointment booking flow.",
      capabilities: ["scrape", "service_discovery", "provider_selection"],
      integrationTypes: ["scrape"],
      integrationFields: [bookingUrl],
      serviceFields: [
        ...commonServiceFields,
        text("platformServiceId", "Booker Service ID", {
          storage: "service",
          aliases: ["serviceId", "serviceButtonId"]
        }),
        text("categoryText", "Category Text", { storage: "serviceConfig" }),
        text("parentServiceText", "Parent Service Text", { storage: "serviceConfig" }),
        text("providerText", "Provider Text", {
          storage: "serviceConfig",
          defaultValue: "First Available"
        })
      ]
    },

    zenoti: {
      key: "zenoti",
      label: "Zenoti",
      description: "Zenoti web booking flow and captured availability API.",
      capabilities: ["scrape", "service_discovery", "provider_selection"],
      integrationTypes: ["scrape"],
      integrationFields: [
        bookingUrl,
        text("centerId", "Center ID", { storage: "config" })
      ],
      serviceFields: [
        ...commonServiceFields,
        text("platformServiceId", "Zenoti Service ID", {
          storage: "service",
          aliases: ["serviceId"]
        }),
        text("categoryText", "Category Text", { storage: "serviceConfig" }),
        text("parentServiceText", "Parent Service Text", { storage: "serviceConfig" }),
        text("providerText", "Provider Text", {
          storage: "serviceConfig",
          defaultValue: "First Available"
        })
      ]
    },

    oakhaven: {
      key: "oakhaven",
      label: "Oak Haven Custom",
      description: "Oak Haven custom availability endpoint.",
      capabilities: ["scrape"],
      integrationTypes: ["scrape"],
      integrationFields: [
        bookingUrl,
        text("tier", "Tier", { storage: "config", defaultValue: "1" }),
        text("placeId", "Place ID", { storage: "config", defaultValue: "1" }),
        text("siteid", "Site ID", { storage: "config", defaultValue: "1" }),
        text("LocationIds", "Location IDs", { storage: "config", defaultValue: "4" })
      ],
      serviceFields: [
        ...commonServiceFields,
        text("category", "Category", {
          required: true,
          storage: "serviceConfig",
          defaultValue: "Cutomize My Session"
        }),
        text("SessionTypeIds", "Session Type IDs", {
          required: true,
          storage: "serviceConfig",
          aliases: ["sessionTypeId", "serviceId"],
          defaultValue: "5"
        }),
        text("PressureTypeIds", "Pressure Type IDs", {
          storage: "serviceConfig",
          defaultValue: "227"
        })
      ]
    },

    "massage-envy": {
      key: "massage-envy",
      label: "Massage Envy Custom",
      description: "Massage Envy availability endpoint.",
      capabilities: ["scrape", "provider_selection"],
      integrationTypes: ["scrape"],
      integrationFields: [
        bookingUrl,
        text("clinicId", "Clinic ID", {
          required: true,
          storage: "config",
          aliases: ["locationId"]
        })
      ],
      serviceFields: [
        ...commonServiceFields,
        serviceIdField({ label: "Massage Envy Service ID" }),
        text("providerText", "Provider Text", {
          storage: "serviceConfig",
          defaultValue: "First Available"
        })
      ]
    },

    square: {
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
    },

    mangomint: {
      key: "mangomint",
      label: "Mangomint",
      description: "Mangomint booking availability API.",
      capabilities: ["scrape", "service_discovery", "provider_selection"],
      integrationTypes: ["scrape"],
      integrationFields: [
        bookingUrl,
        text("companyId", "Company ID", {
          required: true,
          storage: "config",
          aliases: ["mangomintCompanyId"]
        }),
        text("locationId", "Location ID", {
          required: true,
          storage: "config",
          aliases: ["mangomintLocationId"]
        }),
        text("appInstanceId", "App Instance ID", {
          storage: "config",
          aliases: ["mangomintAppInstanceId"]
        }),
        text("appVersion", "App Version", {
          storage: "config",
          aliases: ["mangomintAppVersion"]
        })
      ],
      serviceFields: [
        ...commonServiceFields,
        serviceIdField({ label: "Mangomint Service ID" }),
        text("staffCategory", "Staff Category", {
          storage: "serviceConfig",
          defaultValue: "Any"
        }),
        text("staffId", "Staff ID", { storage: "serviceConfig" }),
        text("additionalStaffId", "Additional Staff ID", { storage: "serviceConfig" })
      ]
    },

    "hand-stone": {
      key: "hand-stone",
      label: "Hand & Stone Custom",
      description: "Hand & Stone availability API.",
      capabilities: ["scrape", "provider_selection"],
      integrationTypes: ["scrape"],
      integrationFields: [
        bookingUrl,
        text("centerId", "Center ID", {
          required: true,
          storage: "config",
          aliases: ["center_id", "locationId"]
        }),
        number("therapistGender", "Therapist Gender Code", {
          storage: "config",
          defaultValue: 0
        })
      ],
      serviceFields: [
        ...commonServiceFields,
        serviceIdField({ label: "Hand & Stone Item ID" })
      ]
    }
  };

  return Object.freeze(definitions);
});