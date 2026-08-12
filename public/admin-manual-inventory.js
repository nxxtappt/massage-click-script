(() => {
  const MANUAL_TOOLBAR_ID = "manualInventoryToolbar";
  const ADD_DIALOG_ID = "manualInventoryAddDialog";
  const MANAGE_DIALOG_ID = "manualInventoryManageDialog";
  const DISPLAY_TIME_ZONE = "America/Chicago";

  let dateGroupSequence = 1;
  let businessSearchTimer = null;

  const addState = {
    business: null,
    serviceIds: new Set(),
    dateGroups: [],
    protectFromScrape: false
  };

  const manageState = {
    rows: [],
    total: 0
  };

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  async function api(url, options = {}) {
    const response = await fetch(url, options);
    let data = null;

    try {
      data = await response.json();
    } catch {
      data = null;
    }

    if (!response.ok || data?.success === false) {
      throw new Error(data?.error || `${response.status} ${response.statusText}`);
    }

    return data || {};
  }

  function showAdminStatus(message, type = "info") {
    const statusBox = document.getElementById("statusBox");
    if (!statusBox) return;

    statusBox.textContent = message;
    statusBox.className = `status-box ${type}`;
  }

  function getCurrentMetro() {
    return document.getElementById("adminMetroFilter")?.value || "";
  }

  function getTodayDateKey(timeZone = addState.business?.timezone || DISPLAY_TIME_ZONE) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).formatToParts(new Date());

    const map = {};
    parts.forEach((part) => {
      if (part.type !== "literal") map[part.type] = part.value;
    });

    return `${map.year}-${map.month}-${map.day}`;
  }

  function addDays(dateKey, days) {
    const [year, month, day] = String(dateKey).split("-").map(Number);
    const date = new Date(Date.UTC(year, month - 1, day + Number(days || 0), 12));

    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(
      date.getUTCDate()
    ).padStart(2, "0")}`;
  }

  function normalizeTimeToken(value) {
    const raw = String(value || "")
      .trim()
      .toLowerCase()
      .replace(/\./g, "")
      .replace(/\s+/g, " ");

    if (!raw) return "";

    const twentyFourHour = raw.match(/^(\d{1,2}):(\d{2})$/);
    if (twentyFourHour) {
      const hour = Number(twentyFourHour[1]);
      const minute = Number(twentyFourHour[2]);

      if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
        return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
      }
    }

    const twelveHour = raw.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/);
    if (!twelveHour) return "";

    let hour = Number(twelveHour[1]);
    const minute = Number(twelveHour[2] || 0);
    const suffix = twelveHour[3];

    if (hour < 1 || hour > 12 || minute < 0 || minute > 59) return "";

    if (suffix === "pm" && hour !== 12) hour += 12;
    if (suffix === "am" && hour === 12) hour = 0;

    return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  }

  function formatTime(timeKey) {
    const match = String(timeKey || "").match(/^(\d{2}):(\d{2})$/);
    if (!match) return timeKey || "";

    const hour24 = Number(match[1]);
    const minute = Number(match[2]);
    const suffix = hour24 >= 12 ? "PM" : "AM";
    const hour = hour24 % 12 || 12;

    return `${hour}:${String(minute).padStart(2, "0")} ${suffix}`;
  }

  function uniqueSortedTimes(times = []) {
    return [...new Set(times.map(normalizeTimeToken).filter(Boolean))].sort();
  }

  function createDateGroup(date = getTodayDateKey(), times = []) {
    return {
      id: dateGroupSequence++,
      date,
      times: uniqueSortedTimes(times)
    };
  }

  function resetAddState() {
    addState.business = null;
    addState.serviceIds = new Set();
    addState.dateGroups = [createDateGroup(getTodayDateKey(), [])];
    addState.protectFromScrape = false;
  }

  function getSelectedServices() {
    const services = Array.isArray(addState.business?.services)
      ? addState.business.services
      : [];

    return services.filter((service) =>
      addState.serviceIds.has(String(service.businessServiceId || service.id || ""))
    );
  }

  function getFlatSlots() {
    const slots = [];
    const seen = new Set();

    for (const group of addState.dateGroups) {
      for (const time of uniqueSortedTimes(group.times)) {
        if (!group.date || !time) continue;

        const key = `${group.date}|${time}`;
        if (seen.has(key)) continue;

        seen.add(key);
        slots.push({ date: group.date, time });
      }
    }

    return slots.sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`));
  }

  function ensureDialogs() {
    if (!document.getElementById(ADD_DIALOG_ID)) {
      const addDialog = document.createElement("dialog");
      addDialog.id = ADD_DIALOG_ID;
      addDialog.className = "manual-inventory-dialog manual-inventory-add-dialog";
      document.body.appendChild(addDialog);
    }

    if (!document.getElementById(MANAGE_DIALOG_ID)) {
      const manageDialog = document.createElement("dialog");
      manageDialog.id = MANAGE_DIALOG_ID;
      manageDialog.className = "manual-inventory-dialog manual-inventory-manage-dialog";
      document.body.appendChild(manageDialog);
    }
  }

  function closeDialog(id) {
    const dialog = document.getElementById(id);
    if (dialog?.open) dialog.close();
  }

  function renderAddDialog() {
    ensureDialogs();
    const dialog = document.getElementById(ADD_DIALOG_ID);
    if (!dialog) return;

    dialog.innerHTML = `
      <div class="manual-inventory-dialog-header">
        <div>
          <h3>Add Appointment Inventory</h3>
          <p>Choose one business, select multiple configured services, then add as many dates and times as needed.</p>
        </div>
        <button class="manual-inventory-icon-btn" type="button" data-manual-close="${ADD_DIALOG_ID}" aria-label="Close">×</button>
      </div>

      <div class="manual-inventory-section">
        <div class="manual-inventory-section-heading">
          <div>
            <strong>1. Business</strong>
            <small>Search the PostgreSQL business database.</small>
          </div>
        </div>

        <label class="manual-inventory-field">
          <span>Search business</span>
          <input id="manualInventoryBusinessSearch" type="search" autocomplete="off" placeholder="Start typing a business name..." />
        </label>

        <div id="manualInventoryBusinessResults" class="manual-inventory-business-results"></div>
        <div id="manualInventorySelectedBusiness"></div>
      </div>

      <div class="manual-inventory-section">
        <div class="manual-inventory-section-heading">
          <div>
            <strong>2. Services</strong>
            <small>Select any number of enabled services configured for this business.</small>
          </div>
          <div class="manual-inventory-inline-actions">
            <button id="manualInventorySelectAllServices" class="secondary-btn" type="button">Select All</button>
            <button id="manualInventoryClearServices" class="secondary-btn" type="button">Clear</button>
          </div>
        </div>
        <div id="manualInventoryServices" class="manual-inventory-services">
          <p class="manual-inventory-empty">Select a business first.</p>
        </div>
      </div>

      <div class="manual-inventory-section">
        <div class="manual-inventory-section-heading">
          <div>
            <strong>3. Dates & Times</strong>
            <small>Add times individually or paste a list such as 3:00 PM, 3:30 PM, 4:00 PM.</small>
          </div>
        </div>

        <div id="manualInventoryDateGroups"></div>

        <button id="manualInventoryAddDate" class="secondary-btn" type="button">+ Add Another Date</button>
      </div>

      <div class="manual-inventory-section manual-inventory-protection-box">
        <label class="manual-inventory-protection-option">
          <input id="manualInventoryProtectFromScrape" type="checkbox" ${addState.protectFromScrape ? "checked" : ""} />
          <span>
            <strong>Protect these appointments from automatic scraping</strong>
            <small>Off by default. When off, the next successful scrape for the same service/date can replace these manual entries.</small>
          </span>
        </label>
      </div>

      <div class="manual-inventory-summary" id="manualInventoryBatchSummary"></div>

      <div class="manual-inventory-dialog-actions">
        <button class="secondary-btn" type="button" data-manual-close="${ADD_DIALOG_ID}">Cancel</button>
        <button id="manualInventorySubmit" class="primary-btn" type="button">Add Inventory</button>
      </div>
    `;

    attachDialogCloseButtons(dialog);
    attachAddDialogHandlers();
    renderSelectedBusiness();
    renderServices();
    renderDateGroups();
    renderBatchSummary();
  }

  function attachDialogCloseButtons(root) {
    root.querySelectorAll("[data-manual-close]").forEach((button) => {
      button.addEventListener("click", () => closeDialog(button.dataset.manualClose));
    });
  }

  function attachAddDialogHandlers() {
    const businessInput = document.getElementById("manualInventoryBusinessSearch");

    businessInput?.addEventListener("input", () => {
      clearTimeout(businessSearchTimer);
      businessSearchTimer = setTimeout(() => {
        searchBusinesses(businessInput.value).catch((error) => {
          renderBusinessSearchError(error.message);
        });
      }, 250);
    });

    document.getElementById("manualInventorySelectAllServices")?.addEventListener("click", () => {
      const services = Array.isArray(addState.business?.services)
        ? addState.business.services
        : [];

      services.forEach((service) => {
        const id = String(service.businessServiceId || service.id || "");
        if (id && service.enabled !== false) addState.serviceIds.add(id);
      });

      renderServices();
      renderBatchSummary();
    });

    document.getElementById("manualInventoryClearServices")?.addEventListener("click", () => {
      addState.serviceIds.clear();
      renderServices();
      renderBatchSummary();
    });

    document.getElementById("manualInventoryAddDate")?.addEventListener("click", () => {
      const lastDate = addState.dateGroups.at(-1)?.date || getTodayDateKey();
      addState.dateGroups.push(createDateGroup(addDays(lastDate, 1), []));
      renderDateGroups();
      renderBatchSummary();
    });

    document.getElementById("manualInventoryProtectFromScrape")?.addEventListener("change", (event) => {
      addState.protectFromScrape = event.target.checked === true;
      renderBatchSummary();
    });

    document.getElementById("manualInventorySubmit")?.addEventListener("click", submitManualInventory);
  }

  async function searchBusinesses(query) {
    const target = document.getElementById("manualInventoryBusinessResults");
    if (!target) return;

    const search = String(query || "").trim();

    if (search.length < 2) {
      target.innerHTML = search
        ? `<p class="manual-inventory-empty">Type at least 2 characters.</p>`
        : "";
      return;
    }

    target.innerHTML = `<p class="manual-inventory-empty">Searching...</p>`;

    const params = new URLSearchParams({
      name: search,
      enabled: "true",
      page: "1",
      limit: "10"
    });

    const metro = getCurrentMetro();
    if (metro) params.set("metro", metro);

    const data = await api(`/api/admin/businesses/search?${params.toString()}`);
    const businesses = Array.isArray(data.businesses) ? data.businesses : [];

    target.innerHTML = businesses.length
      ? businesses
          .map((business) => {
            const id = business.businessId || business.id || "";
            return `
              <button class="manual-inventory-business-result" type="button" data-business-id="${escapeHtml(id)}">
                <strong>${escapeHtml(business.businessName || business.name || "Unknown business")}</strong>
                <span>${escapeHtml(business.address || business.metro || business.city || "")}</span>
              </button>
            `;
          })
          .join("")
      : `<p class="manual-inventory-empty">No matching businesses found.</p>`;

    target.querySelectorAll("[data-business-id]").forEach((button) => {
      button.addEventListener("click", () => {
        selectBusiness(button.dataset.businessId).catch((error) => {
          showAdminStatus(`Could not load business: ${error.message}`, "error");
        });
      });
    });
  }

  function renderBusinessSearchError(message) {
    const target = document.getElementById("manualInventoryBusinessResults");
    if (target) target.innerHTML = `<p class="manual-inventory-error">${escapeHtml(message)}</p>`;
  }

  async function selectBusiness(businessId) {
    const previousDefaultDate = getTodayDateKey();
    const data = await api(`/api/admin/businesses/${encodeURIComponent(businessId)}`);
    addState.business = data.business || null;
    addState.serviceIds.clear();

    if (
      addState.dateGroups.length === 1 &&
      addState.dateGroups[0].times.length === 0 &&
      addState.dateGroups[0].date === previousDefaultDate
    ) {
      addState.dateGroups[0].date = getTodayDateKey();
    }

    document.getElementById("manualInventoryBusinessResults").innerHTML = "";
    renderSelectedBusiness();
    renderServices();
    renderBatchSummary();
  }

  function renderSelectedBusiness() {
    const target = document.getElementById("manualInventorySelectedBusiness");
    if (!target) return;

    if (!addState.business) {
      target.innerHTML = "";
      return;
    }

    const business = addState.business;
    const services = Array.isArray(business.services) ? business.services : [];

    target.innerHTML = `
      <div class="manual-inventory-selected-business">
        <div>
          <strong>${escapeHtml(business.businessName || business.name || "")}</strong>
          <span>${escapeHtml(business.address || "")}</span>
        </div>
        <div>
          <span class="manual-inventory-mini-pill">${escapeHtml(business.platform || "manual")}</span>
          <span class="manual-inventory-mini-pill">${services.length} services</span>
        </div>
      </div>
    `;
  }

  function renderServices() {
    const target = document.getElementById("manualInventoryServices");
    if (!target) return;

    const services = Array.isArray(addState.business?.services)
      ? addState.business.services
      : [];

    if (!addState.business) {
      target.innerHTML = `<p class="manual-inventory-empty">Select a business first.</p>`;
      return;
    }

    if (!services.length) {
      target.innerHTML = `<p class="manual-inventory-empty">This business has no configured services.</p>`;
      return;
    }

    target.innerHTML = services
      .map((service) => {
        const id = String(service.businessServiceId || service.id || "");
        const enabled = service.enabled !== false && Boolean(id);
        const checked = addState.serviceIds.has(id);
        const duration = service.durationMinutes ? `${service.durationMinutes} min` : "Duration not set";
        const type = service.serviceType || service.serviceCategory || "";

        return `
          <label class="manual-inventory-service-option ${enabled ? "" : "is-disabled"}">
            <input
              type="checkbox"
              data-manual-service-id="${escapeHtml(id)}"
              ${checked ? "checked" : ""}
              ${enabled ? "" : "disabled"}
            />
            <span>
              <strong>${escapeHtml(service.serviceName || "Unnamed service")}</strong>
              <small>${escapeHtml([duration, type].filter(Boolean).join(" · "))}${enabled ? "" : " · Disabled"}</small>
            </span>
          </label>
        `;
      })
      .join("");

    target.querySelectorAll("[data-manual-service-id]").forEach((checkbox) => {
      checkbox.addEventListener("change", () => {
        const id = checkbox.dataset.manualServiceId;
        if (!id) return;

        if (checkbox.checked) addState.serviceIds.add(id);
        else addState.serviceIds.delete(id);

        renderBatchSummary();
      });
    });
  }

  function renderDateGroups() {
    const target = document.getElementById("manualInventoryDateGroups");
    if (!target) return;

    target.innerHTML = addState.dateGroups
      .map((group, index) => `
        <div class="manual-inventory-date-group" data-date-group-id="${group.id}">
          <div class="manual-inventory-date-group-header">
            <label class="manual-inventory-field manual-inventory-date-field">
              <span>Date</span>
              <input
                type="date"
                min="${getTodayDateKey()}"
                value="${escapeHtml(group.date)}"
                data-date-group-date="${group.id}"
              />
            </label>

            <div class="manual-inventory-inline-actions">
              ${
                index > 0
                  ? `<button class="secondary-btn" type="button" data-copy-previous-times="${group.id}">Copy Previous Times</button>`
                  : ""
              }
              <button class="secondary-btn" type="button" data-duplicate-date-group="${group.id}">Duplicate Day</button>
              ${
                addState.dateGroups.length > 1
                  ? `<button class="danger-btn" type="button" data-remove-date-group="${group.id}">Remove</button>`
                  : ""
              }
            </div>
          </div>

          <div class="manual-inventory-time-chips">
            ${
              group.times.length
                ? group.times
                    .map(
                      (time) => `
                        <button class="manual-inventory-time-chip" type="button" data-remove-time="${escapeHtml(
                          `${group.id}|${time}`
                        )}" title="Remove time">
                          ${escapeHtml(formatTime(time))} <span>×</span>
                        </button>
                      `
                    )
                    .join("")
                : `<span class="manual-inventory-empty">No times added yet.</span>`
            }
          </div>

          <div class="manual-inventory-time-entry-row">
            <label class="manual-inventory-field">
              <span>Add one time</span>
              <input type="time" data-time-input="${group.id}" />
            </label>
            <button class="secondary-btn" type="button" data-add-time="${group.id}">+ Add Time</button>
          </div>

          <div class="manual-inventory-paste-row">
            <label class="manual-inventory-field">
              <span>Paste several times</span>
              <textarea data-paste-times="${group.id}" rows="2" placeholder="3:00 PM, 3:30 PM, 4:00 PM, 4:30 PM"></textarea>
            </label>
            <button class="secondary-btn" type="button" data-add-pasted-times="${group.id}">Add Pasted Times</button>
          </div>
        </div>
      `)
      .join("");

    attachDateGroupHandlers(target);
  }

  function findDateGroup(id) {
    return addState.dateGroups.find((group) => String(group.id) === String(id));
  }

  function attachDateGroupHandlers(root) {
    root.querySelectorAll("[data-date-group-date]").forEach((input) => {
      input.addEventListener("change", () => {
        const group = findDateGroup(input.dataset.dateGroupDate);
        if (!group) return;
        group.date = input.value;
        renderBatchSummary();
      });
    });

    root.querySelectorAll("[data-add-time]").forEach((button) => {
      button.addEventListener("click", () => {
        const group = findDateGroup(button.dataset.addTime);
        const input = root.querySelector(`[data-time-input="${button.dataset.addTime}"]`);
        if (!group || !input) return;

        const time = normalizeTimeToken(input.value);
        if (!time) return;

        group.times = uniqueSortedTimes([...group.times, time]);
        renderDateGroups();
        renderBatchSummary();
      });
    });

    root.querySelectorAll("[data-add-pasted-times]").forEach((button) => {
      button.addEventListener("click", () => {
        const group = findDateGroup(button.dataset.addPastedTimes);
        const textarea = root.querySelector(`[data-paste-times="${button.dataset.addPastedTimes}"]`);
        if (!group || !textarea) return;

        const tokens = String(textarea.value || "")
          .split(/[\n,;]+/)
          .map((token) => token.trim())
          .filter(Boolean);

        const normalized = tokens.map(normalizeTimeToken).filter(Boolean);
        const rejected = tokens.length - normalized.length;

        group.times = uniqueSortedTimes([...group.times, ...normalized]);
        renderDateGroups();
        renderBatchSummary();

        if (rejected > 0) {
          showAdminStatus(
            `${rejected} pasted time${rejected === 1 ? " was" : "s were"} ignored because the format was not recognized.`,
            "info"
          );
        }
      });
    });

    root.querySelectorAll("[data-remove-time]").forEach((button) => {
      button.addEventListener("click", () => {
        const [groupId, time] = String(button.dataset.removeTime || "").split("|");
        const group = findDateGroup(groupId);
        if (!group) return;

        group.times = group.times.filter((item) => item !== time);
        renderDateGroups();
        renderBatchSummary();
      });
    });

    root.querySelectorAll("[data-copy-previous-times]").forEach((button) => {
      button.addEventListener("click", () => {
        const groupIndex = addState.dateGroups.findIndex(
          (group) => String(group.id) === String(button.dataset.copyPreviousTimes)
        );

        if (groupIndex <= 0) return;

        addState.dateGroups[groupIndex].times = [...addState.dateGroups[groupIndex - 1].times];
        renderDateGroups();
        renderBatchSummary();
      });
    });

    root.querySelectorAll("[data-duplicate-date-group]").forEach((button) => {
      button.addEventListener("click", () => {
        const group = findDateGroup(button.dataset.duplicateDateGroup);
        if (!group) return;

        const groupIndex = addState.dateGroups.findIndex((item) => item.id === group.id);
        const duplicated = createDateGroup(addDays(group.date, 1), group.times);
        addState.dateGroups.splice(groupIndex + 1, 0, duplicated);
        renderDateGroups();
        renderBatchSummary();
      });
    });

    root.querySelectorAll("[data-remove-date-group]").forEach((button) => {
      button.addEventListener("click", () => {
        addState.dateGroups = addState.dateGroups.filter(
          (group) => String(group.id) !== String(button.dataset.removeDateGroup)
        );
        renderDateGroups();
        renderBatchSummary();
      });
    });
  }

  function renderBatchSummary() {
    const target = document.getElementById("manualInventoryBatchSummary");
    if (!target) return;

    const selectedServices = getSelectedServices();
    const slots = getFlatSlots();
    const total = selectedServices.length * slots.length;

    target.innerHTML = `
      <div>
        <strong>${selectedServices.length} service${selectedServices.length === 1 ? "" : "s"}</strong>
        <span>×</span>
        <strong>${slots.length} time${slots.length === 1 ? "" : "s"}</strong>
        <span>=</span>
        <strong>${total} appointment${total === 1 ? "" : "s"}</strong>
      </div>
      <small>${
        addState.protectFromScrape
          ? "Protected: future scrapes will preserve these manual inventory rows."
          : "Replaceable: future successful scrapes may replace these manual inventory rows."
      }</small>
    `;

    const submit = document.getElementById("manualInventorySubmit");
    if (submit) {
      submit.textContent = total ? `Add ${total} Appointment${total === 1 ? "" : "s"}` : "Add Inventory";
      submit.disabled = !addState.business || total === 0;
    }
  }

  async function submitManualInventory() {
    const business = addState.business;
    const serviceIds = [...addState.serviceIds];
    const slots = getFlatSlots();

    if (!business) {
      showAdminStatus("Select a business before adding inventory.", "error");
      return;
    }

    if (!serviceIds.length || !slots.length) {
      showAdminStatus("Select at least one service and add at least one date/time.", "error");
      return;
    }

    const button = document.getElementById("manualInventorySubmit");
    if (button) {
      button.disabled = true;
      button.textContent = "Adding...";
    }

    try {
      const data = await api("/api/admin/inventory/manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          businessId: business.businessId || business.id,
          serviceIds,
          slots,
          protectFromScrape: addState.protectFromScrape
        })
      });

      closeDialog(ADD_DIALOG_ID);
      refreshInventorySearch();

      showAdminStatus(
        `Manual inventory saved. Created ${data.created || 0}; skipped ${data.skipped || 0} duplicate${
          Number(data.skipped || 0) === 1 ? "" : "s"
        }${data.protectionUpdated ? `; protected ${data.protectionUpdated} existing manual row(s)` : ""}.`,
        "success"
      );
    } catch (error) {
      showAdminStatus(`Manual inventory save failed: ${error.message}`, "error");
      if (button) button.disabled = false;
      renderBatchSummary();
    }
  }

  function refreshInventorySearch() {
    const form = document.getElementById("inventorySearchForm");
    if (form && typeof form.requestSubmit === "function") {
      form.requestSubmit();
    }
  }

  async function openAddDialog() {
    resetAddState();
    renderAddDialog();
    document.getElementById(ADD_DIALOG_ID)?.showModal();
    setTimeout(() => document.getElementById("manualInventoryBusinessSearch")?.focus(), 0);
  }

  function renderManageDialog() {
    ensureDialogs();
    const dialog = document.getElementById(MANAGE_DIALOG_ID);
    if (!dialog) return;

    dialog.innerHTML = `
      <div class="manual-inventory-dialog-header">
        <div>
          <h3>Manage Manual Inventory</h3>
          <p>Protect, unprotect, or delete only inventory that was manually entered through this admin tool.</p>
        </div>
        <button class="manual-inventory-icon-btn" type="button" data-manual-close="${MANAGE_DIALOG_ID}" aria-label="Close">×</button>
      </div>

      <form id="manualInventoryManageFilters" class="manual-inventory-manage-filters">
        <label class="manual-inventory-field">
          <span>Business</span>
          <input id="manualManageBusiness" type="search" placeholder="Business name" />
        </label>
        <label class="manual-inventory-field">
          <span>Date</span>
          <input id="manualManageDate" type="date" />
        </label>
        <label class="manual-inventory-field">
          <span>Scraper overwrite</span>
          <select id="manualManageProtection">
            <option value="">All manual entries</option>
            <option value="replaceable">Allowed</option>
            <option value="protected">Protected</option>
          </select>
        </label>
        <button class="primary-btn" type="submit">Search</button>
      </form>

      <div class="manual-inventory-manage-actions">
        <button id="manualManageSelectAll" class="secondary-btn" type="button">Select Visible</button>
        <button id="manualManageProtect" class="secondary-btn" type="button">Protect Selected</button>
        <button id="manualManageUnprotect" class="secondary-btn" type="button">Allow Scraper Overwrite</button>
        <button id="manualManageDelete" class="danger-btn large-danger-btn" type="button">Delete Selected</button>
      </div>

      <div id="manualInventoryManageSummary" class="manual-inventory-manage-summary"></div>
      <div id="manualInventoryManageResults" class="manual-inventory-manage-results"></div>

      <div class="manual-inventory-dialog-actions">
        <button class="secondary-btn" type="button" data-manual-close="${MANAGE_DIALOG_ID}">Close</button>
      </div>
    `;

    attachDialogCloseButtons(dialog);
    attachManageHandlers();
  }

  function attachManageHandlers() {
    document.getElementById("manualInventoryManageFilters")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      await loadManualInventoryRows();
    });

    document.getElementById("manualManageSelectAll")?.addEventListener("click", () => {
      document.querySelectorAll("[data-manual-row-id]").forEach((checkbox) => {
        checkbox.checked = true;
      });
    });

    document.getElementById("manualManageProtect")?.addEventListener("click", () =>
      updateSelectedProtection(true)
    );

    document.getElementById("manualManageUnprotect")?.addEventListener("click", () =>
      updateSelectedProtection(false)
    );

    document.getElementById("manualManageDelete")?.addEventListener("click", deleteSelectedManualRows);
  }

  function getSelectedManualRowIds() {
    return [...document.querySelectorAll("[data-manual-row-id]:checked")]
      .map((checkbox) => checkbox.dataset.manualRowId)
      .filter(Boolean);
  }

  async function loadManualInventoryRows() {
    const target = document.getElementById("manualInventoryManageResults");
    const summary = document.getElementById("manualInventoryManageSummary");
    if (!target) return;

    target.innerHTML = `<p class="manual-inventory-empty">Loading...</p>`;

    const params = new URLSearchParams({ limit: "300" });
    const business = document.getElementById("manualManageBusiness")?.value.trim() || "";
    const date = document.getElementById("manualManageDate")?.value || "";
    const protection = document.getElementById("manualManageProtection")?.value || "";

    if (business) params.set("business", business);
    if (date) params.set("date", date);
    if (protection) params.set("protection", protection);

    try {
      const data = await api(`/api/admin/inventory/manual?${params.toString()}`);
      manageState.rows = Array.isArray(data.rows) ? data.rows : [];
      manageState.total = Number(data.total || 0);

      if (summary) {
        summary.textContent = `${manageState.total} matching manual inventory record${manageState.total === 1 ? "" : "s"}${
          manageState.total > manageState.rows.length ? ` · showing first ${manageState.rows.length}` : ""
        }`;
      }

      target.innerHTML = manageState.rows.length
        ? manageState.rows
            .map((row) => {
              const protectedValue = row.scrape_overwrite_protected === true;
              const dateText = String(row.local_date || "").slice(0, 10);
              const timeText = String(row.local_time || "").slice(0, 5);

              return `
                <label class="manual-inventory-manage-row">
                  <input type="checkbox" data-manual-row-id="${escapeHtml(row.id)}" />
                  <span class="manual-inventory-manage-main">
                    <strong>${escapeHtml(row.business_name || "Unknown business")}</strong>
                    <span>${escapeHtml(row.service_name || row.service_category || "Service")} · ${escapeHtml(
                      row.duration_minutes || "?"
                    )} min</span>
                  </span>
                  <span class="manual-inventory-manage-time">
                    <strong>${escapeHtml(dateText)}</strong>
                    <span>${escapeHtml(formatTime(timeText))}</span>
                  </span>
                  <span class="manual-inventory-overwrite-pill ${protectedValue ? "is-protected" : "is-replaceable"}">
                    ${protectedValue ? "Protected" : "Scraper overwrite allowed"}
                  </span>
                </label>
              `;
            })
            .join("")
        : `<p class="manual-inventory-empty">No manual inventory matched these filters.</p>`;
    } catch (error) {
      target.innerHTML = `<p class="manual-inventory-error">${escapeHtml(error.message)}</p>`;
    }
  }

  async function updateSelectedProtection(protectedValue) {
    const ids = getSelectedManualRowIds();

    if (!ids.length) {
      showAdminStatus("Select at least one manual inventory record.", "error");
      return;
    }

    try {
      const data = await api("/api/admin/inventory/manual/protection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids, protected: protectedValue })
      });

      showAdminStatus(
        `${data.updated || 0} manual inventory record${Number(data.updated || 0) === 1 ? "" : "s"} ${
          protectedValue ? "protected from scraping" : "set to allow scraper overwrite"
        }.`,
        "success"
      );

      await loadManualInventoryRows();
      refreshInventorySearch();
    } catch (error) {
      showAdminStatus(`Protection update failed: ${error.message}`, "error");
    }
  }

  async function deleteSelectedManualRows() {
    const ids = getSelectedManualRowIds();

    if (!ids.length) {
      showAdminStatus("Select at least one manual inventory record.", "error");
      return;
    }

    const confirmed = window.confirm(
      `Delete ${ids.length} selected manual inventory record${ids.length === 1 ? "" : "s"}?\n\nThis does not delete scraped inventory.`
    );

    if (!confirmed) return;

    try {
      const data = await api("/api/admin/inventory/manual/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids })
      });

      showAdminStatus(
        `Deleted ${data.deleted || 0} manual inventory record${Number(data.deleted || 0) === 1 ? "" : "s"}.`,
        "success"
      );

      await loadManualInventoryRows();
      refreshInventorySearch();
    } catch (error) {
      showAdminStatus(`Manual inventory delete failed: ${error.message}`, "error");
    }
  }

  async function openManageDialog() {
    renderManageDialog();
    document.getElementById(MANAGE_DIALOG_ID)?.showModal();
    await loadManualInventoryRows();
  }

  function installInventoryToolbar() {
    const inventoryForm = document.getElementById("inventorySearchForm");
    if (!inventoryForm || document.getElementById(MANUAL_TOOLBAR_ID)) return;

    const toolbar = document.createElement("div");
    toolbar.id = MANUAL_TOOLBAR_ID;
    toolbar.className = "manual-inventory-toolbar";
    toolbar.innerHTML = `
      <div>
        <strong>Manual Inventory Entry</strong>
        <span>Bulk-add confirmed inventory from configured business services. Scraper overwrite is allowed by default.</span>
      </div>
      <div class="manual-inventory-toolbar-actions">
        <button id="manualInventoryManageBtn" class="secondary-btn" type="button">Manage Manual Inventory</button>
        <button id="manualInventoryAddBtn" class="primary-btn" type="button">+ Add Inventory</button>
      </div>
    `;

    inventoryForm.parentNode.insertBefore(toolbar, inventoryForm);

    document.getElementById("manualInventoryAddBtn")?.addEventListener("click", openAddDialog);
    document.getElementById("manualInventoryManageBtn")?.addEventListener("click", openManageDialog);
  }

  ensureDialogs();
  installInventoryToolbar();

  const content = document.getElementById("content");
  if (content) {
    const observer = new MutationObserver(() => installInventoryToolbar());
    observer.observe(content, { childList: true, subtree: true });
  }
})();