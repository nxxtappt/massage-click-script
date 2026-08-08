const db = require("../db");

const ANALYTICS_TIME_ZONE =
  process.env.ANALYTICS_TIME_ZONE ||
  "America/Chicago";

function cleanText(value, maxLength = 1000) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function cleanIdentifier(value, maxLength = 120) {
  const text = cleanText(value, maxLength);
  return text && /^[A-Za-z0-9_-]+$/.test(text) ? text : "";
}

function clampDays(value, fallback = 30) {
  const parsed = Number.parseInt(value, 10);
  return [7, 30, 90, 365].includes(parsed) ? parsed : fallback;
}

function clampLimit(value, fallback = 100, max = 1000) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(max, parsed));
}

function nullableInteger(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function dateOrNull(value) {
  const text = cleanText(value, 20);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

function timeOrNull(value) {
  const match = cleanText(value, 20).match(/^(\d{1,2}):(\d{2})/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00`;
}

async function trackPageView(payload = {}, requestMeta = {}) {
  const visitorId = cleanIdentifier(payload.visitorId);
  const sessionId = cleanIdentifier(payload.sessionId);
  if (!visitorId || !sessionId) {
    throw new Error("Valid visitorId and sessionId are required.");
  }

  const path = cleanText(payload.path || "/", 500) || "/";
  const title = cleanText(payload.title, 300) || null;
  const referrer = cleanText(payload.referrer || requestMeta.referrer, 1000) || null;
  const userAgent = cleanText(requestMeta.userAgent, 1000) || null;
  const businessSlug = cleanText(payload.businessSlug, 180) || null;
  const metro = cleanText(payload.metro, 120) || null;
  const categorySlug = cleanText(payload.categorySlug, 120) || null;

  const client = await db.connect();
  try {
    await client.query("BEGIN");

    await client.query(
      `INSERT INTO analytics_visitors (
         visitor_id, first_path, first_referrer, user_agent
       )
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (visitor_id)
       DO UPDATE SET
         last_seen_at = NOW(),
         user_agent = COALESCE(analytics_visitors.user_agent, EXCLUDED.user_agent)`,
      [visitorId, path, referrer, userAgent]
    );

    await client.query(
      `INSERT INTO analytics_sessions (
         session_id, visitor_id, current_path, referrer, user_agent, page_view_count
       )
       VALUES ($1, $2, $3, $4, $5, 1)
       ON CONFLICT (session_id)
       DO UPDATE SET
         last_seen_at = NOW(),
         current_path = EXCLUDED.current_path,
         page_view_count = analytics_sessions.page_view_count + 1`,
      [sessionId, visitorId, path, referrer, userAgent]
    );

    const result = await client.query(
      `INSERT INTO analytics_page_views (
         visitor_id, session_id, path, title, referrer,
         business_slug, metro, category_slug
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING id, viewed_at AS "viewedAt"`,
      [visitorId, sessionId, path, title, referrer, businessSlug, metro, categorySlug]
    );

    await client.query("COMMIT");
    return result.rows[0];
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function heartbeat(payload = {}, requestMeta = {}) {
  const visitorId = cleanIdentifier(payload.visitorId);
  const sessionId = cleanIdentifier(payload.sessionId);
  if (!visitorId || !sessionId) {
    throw new Error("Valid visitorId and sessionId are required.");
  }

  const path = cleanText(payload.path || "/", 500) || "/";
  const userAgent = cleanText(requestMeta.userAgent, 1000) || null;

  await db.query(
    `INSERT INTO analytics_visitors (visitor_id, first_path, user_agent)
     VALUES ($1,$2,$3)
     ON CONFLICT (visitor_id)
     DO UPDATE SET last_seen_at = NOW()`,
    [visitorId, path, userAgent]
  );

  await db.query(
    `INSERT INTO analytics_sessions (
       session_id, visitor_id, current_path, user_agent, page_view_count
     )
     VALUES ($1,$2,$3,$4,0)
     ON CONFLICT (session_id)
     DO UPDATE SET
       last_seen_at = NOW(),
       current_path = EXCLUDED.current_path`,
    [sessionId, visitorId, path, userAgent]
  );

  return { success: true };
}

async function logAppointmentClick(payload = {}, requestMeta = {}) {
  const result = await db.query(
    `INSERT INTO analytics_appointment_clicks (
       legacy_id, visitor_id, session_id, clicked_at,
       business_name, business_slug, platform, service_name,
       service_category, duration_minutes, therapist_name,
       appointment_date, appointment_time, start_time,
       local_date_key, local_time_key, booking_url,
       source_page, page_path, referrer
     )
     VALUES (
       $1,$2,$3,COALESCE($4::timestamptz,NOW()),
       $5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20
     )
     ON CONFLICT (legacy_id) DO NOTHING
     RETURNING
       id,
       clicked_at AS "clickedAt",
       business_name AS "businessName",
       service_name AS "serviceName",
       duration_minutes AS "durationMinutes"`,
    [
      cleanText(payload.legacyId || payload.id, 180) || null,
      cleanIdentifier(payload.visitorId) || null,
      cleanIdentifier(payload.sessionId) || null,
      payload.clickedAt ? cleanText(payload.clickedAt, 80) : null,
      cleanText(payload.businessName, 300) || null,
      cleanText(payload.businessSlug, 180) || null,
      cleanText(payload.platform, 120) || null,
      cleanText(payload.serviceName, 300) || null,
      cleanText(payload.serviceCategory, 180) || null,
      nullableInteger(payload.durationMinutes),
      cleanText(payload.therapistName || payload.providerName, 240) || null,
      cleanText(payload.appointmentDate, 100) || null,
      cleanText(payload.appointmentTime, 100) || null,
      cleanText(payload.startTime, 180) || null,
      dateOrNull(payload.localDateKey),
      timeOrNull(payload.localTimeKey),
      cleanText(payload.bookingUrl, 2000) || null,
      cleanText(payload.sourcePage, 180) || null,
      cleanText(payload.pagePath, 500) || null,
      cleanText(payload.referrer || requestMeta.referrer, 1000) || null
    ]
  );

  return result.rows[0] || { duplicate: true };
}

async function getAppointmentClicks(filters = {}) {
  const days = clampDays(filters.days, 30);
  const limit = clampLimit(filters.limit, 100, 1000);
  const businessName = cleanText(filters.businessName, 300);

  const result = await db.query(
    `SELECT
       id,
       clicked_at AS "clickedAt",
       business_name AS "businessName",
       business_slug AS "businessSlug",
       platform,
       service_name AS "serviceName",
       service_category AS "serviceCategory",
       duration_minutes AS "durationMinutes",
       therapist_name AS "therapistName",
       appointment_date AS "appointmentDate",
       appointment_time AS "appointmentTime",
       start_time AS "startTime",
       local_date_key::text AS "localDateKey",
       local_time_key::text AS "localTimeKey",
       booking_url AS "bookingUrl",
       source_page AS "sourcePage",
       page_path AS "pagePath"
     FROM analytics_appointment_clicks
     WHERE clicked_at >= NOW() - ($1::text || ' days')::interval
       AND ($2 = '' OR business_name = $2)
     ORDER BY clicked_at DESC
     LIMIT $3`,
    [days, businessName, limit]
  );

  return result.rows;
}

async function getAdminSiteAnalytics(options = {}) {
  const days = clampDays(options.days, 30);
  const timeZone = cleanText(options.timeZone || ANALYTICS_TIME_ZONE, 120);

  const [metrics, daily, topPages, topBusinessClicks, livePages, topReferrers] =
    await Promise.all([
      db.query(
        `WITH boundaries AS (
           SELECT
             (date_trunc('day', NOW() AT TIME ZONE $1) AT TIME ZONE $1) AS today_start
         )
         SELECT
           (SELECT COUNT(DISTINCT visitor_id)::int
            FROM analytics_sessions
            WHERE last_seen_at >= NOW() - INTERVAL '5 minutes') AS "liveVisitors",
           (SELECT COUNT(*)::int
            FROM analytics_sessions, boundaries
            WHERE started_at >= boundaries.today_start) AS "visitsToday",
           (SELECT COUNT(*)::int
            FROM analytics_sessions
            WHERE started_at >= NOW() - INTERVAL '7 days') AS "visits7Days",
           (SELECT COUNT(*)::int
            FROM analytics_sessions
            WHERE started_at >= NOW() - INTERVAL '30 days') AS "visits30Days",
           (SELECT COUNT(DISTINCT visitor_id)::int
            FROM analytics_sessions
            WHERE started_at >= NOW() - INTERVAL '30 days') AS "uniqueVisitors30Days",
           (SELECT COUNT(*)::int
            FROM analytics_page_views
            WHERE viewed_at >= NOW() - INTERVAL '30 days') AS "pageViews30Days",
           (SELECT COUNT(*)::int
            FROM analytics_appointment_clicks
            WHERE clicked_at >= NOW() - INTERVAL '30 days') AS "appointmentClicks30Days",
           (SELECT COUNT(*)::int FROM analytics_sessions) AS "allTimeVisits",
           (SELECT COUNT(*)::int FROM analytics_page_views) AS "allTimePageViews",
           (SELECT COUNT(*)::int FROM analytics_appointment_clicks) AS "allTimeAppointmentClicks"`,
        [timeZone]
      ),
      db.query(
        `WITH date_range AS (
           SELECT generate_series(
             (NOW() AT TIME ZONE $2)::date - ($1::int - 1),
             (NOW() AT TIME ZONE $2)::date,
             INTERVAL '1 day'
           )::date AS day
         ),
         session_counts AS (
           SELECT
             (started_at AT TIME ZONE $2)::date AS day,
             COUNT(*)::int AS visits,
             COUNT(DISTINCT visitor_id)::int AS visitors
           FROM analytics_sessions
           WHERE started_at >= NOW() - ($1::text || ' days')::interval
           GROUP BY 1
         ),
         view_counts AS (
           SELECT
             (viewed_at AT TIME ZONE $2)::date AS day,
             COUNT(*)::int AS page_views
           FROM analytics_page_views
           WHERE viewed_at >= NOW() - ($1::text || ' days')::interval
           GROUP BY 1
         ),
         click_counts AS (
           SELECT
             (clicked_at AT TIME ZONE $2)::date AS day,
             COUNT(*)::int AS clicks
           FROM analytics_appointment_clicks
           WHERE clicked_at >= NOW() - ($1::text || ' days')::interval
           GROUP BY 1
         )
         SELECT
           d.day::text AS day,
           COALESCE(s.visits,0)::int AS visits,
           COALESCE(s.visitors,0)::int AS visitors,
           COALESCE(v.page_views,0)::int AS "pageViews",
           COALESCE(c.clicks,0)::int AS clicks
         FROM date_range d
         LEFT JOIN session_counts s ON s.day = d.day
         LEFT JOIN view_counts v ON v.day = d.day
         LEFT JOIN click_counts c ON c.day = d.day
         ORDER BY d.day ASC`,
        [days, timeZone]
      ),
      db.query(
        `SELECT
           path,
           COUNT(*)::int AS views,
           COUNT(DISTINCT visitor_id)::int AS visitors
         FROM analytics_page_views
         WHERE viewed_at >= NOW() - ($1::text || ' days')::interval
         GROUP BY path
         ORDER BY views DESC
         LIMIT 12`,
        [days]
      ),
      db.query(
        `SELECT
           COALESCE(business_name,'Unknown') AS "businessName",
           COUNT(*)::int AS clicks
         FROM analytics_appointment_clicks
         WHERE clicked_at >= NOW() - ($1::text || ' days')::interval
         GROUP BY COALESCE(business_name,'Unknown')
         ORDER BY clicks DESC
         LIMIT 12`,
        [days]
      ),
      db.query(
        `SELECT
           COALESCE(current_path,'/') AS path,
           COUNT(DISTINCT visitor_id)::int AS visitors
         FROM analytics_sessions
         WHERE last_seen_at >= NOW() - INTERVAL '5 minutes'
         GROUP BY COALESCE(current_path,'/')
         ORDER BY visitors DESC
         LIMIT 12`
      ),
      db.query(
        `SELECT
           CASE
             WHEN referrer IS NULL OR referrer = '' THEN 'Direct / unknown'
             ELSE referrer
           END AS referrer,
           COUNT(*)::int AS visits
         FROM analytics_sessions
         WHERE started_at >= NOW() - ($1::text || ' days')::interval
         GROUP BY 1
         ORDER BY visits DESC
         LIMIT 10`,
        [days]
      )
    ]);

  return {
    days,
    timeZone,
    metrics: metrics.rows[0] || {},
    daily: daily.rows,
    topPages: topPages.rows,
    topBusinessClicks: topBusinessClicks.rows,
    livePages: livePages.rows,
    topReferrers: topReferrers.rows
  };
}

async function getBusinessAnalytics(businessName, options = {}) {
  const days = clampDays(options.days, 30);
  const timeZone = cleanText(options.timeZone || ANALYTICS_TIME_ZONE, 120);
  const name = cleanText(businessName, 300);
  const slug = cleanText(options.businessSlug, 180);

  if (!name) {
    return {
      days,
      totalClicks: 0,
      allTimeClicks: 0,
      profileViews: 0,
      allTimeProfileViews: 0,
      averageClicksPerDay: 0,
      trackingSince: null,
      daily: [],
      topServices: [],
      topAppointmentTimes: [],
      topSourcePages: [],
      recentClicks: []
    };
  }

  const [metric, daily, services, times, sources, recent] =
    await Promise.all([
      db.query(
        `SELECT
           (SELECT COUNT(*)::int
            FROM analytics_appointment_clicks
            WHERE business_name = $1
              AND clicked_at >= NOW() - ($3::text || ' days')::interval) AS "totalClicks",
           (SELECT COUNT(*)::int
            FROM analytics_appointment_clicks
            WHERE business_name = $1) AS "allTimeClicks",
           (SELECT COUNT(*)::int
            FROM analytics_page_views
            WHERE $2 <> ''
              AND business_slug = $2
              AND viewed_at >= NOW() - ($3::text || ' days')::interval) AS "profileViews",
           (SELECT COUNT(*)::int
            FROM analytics_page_views
            WHERE $2 <> ''
              AND business_slug = $2) AS "allTimeProfileViews",
           (SELECT MIN(clicked_at)
            FROM analytics_appointment_clicks
            WHERE business_name = $1) AS "trackingSince"`,
        [name, slug, days]
      ),
      db.query(
        `WITH date_range AS (
           SELECT generate_series(
             (NOW() AT TIME ZONE $4)::date - ($3::int - 1),
             (NOW() AT TIME ZONE $4)::date,
             INTERVAL '1 day'
           )::date AS day
         ),
         clicks AS (
           SELECT
             (clicked_at AT TIME ZONE $4)::date AS day,
             COUNT(*)::int AS clicks
           FROM analytics_appointment_clicks
           WHERE business_name = $1
             AND clicked_at >= NOW() - ($3::text || ' days')::interval
           GROUP BY 1
         ),
         views AS (
           SELECT
             (viewed_at AT TIME ZONE $4)::date AS day,
             COUNT(*)::int AS views
           FROM analytics_page_views
           WHERE $2 <> ''
             AND business_slug = $2
             AND viewed_at >= NOW() - ($3::text || ' days')::interval
           GROUP BY 1
         )
         SELECT
           d.day::text AS day,
           COALESCE(c.clicks,0)::int AS clicks,
           COALESCE(v.views,0)::int AS "profileViews"
         FROM date_range d
         LEFT JOIN clicks c ON c.day = d.day
         LEFT JOIN views v ON v.day = d.day
         ORDER BY d.day ASC`,
        [name, slug, days, timeZone]
      ),
      db.query(
        `SELECT
           COALESCE(service_name,service_category,'Unknown service') AS label,
           COUNT(*)::int AS count
         FROM analytics_appointment_clicks
         WHERE business_name = $1
           AND clicked_at >= NOW() - ($2::text || ' days')::interval
         GROUP BY 1
         ORDER BY count DESC
         LIMIT 8`,
        [name, days]
      ),
      db.query(
        `SELECT
           COALESCE(TO_CHAR(local_time_key,'HH12:MI AM'),appointment_time,'Unknown') AS label,
           COUNT(*)::int AS count
         FROM analytics_appointment_clicks
         WHERE business_name = $1
           AND clicked_at >= NOW() - ($2::text || ' days')::interval
         GROUP BY 1
         ORDER BY count DESC
         LIMIT 8`,
        [name, days]
      ),
      db.query(
        `SELECT COALESCE(source_page,'unknown') AS label, COUNT(*)::int AS count
         FROM analytics_appointment_clicks
         WHERE business_name = $1
           AND clicked_at >= NOW() - ($2::text || ' days')::interval
         GROUP BY 1
         ORDER BY count DESC
         LIMIT 8`,
        [name, days]
      ),
      db.query(
        `SELECT
           clicked_at AS "clickedAt",
           service_name AS "serviceName",
           duration_minutes AS "durationMinutes",
           appointment_date AS "appointmentDate",
           appointment_time AS "appointmentTime",
           local_date_key::text AS "localDateKey",
           local_time_key::text AS "localTimeKey",
           source_page AS "sourcePage"
         FROM analytics_appointment_clicks
         WHERE business_name = $1
         ORDER BY clicked_at DESC
         LIMIT 10`,
        [name]
      )
    ]);

  const metrics = metric.rows[0] || {};
  const totalClicks = Number(metrics.totalClicks || 0);

  return {
    days,
    timeZone,
    totalClicks,
    allTimeClicks: Number(metrics.allTimeClicks || 0),
    profileViews: Number(metrics.profileViews || 0),
    allTimeProfileViews: Number(metrics.allTimeProfileViews || 0),
    averageClicksPerDay: Number((totalClicks / days).toFixed(1)),
    trackingSince: metrics.trackingSince || null,
    daily: daily.rows,
    topServices: services.rows,
    topAppointmentTimes: times.rows,
    topSourcePages: sources.rows,
    recentClicks: recent.rows
  };
}

async function getCitywideClickSummary(options = {}) {
  const days = clampDays(options.days, 30);
  const result = await db.query(
    `SELECT
       COUNT(*)::int AS "totalClicks",
       COUNT(DISTINCT business_name)::int AS "businessesClicked"
     FROM analytics_appointment_clicks
     WHERE clicked_at >= NOW() - ($1::text || ' days')::interval`,
    [days]
  );
  return { days, ...(result.rows[0] || { totalClicks: 0, businessesClicked: 0 }) };
}

module.exports = {
  ANALYTICS_TIME_ZONE,
  clampDays,
  trackPageView,
  heartbeat,
  logAppointmentClick,
  getAppointmentClicks,
  getAdminSiteAnalytics,
  getBusinessAnalytics,
  getCitywideClickSummary
};