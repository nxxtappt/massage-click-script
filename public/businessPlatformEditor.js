(function installBusinessPlatformEditor() {
  "use strict";

  const definitions = window.NEXTAPPT_PLATFORM_DEFINITIONS || {};

  if (!Object.keys(definitions).length) {
    console.error("[ADMIN PLATFORM EDITOR] Platform definitions were not loaded.");
    return;
  }

  const originalNormalizeBusinessDefaults = normalizeBusinessDefaults;
  const originalRenderBusinessCard = renderBusinessCard;
  const originalRenderServiceCard = renderServiceCard;
  const originalAttachBusinessInputListeners = attachBusinessInputListeners;
  const originalAttachServiceInputListeners = attachServiceInputListeners;
  const originalSaveSingleBusiness = saveSingleBusiness;

  const baseRenderedServiceFields = new Set([
    "serviceName",
    "serviceType",
    "durationMinutes",
    "platformServiceId",
    "serviceButtonId",
    "serviceId"
  ]);

  function cleanObject(value) {
    return value && typeof value === "object" && !Array.isArray(value)
      ? value
      : {};
  }

  function normalizePlatform(value) {
    return String(value || "")
      .trim()
      .toLowerCase()
      .replace(/_/g, "-")
      .replace(/\s+/g, "-");
  }

  function normalizeIntegrationType(value) {
    const normalized = normalizePlatform(value || "scrape");
    return normalized === "scraper" ? "scrape" : normalized || "scrape";
  }

  function valueIsPresent(value) {
    return value !== undefined && value !== null && value !== "";
  }

  function fieldCandidates(field = {}) {
    return [field.key, ...(Array.isArray(field.aliases) ? field.aliases : [])]
      .filter(Boolean);
  }

  function readField(field = {}, ...sources) {
    for (const source of sources) {
      const object = cleanObject(source);

      for (const key of fieldCandidates(field)) {
        if (valueIsPresent(object[key])) return object[key];
      }
    }

    return field.defaultValue;
  }

  function fieldIsRequired(field = {}, integrationType = "scrape") {
    if (field.required === true) return true;

    return (Array.isArray(field.requiredFor) ? field.requiredFor : [])
      .map(normalizeIntegrationType)
      .includes(normalizeIntegrationType(integrationType));
  }

  function getDefinition(platform) {
    return definitions[normalizePlatform(platform)] || null;
  }

  function getPrimaryIntegration(business = {}) {
    const integrations = Array.isArray(business.integrations)
      ? business.integrations
      : [];
    const platform = normalizePlatform(business.platform);

    return (
      integrations.find(
        (integration) =>
          integration.isDefault === true &&
          (!platform || normalizePlatform(integration.platform) === platform)
      ) ||
      integrations.find(
        (integration) =>
          !platform || normalizePlatform(integration.platform) === platform
      ) ||
      integrations.find((integration) => integration.isDefault === true) ||
      integrations[0] ||
      null
    );
  }

  function getServiceKey(service = {}, index = 0) {
    return String(
      service.businessServiceId ||
        service.serviceDatabaseId ||
        service.id ||
        service.canonicalKey ||
        service.platformServiceId ||
        service.serviceId ||
        service.serviceButtonId ||
        (service.serviceName && service.durationMinutes
          ? `${service.serviceName}|${service.durationMinutes}`
          : `service-${index}`)
    );
  }

  function findServiceConfig(serviceConfigs, service = {}, index = 0) {
    const map = cleanObject(serviceConfigs);
    const directKey = getServiceKey(service, index);

    if (map[directKey] && typeof map[directKey] === "object") {
      return cleanObject(map[directKey]);
    }

    const candidates = new Set([
      service.businessServiceId,
      service.id,
      service.canonicalKey,
      service.platformServiceId,
      service.serviceId,
      service.serviceButtonId,
      service.serviceName
    ].filter(valueIsPresent).map(String));

    return (
      Object.values(map).find((item) => {
        const config = cleanObject(item);
        const identities = [
          config.businessServiceId,
          config.id,
          config.canonicalKey,
          config.platformServiceId,
          config.serviceId,
          config.serviceButtonId,
          config.serviceName
        ].filter(valueIsPresent).map(String);

        return identities.some((identity) => candidates.has(identity));
      }) ||
      {}
    );
  }

  function hydrateBusinessPlatformData(business = {}) {
    const primary = getPrimaryIntegration(business);
    const config = {
      ...cleanObject(primary?.config),
      ...cleanObject(business.integrationConfig)
    };

    if (primary) {
      business.platform = primary.platform || business.platform || "";
      business.integrationType =
        normalizeIntegrationType(primary.integrationType) ||
        normalizeIntegrationType(business.integrationType);
      business.apiProvider = primary.apiProvider || business.apiProvider || "";
      business.credentialId = primary.credentialId || business.credentialId || "";
      business.bookingUrl = primary.bookingUrl || business.bookingUrl || "";
      business.integrationStatus = primary.status || business.integrationStatus || "active";
    }

    business.integrationConfig = config;

    if (Array.isArray(business.services)) {
      business.services = business.services.map((service, serviceIndex) => ({
        ...findServiceConfig(config.serviceConfigs, service, serviceIndex),
        ...service
      }));
    }

    return business;
  }

  function buildServiceConfigs(business = {}, definition = null) {
    const existing = cleanObject(business.integrationConfig?.serviceConfigs);
    const output = {};
    const platformDefinition = definition || getDefinition(business.platform);

    (Array.isArray(business.services) ? business.services : []).forEach(
      (service, serviceIndex) => {
        const key = getServiceKey(service, serviceIndex);
        const previous = findServiceConfig(existing, service, serviceIndex);
        const serviceConfig = {
          ...previous,
          businessServiceId:
            service.businessServiceId || service.id || previous.businessServiceId || null,
          canonicalKey: service.canonicalKey || previous.canonicalKey || "",
          serviceName: service.serviceName || previous.serviceName || "",
          durationMinutes:
            service.durationMinutes ?? previous.durationMinutes ?? null,
          platformServiceId:
            service.platformServiceId || previous.platformServiceId || "",
          serviceButtonId:
            service.serviceButtonId || previous.serviceButtonId || "",
          serviceId: service.serviceId || previous.serviceId || ""
        };

        for (const field of platformDefinition?.serviceFields || []) {
          if (field.storage !== "serviceConfig") continue;

          const value = readField(field, service, previous);
          if (valueIsPresent(value) || field.type === "checkbox") {
            serviceConfig[field.key] = field.type === "checkbox"
              ? value === true
              : value;
          }
        }

        output[key] = serviceConfig;
      }
    );

    return output;
  }

  function syncBusinessPlatformIntegration(business = {}) {
    const platform = normalizePlatform(business.platform);
    const definition = getDefinition(platform);
    const previousPrimary = getPrimaryIntegration(business) || {};
    const existingConfig = {
      ...cleanObject(previousPrimary.config),
      ...cleanObject(business.integrationConfig)
    };
    const config = { ...existingConfig };

    for (const field of definition?.integrationFields || []) {
      if (field.storage !== "config") continue;

      const value = readField(field, existingConfig, business, previousPrimary);
      if (valueIsPresent(value) || field.type === "checkbox") {
        config[field.key] = field.type === "checkbox"
          ? value === true
          : value;
      }
    }

    config.serviceConfigs = buildServiceConfigs(business, definition);

    const integrationType = normalizeIntegrationType(
      business.integrationType || previousPrimary.integrationType || "scrape"
    );
    const updatedPrimary = {
      ...previousPrimary,
      id: previousPrimary.id || previousPrimary.integrationId || null,
      integrationId:
        previousPrimary.integrationId || previousPrimary.id || null,
      name:
        previousPrimary.name ||
        `${definition?.label || platform || "Business"} ${integrationType}`,
      platform,
      integrationType,
      apiProvider: business.apiProvider || previousPrimary.apiProvider || "",
      credentialId:
        business.credentialId || previousPrimary.credentialId || "",
      bookingUrl: business.bookingUrl || previousPrimary.bookingUrl || "",
      status:
        business.integrationStatus || previousPrimary.status || "active",
      enabled: business.enabled !== false,
      priority: Number(previousPrimary.priority || 100),
      isDefault: true,
      config,
      capabilities:
        previousPrimary.capabilities || definition?.capabilities || [],
      rawJson: {
        ...cleanObject(previousPrimary.rawJson),
        platform,
        integrationType,
        bookingUrl: business.bookingUrl || previousPrimary.bookingUrl || "",
        config
      }
    };

    const otherIntegrations = (Array.isArray(business.integrations)
      ? business.integrations
      : []
    ).filter((integration) => integration !== previousPrimary);

    business.platform = platform;
    business.integrationType = integrationType;
    business.integrationConfig = config;
    business.primaryIntegration = updatedPrimary;
    business.integrations = [updatedPrimary, ...otherIntegrations];

    return business;
  }

  function validateBusinessConfiguration(business = {}) {
    const errors = [];
    const platform = normalizePlatform(business.platform);
    const definition = getDefinition(platform);
    const integrationType = normalizeIntegrationType(
      business.integrationType || "scrape"
    );
    const config = cleanObject(business.integrationConfig);

    if (!platform) {
      errors.push("Choose a CRM / scraper platform.");
      return errors;
    }

    if (!definition) {
      errors.push(`Unsupported CRM / scraper platform: ${platform}.`);
      return errors;
    }

    for (const field of definition.integrationFields || []) {
      if (!fieldIsRequired(field, integrationType)) continue;

      const value = field.storage === "config"
        ? readField(field, config, business)
        : readField(field, business, getPrimaryIntegration(business));

      if (!valueIsPresent(value)) {
        errors.push(`${definition.label}: ${field.label} is required.`);
      }
    }

    (Array.isArray(business.services) ? business.services : []).forEach(
      (service, serviceIndex) => {
        if (service.enabled === false) return;
        if (service.scrapeDirectly === false || service.inferenceRole === "inferred") {
          return;
        }

        for (const field of definition.serviceFields || []) {
          if (!fieldIsRequired(field, integrationType)) continue;

          const value = readField(field, service);
          if (!valueIsPresent(value)) {
            errors.push(
              `${service.serviceName || `Service ${serviceIndex + 1}`}: ${field.label} is required for ${definition.label}.`
            );
          }
        }
      }
    );

    return [...new Set(errors)];
  }

  function renderFieldHelp(field = {}) {
    if (!field.help) return "";
    return `<small class="platform-field-help">${escapeHtml(field.help)}</small>`;
  }

  function renderIntegrationField(field, business, businessIndex) {
    const config = cleanObject(business.integrationConfig);
    const value = readField(field, config, business, getPrimaryIntegration(business));
    const required = fieldIsRequired(
      field,
      business.integrationType || "scrape"
    );

    if (field.type === "checkbox") {
      return `
        <label class="admin-checkbox platform-config-checkbox">
          <input
            type="checkbox"
            data-platform-business-index="${businessIndex}"
            data-integration-config-field="${escapeHtml(field.key)}"
            ${value === true ? "checked" : ""}
          />
          <span>${escapeHtml(field.label)}${required ? " *" : ""}</span>
          ${renderFieldHelp(field)}
        </label>
      `;
    }

    return `
      <label class="admin-field platform-config-field">
        <span>${escapeHtml(field.label)}${required ? " *" : ""}</span>
        <input
          type="${escapeHtml(field.type || "text")}"
          data-platform-business-index="${businessIndex}"
          data-integration-config-field="${escapeHtml(field.key)}"
          value="${escapeHtml(value ?? "")}"
          ${required ? "required" : ""}
        />
        ${renderFieldHelp(field)}
      </label>
    `;
  }

  function renderPlatformSelect(business, businessIndex) {
    const selected = normalizePlatform(business.platform);

    return `
      <label class="admin-field">
        <span>CRM / Scraper Platform *</span>
        <select data-platform-select data-platform-business-index="${businessIndex}">
          <option value="">Choose platform</option>
          ${Object.values(definitions)
            .map(
              (definition) => `
                <option value="${escapeHtml(definition.key)}" ${
                  definition.key === selected ? "selected" : ""
                }>${escapeHtml(definition.label)}</option>
              `
            )
            .join("")}
        </select>
      </label>
    `;
  }

  function renderIntegrationTypeSelect(business, businessIndex) {
    const definition = getDefinition(business.platform);
    const options = definition?.integrationTypes || ["scrape"];
    const selected = normalizeIntegrationType(business.integrationType || "scrape");

    return `
      <label class="admin-field">
        <span>Integration Type *</span>
        <select data-integration-type-select data-platform-business-index="${businessIndex}">
          ${options
            .map(
              (type) => `
                <option value="${escapeHtml(type)}" ${type === selected ? "selected" : ""}>
                  ${escapeHtml(type === "api" ? "API" : "Scraper")}
                </option>
              `
            )
            .join("")}
        </select>
      </label>
    `;
  }

  function renderIntegrationSection(business, businessIndex) {
    const definition = getDefinition(business.platform);
    const fields = (definition?.integrationFields || []).filter(
      (field) => field.storage === "config"
    );

    return `
      <details class="platform-configuration-section" open>
        <summary class="platform-configuration-summary">
          <span>${escapeHtml(definition?.label || "CRM")} Configuration</span>
          <small>Stored in PostgreSQL business_integrations.config</small>
        </summary>
        <div class="platform-configuration-inner">
          <p class="platform-configuration-description">
            ${escapeHtml(
              definition?.description ||
                "Choose a CRM platform to display its required configuration fields."
            )}
          </p>
          <div class="business-edit-grid platform-config-grid">
            ${
              fields.length
                ? fields
                    .map((field) =>
                      renderIntegrationField(field, business, businessIndex)
                    )
                    .join("")
                : `<p class="empty-note admin-field-full">No additional integration fields are required for this platform.</p>`
            }
          </div>
        </div>
      </details>
    `;
  }

  function renderPlatformServiceFields(service, businessIndex, serviceIndex) {
    const business = businessesCache[businessIndex] || {};
    const definition = getDefinition(business.platform);
    const integrationType = normalizeIntegrationType(
      business.integrationType || "scrape"
    );

    return (definition?.serviceFields || [])
      .filter((field) => !baseRenderedServiceFields.has(field.key))
      .map((field) => {
        const value = readField(field, service);
        const required = fieldIsRequired(field, integrationType);

        if (field.type === "checkbox") {
          return `
            <div class="admin-field checkbox-wrap platform-service-field">
              <span>${escapeHtml(field.label)}${required ? " *" : ""}</span>
              ${renderServiceCheckbox(
                field.label,
                field.key,
                value === true,
                businessIndex,
                serviceIndex
              )}
              ${renderFieldHelp(field)}
            </div>
          `;
        }

        return `
          <label class="admin-field platform-service-field">
            <span>${escapeHtml(field.label)}${required ? " *" : ""}</span>
            <input
              type="${escapeHtml(field.type || "text")}"
              data-business-index="${businessIndex}"
              data-service-index="${serviceIndex}"
              data-service-field="${escapeHtml(field.key)}"
              value="${escapeHtml(value ?? "")}"
              ${required ? "required" : ""}
            />
            ${renderFieldHelp(field)}
          </label>
        `;
      })
      .join("");
  }

  function insertBeforeSecondLastClosingDiv(html, insertion) {
    const last = html.lastIndexOf("</div>");
    if (last < 0) return html + insertion;
    const secondLast = html.lastIndexOf("</div>", last - 1);
    if (secondLast < 0) return html.slice(0, last) + insertion + html.slice(last);
    return html.slice(0, secondLast) + insertion + html.slice(secondLast);
  }

  normalizeBusinessDefaults = function enhancedNormalizeBusinessDefaults(business) {
    return hydrateBusinessPlatformData(
      originalNormalizeBusinessDefaults(business || {})
    );
  };

  renderServiceCard = function enhancedRenderServiceCard(
    service,
    businessIndex,
    serviceIndex
  ) {
    const html = originalRenderServiceCard(
      service,
      businessIndex,
      serviceIndex
    );
    const extraFields = renderPlatformServiceFields(
      service,
      businessIndex,
      serviceIndex
    );

    return extraFields
      ? insertBeforeSecondLastClosingDiv(html, extraFields)
      : html;
  };

  renderBusinessCard = function enhancedRenderBusinessCard(business, index) {
    syncBusinessPlatformIntegration(business);

    let html = originalRenderBusinessCard(business, index);
    const originalPlatformInput = renderInput(
      "Platform",
      "platform",
      business.platform,
      index
    );
    const originalIntegrationTypeInput = renderInput(
      "Integration Type",
      "integrationType",
      business.integrationType || "scraper",
      index
    );

    html = html.replace(originalPlatformInput, renderPlatformSelect(business, index));
    html = html.replace(
      originalIntegrationTypeInput,
      renderIntegrationTypeSelect(business, index)
    );
    html = html.replace(
      '<details class="services-section">',
      `${renderIntegrationSection(business, index)}\n<details class="services-section">`
    );

    return html;
  };

  attachBusinessInputListeners = function enhancedAttachBusinessInputListeners() {
    originalAttachBusinessInputListeners();

    content.querySelectorAll("[data-platform-select]").forEach((select) => {
      select.addEventListener("change", () => {
        const index = Number(select.dataset.platformBusinessIndex);
        const business = businessesCache[index];
        if (!business) return;

        business.platform = normalizePlatform(select.value);
        const definition = getDefinition(business.platform);
        business.integrationType = definition?.integrationTypes?.includes(
          normalizeIntegrationType(business.integrationType)
        )
          ? normalizeIntegrationType(business.integrationType)
          : definition?.integrationTypes?.[0] || "scrape";

        syncBusinessPlatformIntegration(business);
        setStatus("CRM platform changed. Complete the required fields, then save.", "info");
        renderBusinessesFromCache();
      });
    });

    content
      .querySelectorAll("[data-integration-type-select]")
      .forEach((select) => {
        select.addEventListener("change", () => {
          const index = Number(select.dataset.platformBusinessIndex);
          const business = businessesCache[index];
          if (!business) return;

          business.integrationType = normalizeIntegrationType(select.value);
          syncBusinessPlatformIntegration(business);
          setStatus("Integration type changed. Review required fields.", "info");
          renderBusinessesFromCache();
        });
      });

    content
      .querySelectorAll("[data-integration-config-field]")
      .forEach((fieldElement) => {
        const update = () => {
          const index = Number(fieldElement.dataset.platformBusinessIndex);
          const field = fieldElement.dataset.integrationConfigField;
          const business = businessesCache[index];
          if (!business) return;

          business.integrationConfig = cleanObject(business.integrationConfig);
          let value = fieldElement.type === "checkbox"
            ? fieldElement.checked
            : fieldElement.value;

          if (fieldElement.type === "number") {
            value = value === "" ? null : Number(value);
          }

          business.integrationConfig[field] = value;
          syncBusinessPlatformIntegration(business);
          setStatus("Unsaved CRM configuration changes.", "info");
        };

        fieldElement.addEventListener("input", update);
        fieldElement.addEventListener("change", update);
      });
  };

  attachServiceInputListeners = function enhancedAttachServiceInputListeners() {
    originalAttachServiceInputListeners();

    content
      .querySelectorAll("[data-business-index][data-service-index][data-service-field]")
      .forEach((fieldElement) => {
        const updatePlatformConfig = () => {
          const businessIndex = Number(fieldElement.dataset.businessIndex);
          const serviceIndex = Number(fieldElement.dataset.serviceIndex);
          const field = fieldElement.dataset.serviceField;
          const business = businessesCache[businessIndex];
          const service = business?.services?.[serviceIndex];
          if (!service) return;

          const definition = getDefinition(business.platform);
          const fieldDefinition = (definition?.serviceFields || []).find(
            (item) => item.key === field
          );

          if (fieldDefinition?.type === "number") {
            service[field] = fieldElement.value === ""
              ? null
              : Number(fieldElement.value);
          }

          syncBusinessPlatformIntegration(business);
        };

        fieldElement.addEventListener("input", updatePlatformConfig);
        fieldElement.addEventListener("change", updatePlatformConfig);
      });
  };

  saveSingleBusiness = async function enhancedSaveSingleBusiness(
    index,
    button = null
  ) {
    const business = businessesCache[index];
    if (!business) return;

    syncBusinessPlatformIntegration(business);
    const errors = validateBusinessConfiguration(business);

    if (errors.length) {
      setStatus(`Save blocked: ${errors.join(" ")}`, "error");
      return;
    }

    return originalSaveSingleBusiness(index, button);
  };

  window.NextApptBusinessPlatformEditor = {
    definitions,
    syncBusinessPlatformIntegration,
    validateBusinessConfiguration,
    hydrateBusinessPlatformData
  };

  if (
    typeof businessEditorMode !== "undefined" &&
    businessEditorMode === true &&
    Array.isArray(businessesCache) &&
    businessesCache.length
  ) {
    businessesCache = businessesCache.map(normalizeBusinessDefaults);
    renderBusinessesFromCache();
  }
})();