(() => {
  const PENDING_ALERT_KEY =
    "nextappt_pending_alert";

  const searchForm =
    document.getElementById(
      "chatSearchForm"
    );

  const searchInput =
    document.getElementById(
      "searchInput"
    );

  if (
    !searchForm ||
    !searchInput
  ) {
    return;
  }

  const panel =
    document.createElement(
      "section"
    );

  panel.className =
    "search-alert-panel";

  panel.innerHTML = `
    <div class="search-alert-panel-copy">
      <p class="search-alert-panel-title">
        Find the exact appointment you want!
      </p>
      <p class="search-alert-panel-text">
        Save this search and NextAppt can email you when a matching opening appears.
      </p>
    </div>

    <div class="search-alert-panel-actions">
      <button
        id="saveSearchAlertBtn"
        class="search-alert-btn"
        type="button"
      >
        Notify me
      </button>

      <a
        class="search-alert-link"
        href="/account"
      >
        My alerts
      </a>
    </div>

    <p
      id="searchAlertStatus"
      class="search-alert-status"
      aria-live="polite"
    ></p>
  `;

  const chatPanel =
    searchForm.closest(
      ".chat-panel"
    ) ||
    searchForm.parentElement;

  chatPanel.appendChild(
    panel
  );

  const button =
    document.getElementById(
      "saveSearchAlertBtn"
    );

  const status =
    document.getElementById(
      "searchAlertStatus"
    );

  function numberOrNull(
    value
  ) {
    const number =
      Number(value);

    return Number.isFinite(
      number
    )
      ? number
      : null;
  }

  function buildPayload() {
    const body =
      document.body;

    let latitude = null;
    let longitude = null;
    let radiusMiles = null;

    try {
      if (
        typeof userLatitude !==
        "undefined"
      ) {
        latitude =
          numberOrNull(
            userLatitude
          );
      }

      if (
        typeof userLongitude !==
        "undefined"
      ) {
        longitude =
          numberOrNull(
            userLongitude
          );
      }

      if (
        typeof maxDistanceMiles !==
        "undefined"
      ) {
        radiusMiles =
          numberOrNull(
            maxDistanceMiles
          );
      }
    } catch {
      // Save without geolocation if unavailable.
    }

    return {
      search:
        String(
          searchInput.value ||
          ""
        ).trim(),
      metro:
        body.dataset
          .metroSlug ||
        "",
      categorySlug:
        body.dataset
          .categorySlug ||
        (
          typeof inferredSearchCategory !==
          "undefined"
            ? inferredSearchCategory?.slug || ""
            : ""
        ),
      latitude,
      longitude,
      radiusMiles,
      includeInferred: true
    };
  }

  async function saveAlert() {
    const payload =
      buildPayload();

    button.disabled =
      true;

    status.className =
      "search-alert-status";

    status.textContent =
      "Saving alert...";

    try {
      const response =
        await fetch(
          "/api/user/alerts/from-search",
          {
            method:
              "POST",
            headers: {
              "Content-Type":
                "application/json"
            },
            body:
              JSON.stringify(
                payload
              )
          }
        );

      const data =
        await response
          .json()
          .catch(
            () => ({})
          );

      if (
        response.status ===
        401
      ) {
        localStorage.setItem(
          PENDING_ALERT_KEY,
          JSON.stringify(
            payload
          )
        );

        const returnTo =
          `${window.location.pathname}${window.location.search}`;

        window.location.href =
          `/account?createAlert=1&returnTo=${encodeURIComponent(
            returnTo
          )}`;

        return;
      }

      if (!response.ok) {
        throw new Error(
          data.error ||
          "Could not save this appointment alert."
        );
      }

      localStorage.removeItem(
        PENDING_ALERT_KEY
      );

      status.className =
        "search-alert-status success";

      status.textContent =
        "Alert saved. We'll email you when a new matching opening appears.";

      button.textContent =
        "Alert saved";
    } catch (error) {
      status.className =
        "search-alert-status error";

      status.textContent =
        error.message;

      button.disabled =
        false;
    }
  }

  button.addEventListener(
    "click",
    saveAlert
  );
})();