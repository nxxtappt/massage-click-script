(() => {
  if (
    typeof renderAnalyticsPanel !== "function" ||
    typeof renderDashboard !== "function" ||
    typeof fetchJson !== "function"
  ) {
    console.warn(
      "[BUSINESS ANALYTICS] Dashboard functions unavailable."
    );
    return;
  }

  function formatNumber(value) {
    return Number(value || 0).toLocaleString();
  }

  function formatDay(value) {
    if (!value) return "—";

    const date =
      new Date(`${value}T12:00:00`);

    if (Number.isNaN(date.getTime())) {
      return String(value);
    }

    return date.toLocaleDateString(
      "en-US",
      {
        month: "short",
        day: "numeric"
      }
    );
  }

  function rankedList(items, emptyText) {
    if (!Array.isArray(items) || !items.length) {
      return `
        <p style="color:#64748b;font-size:13px;">
          ${escapeHtml(emptyText)}
        </p>
      `;
    }

    return `
      <ul class="business-analytics-list">
        ${items
          .map(
            (item) => `
              <li>
                <span>
                  ${escapeHtml(item.label || "Unknown")}
                </span>

                <strong>
                  ${formatNumber(item.count)}
                </strong>
              </li>
            `
          )
          .join("")}
      </ul>
    `;
  }

  renderAnalyticsPanel = function upgradedAnalyticsPanel(
    dashboard
  ) {
    const analytics =
      dashboard.analytics || {};

    const days =
      Number(analytics.days || 30);

    const daily =
      Array.isArray(analytics.daily)
        ? analytics.daily
        : [];

    const trendDays =
      daily.slice(-30);

    const topServices =
      Array.isArray(analytics.topServices)
        ? analytics.topServices
        : [];

    const topTimes =
      Array.isArray(analytics.topAppointmentTimes)
        ? analytics.topAppointmentTimes
        : [];

    const recentClicks =
      Array.isArray(analytics.recentClicks)
        ? analytics.recentClicks
        : [];

    const maxClicks =
      Math.max(
        1,
        ...trendDays.map(
          (item) =>
            Number(item.clicks || 0)
        )
      );

    return `
      <div
        id="businessAnalyticsPanel"
        class="business-analytics-card"
      >
        <div class="business-analytics-header">
          <div>
            <h3>
              Customer Interest Analytics
            </h3>

            <p>
              Persistent appointment-click and public-profile activity.
            </p>
          </div>

          <label class="business-analytics-range">
            Time range
            <select id="businessAnalyticsDays">
              <option value="7" ${days === 7 ? "selected" : ""}>
                Last 7 days
              </option>
              <option value="30" ${days === 30 ? "selected" : ""}>
                Last 30 days
              </option>
              <option value="90" ${days === 90 ? "selected" : ""}>
                Last 90 days
              </option>
              <option value="365" ${days === 365 ? "selected" : ""}>
                Last year
              </option>
            </select>
          </label>
        </div>

        <div class="business-analytics-kpis">
          <div class="business-analytics-kpi">
            <strong>
              ${formatNumber(analytics.totalClicks)}
            </strong>
            <span>Appointment clicks</span>
          </div>

          <div class="business-analytics-kpi">
            <strong>
              ${formatNumber(analytics.profileViews)}
            </strong>
            <span>Public profile views</span>
          </div>

          <div class="business-analytics-kpi">
            <strong>
              ${formatNumber(analytics.allTimeClicks)}
            </strong>
            <span>Appointment clicks all time</span>
          </div>

          <div class="business-analytics-kpi">
            <strong>
              ${escapeHtml(
                analytics.averageClicksPerDay ?? 0
              )}
            </strong>
            <span>Avg. clicks per day</span>
          </div>
        </div>

        <div class="business-analytics-layout">
          <section class="business-analytics-section">
            <h4>Recent daily click trend</h4>

            ${
              trendDays.length
                ? `
                  <div class="business-analytics-trend">
                    ${trendDays
                      .map(
                        (item) => {
                          const count =
                            Number(item.clicks || 0);

                          const width =
                            Math.round(
                              (count / maxClicks) * 100
                            );

                          return `
                            <div class="business-analytics-trend-row">
                              <span>
                                ${escapeHtml(
                                  formatDay(item.day)
                                )}
                              </span>

                              <div class="business-analytics-track">
                                <div
                                  class="business-analytics-fill"
                                  style="width:${width}%;"
                                ></div>
                              </div>

                              <strong>
                                ${formatNumber(count)}
                              </strong>
                            </div>
                          `;
                        }
                      )
                      .join("")}
                  </div>
                `
                : `
                  <p style="color:#64748b;font-size:13px;">
                    No appointment-click history yet.
                  </p>
                `
            }
          </section>

          <section class="business-analytics-section">
            <h4>Top services</h4>
            ${rankedList(
              topServices,
              "No service click data yet."
            )}

            <h4 style="margin-top:20px;">
              Popular appointment times
            </h4>
            ${rankedList(
              topTimes,
              "No appointment-time data yet."
            )}
          </section>

          <section
            class="business-analytics-section"
            style="grid-column:1 / -1;"
          >
            <h4>Recent appointment clicks</h4>

            ${
              recentClicks.length
                ? `
                  <div style="overflow-x:auto;">
                    <table class="business-analytics-table">
                      <thead>
                        <tr>
                          <th>Clicked</th>
                          <th>Service</th>
                          <th>Duration</th>
                          <th>Appointment</th>
                          <th>Source</th>
                        </tr>
                      </thead>

                      <tbody>
                        ${recentClicks
                          .map(
                            (item) => `
                              <tr>
                                <td>
                                  ${escapeHtml(
                                    item.clickedAt
                                      ? new Date(
                                          item.clickedAt
                                        ).toLocaleString()
                                      : "—"
                                  )}
                                </td>

                                <td>
                                  ${escapeHtml(
                                    item.serviceName ||
                                    "Unknown"
                                  )}
                                </td>

                                <td>
                                  ${escapeHtml(
                                    item.durationMinutes
                                      ? `${item.durationMinutes} min`
                                      : "—"
                                  )}
                                </td>

                                <td>
                                  ${escapeHtml(
                                    [
                                      item.localDateKey ||
                                        item.appointmentDate,
                                      item.localTimeKey ||
                                        item.appointmentTime
                                    ]
                                      .filter(Boolean)
                                      .join(" ") ||
                                      "—"
                                  )}
                                </td>

                                <td>
                                  ${escapeHtml(
                                    item.sourcePage || "—"
                                  )}
                                </td>
                              </tr>
                            `
                          )
                          .join("")}
                      </tbody>
                    </table>
                  </div>
                `
                : `
                  <p style="color:#64748b;font-size:13px;">
                    No appointment clicks recorded yet.
                  </p>
                `
            }

            <p style="margin:12px 0 0;color:#64748b;font-size:12px;">
              ${
                analytics.trackingSince
                  ? `Persistent click history begins ${escapeHtml(
                      new Date(
                        analytics.trackingSince
                      ).toLocaleDateString()
                    )}.`
                  : "Persistent analytics will accumulate from this upgrade forward."
              }
            </p>
          </section>
        </div>
      </div>
    `;
  };

  async function refreshBusinessAnalytics(days) {
    try {
      setStatus(
        "Refreshing analytics...",
        "info"
      );

      const data =
        await fetchJson(
          `/api/business-dashboard/analytics?days=${encodeURIComponent(
            days
          )}`
        );

      const panel =
        document.getElementById(
          "businessAnalyticsPanel"
        );

      if (!panel) return;

      panel.outerHTML =
        renderAnalyticsPanel({
          analytics:
            data.analytics || {}
        });

      attachAnalyticsHandlers();

      setStatus(
        "Analytics updated.",
        "success"
      );
    } catch (error) {
      setStatus(
        `Analytics error: ${error.message}`,
        "error"
      );
    }
  }

  function attachAnalyticsHandlers() {
    document
      .getElementById("businessAnalyticsDays")
      ?.addEventListener(
        "change",
        (event) => {
          refreshBusinessAnalytics(
            Number(event.target.value)
          );
        }
      );
  }

  const originalRenderDashboard =
    renderDashboard;

  renderDashboard =
    function upgradedRenderDashboard(
      dashboard
    ) {
      originalRenderDashboard(
        dashboard
      );

      attachAnalyticsHandlers();
    };

  // The original dashboard script loads itself before this upgrade
  // script executes, so reload once to render the upgraded panel.
  if (getSessionToken()) {
    loadDashboard();
  }
})();