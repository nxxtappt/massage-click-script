(() => {
  let usersState = {
    search: "",
    status: "",
    verified: "",
    page: 1,
    limit: 25,
    total: 0,
    totalPages: 1
  };

  function ensureUsersStyles() {
    if (
      document.getElementById(
        "adminUsersStyles"
      )
    ) {
      return;
    }

    const style =
      document.createElement(
        "style"
      );

    style.id =
      "adminUsersStyles";

    style.textContent = `
      .users-toolbar {
        display:grid;
        grid-template-columns:minmax(220px,2fr) minmax(150px,1fr) minmax(150px,1fr) auto;
        gap:12px;
        margin-bottom:18px;
        align-items:end;
      }

      .users-toolbar label {
        display:flex;
        flex-direction:column;
        gap:6px;
        color:#475569;
        font-size:13px;
        font-weight:700;
      }

      .users-toolbar input,
      .users-toolbar select {
        width:100%;
        padding:10px 12px;
        border:1px solid #cbd5e1;
        border-radius:10px;
        background:#fff;
        color:#0f172a;
      }

      .users-stats {
        display:grid;
        grid-template-columns:repeat(5,minmax(120px,1fr));
        gap:12px;
        margin-bottom:18px;
      }

      .users-stat {
        border:1px solid #e2e8f0;
        border-radius:12px;
        padding:14px;
        background:#f8fafc;
      }

      .users-stat strong {
        display:block;
        font-size:24px;
        color:#0f172a;
      }

      .users-stat span {
        color:#64748b;
        font-size:13px;
      }

      .alert-engine-card {
        border:1px solid #cfe1ee;
        background:#f7fbfe;
        border-radius:14px;
        padding:16px;
        margin-bottom:18px;
      }

      .alert-engine-head {
        display:flex;
        justify-content:space-between;
        align-items:center;
        gap:14px;
        flex-wrap:wrap;
      }

      .alert-engine-head h4 {
        margin:0 0 4px;
      }

      .alert-engine-head p {
        margin:0;
        color:#64748b;
        font-size:13px;
      }

      .alert-engine-stats {
        display:flex;
        gap:8px;
        flex-wrap:wrap;
        margin-top:12px;
      }

      .alert-engine-pill {
        background:#fff;
        border:1px solid #dbe4ec;
        border-radius:999px;
        padding:5px 9px;
        font-size:12px;
        color:#475569;
      }

      .users-table-wrap {
        overflow:auto;
        border:1px solid #e2e8f0;
        border-radius:12px;
      }

      .users-table {
        width:100%;
        border-collapse:collapse;
        min-width:980px;
      }

      .users-table th,
      .users-table td {
        padding:11px 12px;
        border-bottom:1px solid #e2e8f0;
        text-align:left;
        vertical-align:top;
        font-size:13px;
      }

      .users-table th {
        background:#f8fafc;
        color:#475569;
        position:sticky;
        top:0;
        z-index:1;
      }

      .users-pill {
        display:inline-block;
        padding:4px 8px;
        border-radius:999px;
        background:#e2e8f0;
        color:#334155;
        font-size:12px;
        font-weight:700;
      }

      .users-pill.active,
      .users-pill.verified {
        background:#dcfce7;
        color:#166534;
      }

      .users-pill.lead {
        background:#fef3c7;
        color:#92400e;
      }

      .users-pill.disabled {
        background:#fee2e2;
        color:#991b1b;
      }

      .users-prefs {
        display:flex;
        flex-wrap:wrap;
        gap:5px;
      }

      .users-pref-on {
        background:#e0f2fe;
        color:#075985;
        padding:3px 7px;
        border-radius:999px;
        font-size:11px;
        font-weight:700;
      }

      .users-pref-off {
        color:#94a3b8;
        font-size:11px;
      }

      .users-pagination {
        display:flex;
        justify-content:space-between;
        align-items:center;
        gap:12px;
        margin-top:16px;
      }

      .users-action {
        border:1px solid #cbd5e1;
        background:#fff;
        padding:7px 10px;
        border-radius:8px;
        cursor:pointer;
        font-size:12px;
        font-weight:700;
      }

      .users-action.danger {
        border-color:#fecaca;
        color:#991b1b;
        background:#fff7f7;
      }

      @media (max-width:900px) {
        .users-toolbar {
          grid-template-columns:1fr 1fr;
        }

        .users-stats {
          grid-template-columns:repeat(2,1fr);
        }
      }
    `;

    document.head.appendChild(
      style
    );
  }

  function ensureUsersNavButton() {
    if (
      document.querySelector(
        ".nav-btn[data-view='users']"
      )
    ) {
      if (
        typeof refreshNavButtons ===
        "function"
      ) {
        refreshNavButtons();
      }

      return;
    }

    const navContainer =
      document.querySelector(
        ".nav"
      ) ||
      document.querySelector(
        "nav"
      );

    if (!navContainer) {
      return;
    }

    const button =
      document.createElement(
        "button"
      );

    button.type =
      "button";

    button.className =
      "nav-btn";

    button.dataset.view =
      "users";

    button.textContent =
      "Users & Emails";

    const subscriptionsButton =
      navContainer.querySelector(
        ".nav-btn[data-view='subscriptions']"
      );

    const claimsButton =
      navContainer.querySelector(
        ".nav-btn[data-view='claims']"
      );

    const anchor =
      subscriptionsButton ||
      claimsButton ||
      navContainer.querySelector(
        ".nav-btn[data-view='settings']"
      );

    if (anchor) {
      navContainer.insertBefore(
        button,
        anchor
      );
    } else {
      navContainer.appendChild(
        button
      );
    }

    if (
      typeof refreshNavButtons ===
      "function"
    ) {
      refreshNavButtons();
    }

    button.addEventListener(
      "click",
      () => {
        loadView(
          "users"
        );
      }
    );
  }

  function fmtDate(
    value
  ) {
    if (!value) {
      return "—";
    }

    const date =
      new Date(
        value
      );

    if (
      Number.isNaN(
        date.getTime()
      )
    ) {
      return String(
        value
      );
    }

    return date
      .toLocaleString();
  }

  function buildUserQuery() {
    const params =
      new URLSearchParams();

    if (
      usersState.search
    ) {
      params.set(
        "search",
        usersState.search
      );
    }

    if (
      usersState.status
    ) {
      params.set(
        "status",
        usersState.status
      );
    }

    if (
      usersState.verified
    ) {
      params.set(
        "verified",
        usersState.verified
      );
    }

    params.set(
      "page",
      String(
        usersState.page
      )
    );

    params.set(
      "limit",
      String(
        usersState.limit
      )
    );

    return params.toString();
  }

  function prefHtml(
    user
  ) {
    const enabled = [];

    if (
      user.appointmentAlertsEnabled
    ) {
      enabled.push(
        "Alerts"
      );
    }

    if (
      user.productUpdatesEnabled
    ) {
      enabled.push(
        "Product"
      );
    }

    if (
      user.marketingEnabled
    ) {
      enabled.push(
        "Marketing"
      );
    }

    if (!enabled.length) {
      return `<span class="users-pref-off">None</span>`;
    }

    return enabled
      .map(
        (item) =>
          `<span class="users-pref-on">${escapeHtml(
            item
          )}</span>`
      )
      .join("");
  }

  function renderAlertEngine(
    activity = {}
  ) {
    const stats =
      activity.stats ||
      {};

    return `
      <div class="alert-engine-card">
        <div class="alert-engine-head">
          <div>
            <h4>
              Appointment Alert Engine
            </h4>
            <p>
              Matches saved user requests against stored PostgreSQL inventory. It never starts a scrape.
            </p>
          </div>

          <button
            id="runUserAlertMatcherBtn"
            class="primary-btn"
            type="button"
          >
            Run matcher now
          </button>
        </div>

        <div class="alert-engine-stats">
          <span class="alert-engine-pill">
            Sent: ${Number(
              stats.sent ||
              0
            )}
          </span>

          <span class="alert-engine-pill">
            Sent last 24h: ${Number(
              stats.sentLast24Hours ||
              0
            )}
          </span>

          <span class="alert-engine-pill">
            Pending: ${Number(
              stats.pending ||
              0
            )}
          </span>

          <span class="alert-engine-pill">
            Failed: ${Number(
              stats.failed ||
              0
            )}
          </span>
        </div>
      </div>
    `;
  }

  function renderUsers(
    data,
    activity = {}
  ) {
    const users =
      Array.isArray(
        data.users
      )
        ? data.users
        : [];

    const stats =
      data.stats ||
      {};

    usersState.total =
      Number(
        data.total ||
        0
      );

    usersState.totalPages =
      Number(
        data.totalPages ||
        1
      );

    usersState.page =
      Number(
        data.page ||
        usersState.page ||
        1
      );

    content.innerHTML = `
      <div class="section-heading compact-heading">
        <div>
          <h3>
            Users & Emails
          </h3>
          <p>
            Consumer leads, verified accounts, email preferences, and appointment-alert activity.
          </p>
        </div>
      </div>

      ${renderAlertEngine(
        activity
      )}

      <div class="users-stats">
        <div class="users-stat">
          <strong>${Number(
            stats.total ||
            0
          )}</strong>
          <span>Total users</span>
        </div>

        <div class="users-stat">
          <strong>${Number(
            stats.leads ||
            0
          )}</strong>
          <span>Leads</span>
        </div>

        <div class="users-stat">
          <strong>${Number(
            stats.active ||
            0
          )}</strong>
          <span>Active accounts</span>
        </div>

        <div class="users-stat">
          <strong>${Number(
            stats.verified ||
            0
          )}</strong>
          <span>Verified emails</span>
        </div>

        <div class="users-stat">
          <strong>${Number(
            stats.activeAlerts ||
            0
          )}</strong>
          <span>Active alerts</span>
        </div>
      </div>

      <form
        id="usersFilterForm"
        class="users-toolbar"
      >
        <label>
          Search email or name
          <input
            id="usersSearch"
            value="${escapeHtml(
              usersState.search
            )}"
            placeholder="Search users"
          />
        </label>

        <label>
          Status
          <select id="usersStatus">
            <option value="">
              All statuses
            </option>
            <option
              value="lead"
              ${
                usersState.status ===
                "lead"
                  ? "selected"
                  : ""
              }
            >
              Lead
            </option>
            <option
              value="active"
              ${
                usersState.status ===
                "active"
                  ? "selected"
                  : ""
              }
            >
              Active
            </option>
            <option
              value="disabled"
              ${
                usersState.status ===
                "disabled"
                  ? "selected"
                  : ""
              }
            >
              Disabled
            </option>
          </select>
        </label>

        <label>
          Verification
          <select id="usersVerified">
            <option value="">
              All
            </option>
            <option
              value="true"
              ${
                usersState.verified ===
                "true"
                  ? "selected"
                  : ""
              }
            >
              Verified
            </option>
            <option
              value="false"
              ${
                usersState.verified ===
                "false"
                  ? "selected"
                  : ""
              }
            >
              Unverified
            </option>
          </select>
        </label>

        <button
          class="primary-btn"
          type="submit"
        >
          Search
        </button>
      </form>

      <div class="users-table-wrap">
        <table class="users-table">
          <thead>
            <tr>
              <th>Email</th>
              <th>Status</th>
              <th>Verified</th>
              <th>Source</th>
              <th>Preferences</th>
              <th>Alerts</th>
              <th>Joined</th>
              <th>Last login</th>
              <th>Action</th>
            </tr>
          </thead>

          <tbody>
            ${
              users.length
                ? users.map(
                    (user) => `
                      <tr>
                        <td>
                          <strong>${escapeHtml(
                            user.email
                          )}</strong>
                          ${
                            user.firstName
                              ? `<br><span>${escapeHtml(
                                  user.firstName
                                )}</span>`
                              : ""
                          }
                        </td>

                        <td>
                          <span class="users-pill ${escapeHtml(
                            user.status
                          )}">
                            ${escapeHtml(
                              user.status
                            )}
                          </span>
                        </td>

                        <td>
                          ${
                            user.emailVerified
                              ? `<span class="users-pill verified">Verified</span>`
                              : `<span class="users-pill">No</span>`
                          }
                        </td>

                        <td>
                          ${escapeHtml(
                            user.lastSource ||
                            user.source ||
                            "—"
                          )}
                        </td>

                        <td>
                          <div class="users-prefs">
                            ${prefHtml(
                              user
                            )}
                          </div>
                        </td>

                        <td>
                          ${Number(
                            user.activeAlertCount ||
                            0
                          )}
                        </td>

                        <td>
                          ${escapeHtml(
                            fmtDate(
                              user.createdAt
                            )
                          )}
                        </td>

                        <td>
                          ${escapeHtml(
                            fmtDate(
                              user.lastLoginAt
                            )
                          )}
                        </td>

                        <td>
                          <button
                            class="users-action ${
                              user.status ===
                              "disabled"
                                ? ""
                                : "danger"
                            }"
                            type="button"
                            data-user-status-id="${escapeHtml(
                              user.id
                            )}"
                            data-next-status="${
                              user.status ===
                              "disabled"
                                ? (
                                    user.emailVerified
                                      ? "active"
                                      : "lead"
                                  )
                                : "disabled"
                            }"
                          >
                            ${
                              user.status ===
                              "disabled"
                                ? "Enable as lead"
                                : "Disable"
                            }
                          </button>
                        </td>
                      </tr>
                    `
                  ).join("")
                : `<tr><td colspan="9">No users matched these filters.</td></tr>`
            }
          </tbody>
        </table>
      </div>

      <div class="users-pagination">
        <button
          id="usersPrev"
          class="secondary-btn"
          type="button"
          ${
            usersState.page <=
            1
              ? "disabled"
              : ""
          }
        >
          Previous
        </button>

        <span>
          Page ${usersState.page}
          of ${usersState.totalPages}
          · ${usersState.total} users
        </span>

        <button
          id="usersNext"
          class="secondary-btn"
          type="button"
          ${
            usersState.page >=
            usersState.totalPages
              ? "disabled"
              : ""
          }
        >
          Next
        </button>
      </div>
    `;

    document.getElementById(
      "runUserAlertMatcherBtn"
    )?.addEventListener(
      "click",
      async () => {
        try {
          setStatus(
            "Running appointment alert matcher...",
            "info"
          );

          const result =
            await fetchJson(
              "/api/admin/users/alerts/run",
              {
                method:
                  "POST",
                headers: {
                  "Content-Type":
                    "application/json"
                },
                body:
                  JSON.stringify(
                    {}
                  )
              }
            );

          const summary =
            result.summary ||
            {};

          setStatus(
            `Alert matcher checked ${
              summary.alertsChecked ||
              0
            } alerts, found ${
              summary.matchesFound ||
              0
            } matches, and sent ${
              summary.notificationsSent ||
              0
            } notifications.`,
            summary.errors
              ?.length
              ? "error"
              : "success"
          );

          await loadUsers();
        } catch (error) {
          setStatus(
            `Alert matcher failed: ${error.message}`,
            "error"
          );
        }
      }
    );

    document.getElementById(
      "usersFilterForm"
    )?.addEventListener(
      "submit",
      (event) => {
        event.preventDefault();

        usersState.search =
          document.getElementById(
            "usersSearch"
          )?.value
            ?.trim() ||
          "";

        usersState.status =
          document.getElementById(
            "usersStatus"
          )?.value ||
          "";

        usersState.verified =
          document.getElementById(
            "usersVerified"
          )?.value ||
          "";

        usersState.page =
          1;

        loadUsers();
      }
    );

    document.getElementById(
      "usersPrev"
    )?.addEventListener(
      "click",
      () => {
        if (
          usersState.page >
          1
        ) {
          usersState.page -=
            1;

          loadUsers();
        }
      }
    );

    document.getElementById(
      "usersNext"
    )?.addEventListener(
      "click",
      () => {
        if (
          usersState.page <
          usersState.totalPages
        ) {
          usersState.page +=
            1;

          loadUsers();
        }
      }
    );

    document
      .querySelectorAll(
        "[data-user-status-id]"
      )
      .forEach(
        (button) => {
          button.addEventListener(
            "click",
            async () => {
              try {
                const nextStatus =
                  button.dataset
                    .nextStatus;

                const label =
                  nextStatus ===
                  "disabled"
                    ? "disable"
                    : "re-enable";

                if (
                  !window.confirm(
                    `Are you sure you want to ${label} this user?`
                  )
                ) {
                  return;
                }

                await fetchJson(
                  `/api/admin/users/${encodeURIComponent(
                    button.dataset
                      .userStatusId
                  )}/status`,
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
                          nextStatus
                      })
                  }
                );

                setStatus(
                  "User status updated.",
                  "success"
                );

                await loadUsers();
              } catch (error) {
                setStatus(
                  `User update failed: ${error.message}`,
                  "error"
                );
              }
            }
          );
        }
      );
  }

  async function loadUsers() {
    currentView =
      "users";

    if (
      typeof setActiveNav ===
      "function"
    ) {
      setActiveNav(
        "users"
      );
    }

    pageTitle.textContent =
      "Users & Emails";

    pageSubtitle.textContent =
      "Manage consumer leads, accounts, preferences, and appointment-alert activity.";

    setLoading(
      "Loading users..."
    );

    try {
      const [
        data,
        activity
      ] =
        await Promise.all([
          fetchJson(
            `/api/admin/users?${buildUserQuery()}`
          ),
          fetchJson(
            "/api/admin/users/alerts/activity?limit=20"
          ).catch(
            () => ({
              stats: {}
            })
          )
        ]);

      renderUsers(
        data,
        activity
      );

      setStatus(
        `Loaded ${data.total || 0} users.`,
        "success"
      );
    } catch (error) {
      content.innerHTML = `
        <h3>
          Could Not Load Users
        </h3>
        <p>
          ${escapeHtml(
            error.message
          )}
        </p>
      `;

      setStatus(
        "Failed to load users.",
        "error"
      );
    }
  }

  ensureUsersStyles();
  ensureUsersNavButton();

  const originalLoadView =
    loadView;

  loadView =
    function patchedLoadView(
      viewName
    ) {
      if (
        viewName ===
        "users"
      ) {
        return loadUsers();
      }

      return originalLoadView(
        viewName
      );
    };
})();