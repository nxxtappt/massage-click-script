(() => {
  let analyticsDays = 30;
  let refreshTimer = null;

  function ensureStyles() {
    if (document.getElementById("adminAnalyticsStyles")) return;

    const style = document.createElement("style");
    style.id = "adminAnalyticsStyles";
    style.textContent = `
      .site-analytics-toolbar {
        display:flex;
        justify-content:space-between;
        align-items:end;
        gap:12px;
        flex-wrap:wrap;
        margin-bottom:16px;
      }

      .site-analytics-toolbar label {
        display:flex;
        flex-direction:column;
        gap:5px;
        font-size:12px;
        font-weight:700;
        color:#475569;
      }

      .site-analytics-toolbar select {
        min-width:150px;
        padding:9px 10px;
        border:1px solid #cbd5e1;
        border-radius:9px;
        background:#fff;
      }

      .site-analytics-kpis {
        display:grid;
        grid-template-columns:repeat(4,minmax(130px,1fr));
        gap:12px;
        margin-bottom:18px;
      }

      .site-analytics-kpi {
        padding:15px;
        border:1px solid #e2e8f0;
        border-radius:13px;
        background:#f8fafc;
      }

      .site-analytics-kpi.live {
        border-color:#86efac;
        background:#f0fdf4;
      }

      .site-analytics-kpi strong {
        display:block;
        color:#0f172a;
        font-size:26px;
        line-height:1.1;
      }

      .site-analytics-kpi span {
        display:block;
        margin-top:5px;
        color:#64748b;
        font-size:12px;
      }

      .site-analytics-grid {
        display:grid;
        grid-template-columns:minmax(0,1.4fr) minmax(280px,.8fr);
        gap:16px;
      }

      .site-analytics-card {
        border:1px solid #e2e8f0;
        border-radius:13px;
        padding:15px;
        background:#fff;
      }

      .site-analytics-card h4 {
        margin:0 0 12px;
        color:#0f172a;
      }

      .site-trend {
        display:grid;
        gap:8px;
      }

      .site-trend-row {
        display:grid;
        grid-template-columns:82px minmax(80px,1fr) 48px;
        align-items:center;
        gap:9px;
        font-size:12px;
      }

      .site-trend-track {
        height:12px;
        background:#eef2f6;
        border-radius:999px;
        overflow:hidden;
      }

      .site-trend-fill {
        height:100%;
        min-width:2px;
        background:#006ca8;
        border-radius:999px;
      }

      .site-analytics-table {
        width:100%;
        border-collapse:collapse;
      }

      .site-analytics-table th,
      .site-analytics-table td {
        padding:8px 6px;
        border-bottom:1px solid #edf2f7;
        font-size:12px;
        text-align:left;
      }

      .site-analytics-table th {
        color:#64748b;
      }

      .site-live-dot {
        display:inline-block;
        width:8px;
        height:8px;
        border-radius:999px;
        background:#22c55e;
        margin-right:6px;
      }

      @media (max-width:1000px) {
        .site-analytics-kpis {
          grid-template-columns:repeat(2,1fr);
        }

        .site-analytics-grid {
          grid-template-columns:1fr;
        }
      }
    `;

    document.head.appendChild(style);
  }

  function ensureNav() {
    if (
      document.querySelector(
        ".nav-btn[data-view='siteAnalytics']"
      )
    ) {
      return;
    }

    const nav = document.querySelector(".nav");
    if (!nav) return;

    const button = document.createElement("button");
    button.type = "button";
    button.className = "nav-btn";
    button.dataset.view = "siteAnalytics";
    button.textContent = "Site Analytics";

    const settings =
      nav.querySelector(
        ".nav-btn[data-view='settings']"
      );

    if (settings) {
      nav.insertBefore(button, settings);
    } else {
      nav.appendChild(button);
    }

    if (typeof refreshNavButtons === "function") {
      refreshNavButtons();
    }

    button.addEventListener(
      "click",
      () => loadView("siteAnalytics")
    );
  }

  function formatNumber(value) {
    return Number(value || 0).toLocaleString();
  }

  function shortDate(value) {
    if (!value) return "";

    const date = new Date(`${value}T12:00:00`);

    return date.toLocaleDateString(
      "en-US",
      {
        month: "short",
        day: "numeric"
      }
    );
  }

  function tableRows(items, columns) {
    if (!Array.isArray(items) || !items.length) {
      return `
        <tr>
          <td colspan="${columns.length}">
            No data yet.
          </td>
        </tr>
      `;
    }

    return items
      .map(
        (item) => `
          <tr>
            ${columns
              .map((column) => {
                const value =
                  column.format
                    ? column.format(item[column.key])
                    : item[column.key] ?? "—";

                return `<td>${escapeHtml(value)}</td>`;
              })
              .join("")}
          </tr>
        `
      )
      .join("");
  }

  function renderAnalytics(data) {
    const analytics = data.analytics || {};
    const metrics = analytics.metrics || {};
    const daily = analytics.daily || [];

    const displayDaily =
      daily.length > 45
        ? daily.slice(-45)
        : daily;

    const maxVisits = Math.max(
      1,
      ...displayDaily.map(
        (item) => Number(item.visits || 0)
      )
    );

    content.innerHTML = `
      <div class="site-analytics-toolbar">
        <div>
          <h3 style="margin:0 0 5px;">
            Site Analytics
          </h3>

          <p style="margin:0;color:#64748b;">
            Visits, live visitors, page views, and appointment clicks stored in PostgreSQL.
          </p>
        </div>

        <label>
          Trend range
          <select id="siteAnalyticsDays">
            <option value="7" ${analyticsDays === 7 ? "selected" : ""}>Last 7 days</option>
            <option value="30" ${analyticsDays === 30 ? "selected" : ""}>Last 30 days</option>
            <option value="90" ${analyticsDays === 90 ? "selected" : ""}>Last 90 days</option>
            <option value="365" ${analyticsDays === 365 ? "selected" : ""}>Last year</option>
          </select>
        </label>
      </div>

      <div class="site-analytics-kpis">
        <div class="site-analytics-kpi live">
          <strong>
            <span class="site-live-dot"></span>
            ${formatNumber(metrics.liveVisitors)}
          </strong>
          <span>Visitors live now</span>
        </div>

        <div class="site-analytics-kpi">
          <strong>${formatNumber(metrics.visitsToday)}</strong>
          <span>Visits today</span>
        </div>

        <div class="site-analytics-kpi">
          <strong>${formatNumber(metrics.visits7Days)}</strong>
          <span>Visits last 7 days</span>
        </div>

        <div class="site-analytics-kpi">
          <strong>${formatNumber(metrics.visits30Days)}</strong>
          <span>Visits last 30 days</span>
        </div>

        <div class="site-analytics-kpi">
          <strong>${formatNumber(metrics.uniqueVisitors30Days)}</strong>
          <span>Unique visitors / 30 days</span>
        </div>

        <div class="site-analytics-kpi">
          <strong>${formatNumber(metrics.pageViews30Days)}</strong>
          <span>Page views / 30 days</span>
        </div>

        <div class="site-analytics-kpi">
          <strong>${formatNumber(metrics.appointmentClicks30Days)}</strong>
          <span>Appointment clicks / 30 days</span>
        </div>

        <div class="site-analytics-kpi">
          <strong>${formatNumber(metrics.allTimeVisits)}</strong>
          <span>Recorded visits all time</span>
        </div>
      </div>

      <div class="site-analytics-grid">
        <div class="site-analytics-card">
          <h4>Visits by day</h4>

          <div class="site-trend">
            ${displayDaily
              .map((item) => {
                const visits = Number(item.visits || 0);
                const width = Math.round(
                  (visits / maxVisits) * 100
                );

                return `
                  <div class="site-trend-row">
                    <span>${escapeHtml(shortDate(item.day))}</span>

                    <div class="site-trend-track">
                      <div
                        class="site-trend-fill"
                        style="width:${width}%;"
                      ></div>
                    </div>

                    <strong>${formatNumber(visits)}</strong>
                  </div>
                `;
              })
              .join("")}
          </div>
        </div>

        <div class="site-analytics-card">
          <h4>Live pages</h4>
          <table class="site-analytics-table">
            <thead>
              <tr>
                <th>Page</th>
                <th>Live</th>
              </tr>
            </thead>
            <tbody>
              ${tableRows(
                analytics.livePages,
                [
                  { key: "path" },
                  { key: "visitors", format: formatNumber }
                ]
              )}
            </tbody>
          </table>
        </div>

        <div class="site-analytics-card">
          <h4>Top pages</h4>
          <table class="site-analytics-table">
            <thead>
              <tr>
                <th>Page</th>
                <th>Views</th>
                <th>Visitors</th>
              </tr>
            </thead>
            <tbody>
              ${tableRows(
                analytics.topPages,
                [
                  { key: "path" },
                  { key: "views", format: formatNumber },
                  { key: "visitors", format: formatNumber }
                ]
              )}
            </tbody>
          </table>
        </div>

        <div class="site-analytics-card">
          <h4>Most-clicked businesses</h4>
          <table class="site-analytics-table">
            <thead>
              <tr>
                <th>Business</th>
                <th>Clicks</th>
              </tr>
            </thead>
            <tbody>
              ${tableRows(
                analytics.topBusinessClicks,
                [
                  { key: "businessName" },
                  { key: "clicks", format: formatNumber }
                ]
              )}
            </tbody>
          </table>
        </div>

        <div class="site-analytics-card">
          <h4>Referrers</h4>
          <table class="site-analytics-table">
            <thead>
              <tr>
                <th>Source</th>
                <th>Visits</th>
              </tr>
            </thead>
            <tbody>
              ${tableRows(
                analytics.topReferrers,
                [
                  { key: "referrer" },
                  { key: "visits", format: formatNumber }
                ]
              )}
            </tbody>
          </table>
        </div>
      </div>
    `;

    document
      .getElementById("siteAnalyticsDays")
      ?.addEventListener(
        "change",
        (event) => {
          analyticsDays = Number(event.target.value);
          loadSiteAnalytics();
        }
      );
  }

  async function loadSiteAnalytics() {
    currentView = "siteAnalytics";

    if (typeof setActiveNav === "function") {
      setActiveNav("siteAnalytics");
    }

    pageTitle.textContent = "Site Analytics";
    pageSubtitle.textContent =
      "Visits, live visitors, page views, and appointment clicks.";

    setLoading("Loading site analytics...");

    try {
      const data = await fetchJson(
        `/api/admin/analytics?days=${analyticsDays}`
      );

      renderAnalytics(data);
      setStatus("Analytics updated.", "success");
    } catch (error) {
      content.innerHTML = `
        <h3>Could Not Load Analytics</h3>
        <p>${escapeHtml(error.message)}</p>
      `;

      setStatus(
        "Analytics failed to load.",
        "error"
      );
    }

    if (refreshTimer) {
      clearInterval(refreshTimer);
    }

    refreshTimer = setInterval(
      () => {
        if (currentView === "siteAnalytics") {
          loadSiteAnalytics();
        }
      },
      30000
    );
  }

  ensureStyles();
  ensureNav();

  const originalLoadView = loadView;

  loadView = function patchedLoadView(viewName) {
    if (viewName === "siteAnalytics") {
      return loadSiteAnalytics();
    }

    return originalLoadView(viewName);
  };
})();