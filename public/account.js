(() => {
  const PENDING_ALERT_KEY =
    "nextappt_pending_alert";

  const authCard =
    document.getElementById(
      "authCard"
    );

  const profileCard =
    document.getElementById(
      "profileCard"
    );

  const requestCodeForm =
    document.getElementById(
      "requestCodeForm"
    );

  const verifyCodeForm =
    document.getElementById(
      "verifyCodeForm"
    );

  const emailInput =
    document.getElementById(
      "accountEmail"
    );

  const codeInput =
    document.getElementById(
      "accountCode"
    );

  const authStatus =
    document.getElementById(
      "authStatus"
    );

  const accountStatus =
    document.getElementById(
      "accountStatus"
    );

  let pendingEmail = "";

  async function jsonFetch(
    url,
    options = {}
  ) {
    const response =
      await fetch(
        url,
        options
      );

    const data =
      await response
        .json()
        .catch(
          () => ({})
        );

    if (!response.ok) {
      throw new Error(
        data.error ||
        `${response.status} ${response.statusText}`
      );
    }

    return data;
  }

  function showSignedOut() {
    authCard.hidden = false;
    profileCard.hidden = true;
  }

  function escapeHtml(
    value
  ) {
    return String(
      value ?? ""
    )
      .replaceAll(
        "&",
        "&amp;"
      )
      .replaceAll(
        "<",
        "&lt;"
      )
      .replaceAll(
        ">",
        "&gt;"
      )
      .replaceAll(
        '"',
        "&quot;"
      )
      .replaceAll(
        "'",
        "&#039;"
      );
  }

  function formatDate(
    value
  ) {
    if (!value) {
      return "";
    }

    const match =
      String(value).match(
        /^(\d{4})-(\d{2})-(\d{2})/
      );

    if (!match) {
      return String(
        value
      );
    }

    return `${match[2]}/${match[3]}/${match[1]}`;
  }

  function formatTime(
    value
  ) {
    const match =
      String(
        value || ""
      ).match(
        /^(\d{1,2}):(\d{2})/
      );

    if (!match) {
      return "";
    }

    const hour24 =
      Number(
        match[1]
      );

    return `${hour24 % 12 || 12}:${match[2]} ${hour24 >= 12 ? "PM" : "AM"}`;
  }

  function alertDetails(
    alert
  ) {
    const details = [
      alert.metro,
      alert.categorySlug,
      alert.serviceType &&
      alert.serviceType !==
        "massage"
        ? alert.serviceType
            .replaceAll(
              "_",
              " "
            )
        : "",
      alert.durationMinutes
        ? `${alert.durationMinutes} min`
        : "",
      alert.targetDate
        ? formatDate(
            alert.targetDate
          )
        : "",
      alert.startTime ||
      alert.endTime
        ? `${
            alert.startTime
              ? formatTime(
                  alert.startTime
                )
              : "Any time"
          }${
            alert.endTime
              ? ` – ${formatTime(
                  alert.endTime
                )}`
              : " and later"
          }`
        : ""
    ].filter(Boolean);

    return details.join(
      " · "
    );
  }

  function renderAlerts(
    alerts = []
  ) {
    const target =
      document.getElementById(
        "alertsList"
      );

    if (!alerts.length) {
      target.innerHTML = `
        <p class="muted">
          No appointment alerts yet. Save a search from any appointment results page to create one.
        </p>
      `;

      return;
    }

    target.innerHTML =
      alerts
        .map(
          (alert) => `
            <div class="alert-row">
              <div class="alert-row-main">
                <strong>
                  ${escapeHtml(
                    alert.label ||
                    alert.serviceType ||
                    "Appointment alert"
                  )}
                </strong>

                <div>
                  ${escapeHtml(
                    alertDetails(
                      alert
                    )
                  )}
                </div>

                <small class="alert-status-label ${escapeHtml(
                  alert.status ||
                  "active"
                )}">
                  ${escapeHtml(
                    alert.status ||
                    "active"
                  )}
                </small>

                ${
                  alert.lastCheckedAt
                    ? `<small>Last checked ${escapeHtml(
                        new Date(
                          alert.lastCheckedAt
                        ).toLocaleString()
                      )}</small>`
                    : ""
                }

                ${
                  alert.lastNotifiedAt
                    ? `<small>Last notification ${escapeHtml(
                        new Date(
                          alert.lastNotifiedAt
                        ).toLocaleString()
                      )}</small>`
                    : ""
                }
              </div>

              <div class="alert-row-actions">
                ${
                  alert.status !==
                  "expired"
                    ? `
                      <button
                        class="alert-action secondary"
                        type="button"
                        data-alert-status="${escapeHtml(
                          alert.id
                        )}"
                        data-next-status="${
                          alert.status ===
                          "paused"
                            ? "active"
                            : "paused"
                        }"
                      >
                        ${
                          alert.status ===
                          "paused"
                            ? "Resume"
                            : "Pause"
                        }
                      </button>
                    `
                    : ""
                }

                <button
                  class="alert-action danger"
                  type="button"
                  data-alert-delete="${escapeHtml(
                    alert.id
                  )}"
                >
                  Delete
                </button>
              </div>
            </div>
          `
        )
        .join("");
  }

  function renderAccount(
    data
  ) {
    authCard.hidden = true;
    profileCard.hidden = false;

    document.getElementById(
      "signedInEmail"
    ).textContent =
      data.user?.email ||
      "";

    document.getElementById(
      "firstName"
    ).value =
      data.user?.firstName ||
      "";

    document.getElementById(
      "appointmentAlertsEnabled"
    ).checked =
      Boolean(
        data.preferences
          ?.appointmentAlertsEnabled
      );

    document.getElementById(
      "productUpdatesEnabled"
    ).checked =
      Boolean(
        data.preferences
          ?.productUpdatesEnabled
      );

    document.getElementById(
      "marketingEnabled"
    ).checked =
      Boolean(
        data.preferences
          ?.marketingEnabled
      );

    renderAlerts(
      data.alerts ||
      []
    );
  }

  async function createPendingAlertIfNeeded() {
    const raw =
      localStorage.getItem(
        PENDING_ALERT_KEY
      );

    if (!raw) {
      return false;
    }

    let payload;

    try {
      payload =
        JSON.parse(
          raw
        );
    } catch {
      localStorage.removeItem(
        PENDING_ALERT_KEY
      );

      return false;
    }

    accountStatus.textContent =
      "Saving the appointment alert you requested...";

    try {
      await jsonFetch(
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

      localStorage.removeItem(
        PENDING_ALERT_KEY
      );

      accountStatus.textContent =
        "Appointment alert saved. We'll email you when a new matching opening appears.";

      return true;
    } catch (error) {
      accountStatus.textContent =
        `Could not save pending alert: ${error.message}`;

      return false;
    }
  }

  async function loadMe({
    processPendingAlert = true
  } = {}) {
    try {
      let data =
        await jsonFetch(
          "/api/user/me"
        );

      renderAccount(
        data
      );

      if (
        processPendingAlert &&
        localStorage.getItem(
          PENDING_ALERT_KEY
        )
      ) {
        const created =
          await createPendingAlertIfNeeded();

        if (created) {
          data =
            await jsonFetch(
              "/api/user/me"
            );

          renderAccount(
            data
          );
        }
      }

      return true;
    } catch {
      showSignedOut();
      return false;
    }
  }

  async function requestCode() {
    pendingEmail =
      String(
        emailInput.value ||
        ""
      )
        .trim()
        .toLowerCase();

    authStatus.textContent =
      "Sending code...";

    const data =
      await jsonFetch(
        "/api/user/auth/request-code",
        {
          method:
            "POST",
          headers: {
            "Content-Type":
              "application/json"
          },
          body:
            JSON.stringify({
              email:
                pendingEmail,
              source:
                "account"
            })
        }
      );

    authStatus.textContent =
      data.message ||
      "Login code sent.";

    verifyCodeForm.hidden =
      false;

    codeInput.focus();
  }

  requestCodeForm.addEventListener(
    "submit",
    async (
      event
    ) => {
      event.preventDefault();

      try {
        await requestCode();
      } catch (error) {
        authStatus.textContent =
          error.message;
      }
    }
  );

  document.getElementById(
    "requestAnotherCode"
  ).addEventListener(
    "click",
    async () => {
      try {
        await requestCode();
      } catch (error) {
        authStatus.textContent =
          error.message;
      }
    }
  );

  verifyCodeForm.addEventListener(
    "submit",
    async (
      event
    ) => {
      event.preventDefault();

      authStatus.textContent =
        "Verifying...";

      try {
        await jsonFetch(
          "/api/user/auth/verify-code",
          {
            method:
              "POST",
            headers: {
              "Content-Type":
                "application/json"
            },
            body:
              JSON.stringify({
                email:
                  pendingEmail ||
                  emailInput.value,
                code:
                  codeInput.value
              })
          }
        );

        authStatus.textContent =
          "";

        await loadMe();
      } catch (error) {
        authStatus.textContent =
          error.message;
      }
    }
  );

  document.getElementById(
    "profileForm"
  ).addEventListener(
    "submit",
    async (
      event
    ) => {
      event.preventDefault();

      accountStatus.textContent =
        "Saving profile...";

      try {
        await jsonFetch(
          "/api/user/profile",
          {
            method:
              "PATCH",
            headers: {
              "Content-Type":
                "application/json"
            },
            body:
              JSON.stringify({
                firstName:
                  document.getElementById(
                    "firstName"
                  ).value
              })
          }
        );

        accountStatus.textContent =
          "Profile saved.";
      } catch (error) {
        accountStatus.textContent =
          error.message;
      }
    }
  );

  document.getElementById(
    "preferencesForm"
  ).addEventListener(
    "submit",
    async (
      event
    ) => {
      event.preventDefault();

      accountStatus.textContent =
        "Saving preferences...";

      try {
        await jsonFetch(
          "/api/user/preferences",
          {
            method:
              "PATCH",
            headers: {
              "Content-Type":
                "application/json"
            },
            body:
              JSON.stringify({
                appointmentAlertsEnabled:
                  document.getElementById(
                    "appointmentAlertsEnabled"
                  ).checked,
                productUpdatesEnabled:
                  document.getElementById(
                    "productUpdatesEnabled"
                  ).checked,
                marketingEnabled:
                  document.getElementById(
                    "marketingEnabled"
                  ).checked
              })
          }
        );

        accountStatus.textContent =
          "Email preferences saved.";
      } catch (error) {
        accountStatus.textContent =
          error.message;
      }
    }
  );

  document.getElementById(
    "alertsList"
  ).addEventListener(
    "click",
    async (
      event
    ) => {
      const statusButton =
        event.target.closest(
          "[data-alert-status]"
        );

      const deleteButton =
        event.target.closest(
          "[data-alert-delete]"
        );

      try {
        if (statusButton) {
          accountStatus.textContent =
            "Updating alert...";

          await jsonFetch(
            `/api/user/alerts/${encodeURIComponent(
              statusButton.dataset
                .alertStatus
            )}`,
            {
              method:
                "PATCH",
              headers: {
                "Content-Type":
                  "application/json"
              },
              body:
                JSON.stringify({
                  status:
                    statusButton.dataset
                      .nextStatus
                })
            }
          );

          accountStatus.textContent =
            "Alert updated.";

          await loadMe({
            processPendingAlert:
              false
          });
        }

        if (deleteButton) {
          if (
            !window.confirm(
              "Delete this appointment alert?"
            )
          ) {
            return;
          }

          accountStatus.textContent =
            "Deleting alert...";

          await jsonFetch(
            `/api/user/alerts/${encodeURIComponent(
              deleteButton.dataset
                .alertDelete
            )}`,
            {
              method:
                "DELETE"
            }
          );

          accountStatus.textContent =
            "Alert deleted.";

          await loadMe({
            processPendingAlert:
              false
          });
        }
      } catch (error) {
        accountStatus.textContent =
          error.message;
      }
    }
  );

  document.getElementById(
    "logoutBtn"
  ).addEventListener(
    "click",
    async () => {
      try {
        await jsonFetch(
          "/api/user/auth/logout",
          {
            method:
              "POST"
          }
        );
      } catch {
        // Clear UI even if server session expired.
      }

      verifyCodeForm.hidden =
        true;

      codeInput.value =
        "";

      showSignedOut();
    }
  );

  loadMe();
})();