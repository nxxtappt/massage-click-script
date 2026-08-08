(() => {
  const path = window.location.pathname;

  if (
    path.startsWith("/admin") ||
    path.startsWith("/business-dashboard") ||
    navigator.doNotTrack === "1"
  ) {
    return;
  }

  const VISITOR_KEY = "nextappt_analytics_visitor";
  const SESSION_KEY = "nextappt_analytics_session";
  const SESSION_TIMEOUT_MS = 30 * 60 * 1000;
  const HEARTBEAT_MS = 60 * 1000;

  function makeId() {
    if (window.crypto?.randomUUID) {
      return window.crypto.randomUUID().replaceAll("-", "");
    }

    return (
      Date.now().toString(36) +
      Math.random().toString(36).slice(2) +
      Math.random().toString(36).slice(2)
    );
  }

  function getVisitorId() {
    let id = localStorage.getItem(VISITOR_KEY);

    if (!id) {
      id = makeId();
      localStorage.setItem(VISITOR_KEY, id);
    }

    return id;
  }

  function readSession() {
    try {
      return JSON.parse(
        localStorage.getItem(SESSION_KEY) || "null"
      );
    } catch {
      return null;
    }
  }

  function getSession() {
    const now = Date.now();
    let session = readSession();

    if (
      !session?.id ||
      !session?.lastActivity ||
      now - Number(session.lastActivity) > SESSION_TIMEOUT_MS
    ) {
      session = {
        id: makeId(),
        lastActivity: now
      };
    } else {
      session.lastActivity = now;
    }

    localStorage.setItem(
      SESSION_KEY,
      JSON.stringify(session)
    );

    return session;
  }

  const visitorId = getVisitorId();
  let session = getSession();

  function touchSession() {
    session = {
      id: session.id,
      lastActivity: Date.now()
    };

    localStorage.setItem(
      SESSION_KEY,
      JSON.stringify(session)
    );
  }

  function getContext() {
    const businessMatch =
      window.location.pathname.match(
        /^\/business\/([^/?#]+)/
      );

    return {
      visitorId,
      sessionId: session.id,
      path: `${window.location.pathname}${window.location.search}`,
      title: document.title || "",
      referrer: document.referrer || "",
      businessSlug: businessMatch
        ? decodeURIComponent(businessMatch[1])
        : "",
      metro: document.body?.dataset?.metroSlug || "",
      categorySlug: document.body?.dataset?.categorySlug || ""
    };
  }

  function post(url, payload, beacon = false) {
    const body = JSON.stringify(payload);

    if (beacon && navigator.sendBeacon) {
      return navigator.sendBeacon(
        url,
        new Blob(
          [body],
          { type: "application/json" }
        )
      );
    }

    fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body,
      keepalive: true
    }).catch(() => {});

    return true;
  }

  function trackPageView() {
    touchSession();

    post(
      "/api/analytics/page-view",
      getContext()
    );
  }

  function sendHeartbeat(beacon = false) {
    if (
      !beacon &&
      document.visibilityState !== "visible"
    ) {
      return;
    }

    touchSession();

    const context = getContext();

    post(
      "/api/analytics/heartbeat",
      {
        visitorId: context.visitorId,
        sessionId: context.sessionId,
        path: context.path
      },
      beacon
    );
  }

  document.addEventListener(
    "click",
    (event) => {
      const link = event.target.closest(
        "[data-track-appointment-click='true']"
      );

      if (!link) {
        return;
      }

      try {
        const payload = JSON.parse(
          link.dataset.appointmentPayload || "{}"
        );

        payload.visitorId = visitorId;
        payload.sessionId = session.id;
        payload.pagePath =
          `${window.location.pathname}${window.location.search}`;

        link.dataset.appointmentPayload =
          JSON.stringify(payload);
      } catch {
        // Never interrupt a booking click because analytics enrichment failed.
      }
    },
    true
  );

  trackPageView();

  setInterval(
    () => sendHeartbeat(false),
    HEARTBEAT_MS
  );

  document.addEventListener(
    "visibilitychange",
    () => {
      if (document.visibilityState === "visible") {
        sendHeartbeat(false);
      }
    }
  );

  window.addEventListener(
    "pagehide",
    () => sendHeartbeat(true)
  );

  window.nextApptAnalytics = {
    getIds() {
      return {
        visitorId,
        sessionId: session.id
      };
    }
  };
})();