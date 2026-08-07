const crypto = require("crypto");
const inventoryManager = require("./inventoryManager");
const {
  matchesMarketplaceMetro,
  getMarketplaceTimeZone
} = require("./marketplaceMetros");
const userAlertRepository = require("./database/userAlertRepository");
const {
  sendAppointmentAlertEmail
} = require("./emailManager");

const DEFAULT_INTERVAL_SECONDS = 120;
const DEFAULT_MAX_ALERTS_PER_RUN = 250;
const DEFAULT_MAX_EMAIL_MATCHES = 3;

let intervalHandle = null;
let initialHandle = null;
let localRunInProgress = false;

function normalizeText(value = "") {
  return String(value || "")
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function dateKey(value) {
  if (!value) return "";

  const match = String(value).match(
    /^(\d{4}-\d{2}-\d{2})/
  );

  return match ? match[1] : "";
}

function timeKey(value) {
  if (!value) return "";

  const match = String(value).match(
    /^(\d{1,2}):(\d{2})/
  );

  if (!match) return "";

  return `${String(match[1]).padStart(
    2,
    "0"
  )}:${match[2]}`;
}

function currentDateKey(
  timezone = "America/Chicago"
) {
  const parts =
    new Intl.DateTimeFormat(
      "en-CA",
      {
        timeZone: timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
      }
    ).formatToParts(
      new Date()
    );

  const map =
    Object.fromEntries(
      parts
        .filter(
          (part) =>
            part.type !==
            "literal"
        )
        .map(
          (part) => [
            part.type,
            part.value
          ]
        )
    );

  return `${map.year}-${map.month}-${map.day}`;
}

function degreesToRadians(value) {
  return (
    Number(value) *
    Math.PI /
    180
  );
}

function distanceMiles(
  lat1,
  lon1,
  lat2,
  lon2
) {
  const values = [
    lat1,
    lon1,
    lat2,
    lon2
  ].map(Number);

  if (
    !values.every(
      Number.isFinite
    )
  ) {
    return null;
  }

  const [
    aLat,
    aLon,
    bLat,
    bLon
  ] = values;

  const earthRadiusMiles =
    3958.7613;

  const dLat =
    degreesToRadians(
      bLat - aLat
    );

  const dLon =
    degreesToRadians(
      bLon - aLon
    );

  const sinLat =
    Math.sin(dLat / 2);

  const sinLon =
    Math.sin(dLon / 2);

  const a =
    sinLat * sinLat +
    Math.cos(
      degreesToRadians(
        aLat
      )
    ) *
      Math.cos(
        degreesToRadians(
          bLat
        )
      ) *
      sinLon *
      sinLon;

  const c =
    2 *
    Math.atan2(
      Math.sqrt(a),
      Math.sqrt(1 - a)
    );

  return (
    earthRadiusMiles *
    c
  );
}

function serviceMatches(
  alert,
  appointment
) {
  const requested =
    normalizeText(
      alert.serviceType
    );

  if (!requested) {
    return true;
  }

  if (
    requested ===
    "massage"
  ) {
    if (
      normalizeText(
        appointment.categorySlug
      ) === "massage"
    ) {
      return true;
    }

    const broadText =
      normalizeText(
        [
          appointment.serviceName,
          appointment.serviceCategory,
          appointment.serviceType
        ]
          .filter(Boolean)
          .join(" ")
      );

    return broadText.includes(
      "massage"
    );
  }

  const text =
    normalizeText(
      [
        appointment.serviceName,
        appointment.serviceCategory,
        appointment.serviceType
      ]
        .filter(Boolean)
        .join(" ")
    );

  const requestedWords =
    requested
      .split(" ")
      .filter(
        (word) =>
          word.length > 2
      );

  return requestedWords.length
    ? requestedWords.every(
        (word) =>
          text.includes(word)
      )
    : text.includes(
        requested
      );
}

function appointmentMatchesAlert(
  alert,
  appointment
) {
  const appointmentDate =
    dateKey(
      appointment.localDateKey ||
      appointment.localDate
    );

  const appointmentTime =
    timeKey(
      appointment.localTimeKey ||
      appointment.localTime
    );

  const startDate =
    dateKey(
      alert.targetDate
    );

  const endDate =
    dateKey(
      alert.targetDateEnd
    ) ||
    startDate;

  const startTime =
    timeKey(
      alert.startTime
    );

  const endTime =
    timeKey(
      alert.endTime
    );

  if (
    startDate &&
    (
      !appointmentDate ||
      appointmentDate <
        startDate
    )
  ) {
    return false;
  }

  if (
    endDate &&
    (
      !appointmentDate ||
      appointmentDate >
        endDate
    )
  ) {
    return false;
  }

  if (
    startTime &&
    (
      !appointmentTime ||
      appointmentTime <
        startTime
    )
  ) {
    return false;
  }

  if (
    endTime &&
    (
      !appointmentTime ||
      appointmentTime >
        endTime
    )
  ) {
    return false;
  }

  if (
    alert.metro &&
    !matchesMarketplaceMetro(
      appointment,
      alert.metro
    )
  ) {
    return false;
  }

  if (
    alert.categorySlug &&
    normalizeText(
      appointment.categorySlug
    ) !==
      normalizeText(
        alert.categorySlug
      )
  ) {
    return false;
  }

  if (
    alert.durationMinutes &&
    Number(
      appointment.durationMinutes
    ) !==
      Number(
        alert.durationMinutes
      )
  ) {
    return false;
  }

  if (
    alert.businessName &&
    normalizeText(
      appointment.businessName
    ) !==
      normalizeText(
        alert.businessName
      )
  ) {
    return false;
  }

  if (
    alert.providerName &&
    !normalizeText(
      appointment.providerName
    ).includes(
      normalizeText(
        alert.providerName
      )
    )
  ) {
    return false;
  }

  if (
    !serviceMatches(
      alert,
      appointment
    )
  ) {
    return false;
  }

  if (
    alert.filters
      ?.includeInferred ===
      false &&
    appointment.sourceType ===
      "inferred"
  ) {
    return false;
  }

  if (
    alert.radiusMiles &&
    alert.latitude != null &&
    alert.longitude != null
  ) {
    const miles =
      distanceMiles(
        alert.latitude,
        alert.longitude,
        appointment.latitude,
        appointment.longitude
      );

    if (
      miles === null ||
      miles >
        Number(
          alert.radiusMiles
        )
    ) {
      return false;
    }
  }

  return true;
}

function appointmentFingerprint(
  appointment = {}
) {
  const stable =
    [
      appointment.businessName,
      appointment.serviceName ||
        appointment.service,
      appointment.serviceCategory ||
        appointment.serviceType,
      appointment.durationMinutes,
      appointment.providerName ||
        appointment.therapistName,
      dateKey(
        appointment.localDateKey ||
        appointment.localDate
      ),
      timeKey(
        appointment.localTimeKey ||
        appointment.localTime
      )
    ]
      .map(
        (value) =>
          normalizeText(value)
      )
      .join("||");

  return crypto
    .createHash("sha256")
    .update(stable)
    .digest("hex");
}

function alertHasExpired(
  alert
) {
  const finalDate =
    dateKey(
      alert.targetDateEnd
    ) ||
    dateKey(
      alert.targetDate
    );

  if (!finalDate) {
    return false;
  }

  const timezone =
    getMarketplaceTimeZone(
      alert.metro
    );

  return (
    finalDate <
    currentDateKey(
      timezone
    )
  );
}

async function getMatchesForAlert(
  alert
) {
  const inventory =
    await inventoryManager
      .getInventory({
        businessName:
          alert.businessName ||
          "",
        categorySlug:
          alert.categorySlug ||
          "",
        durationMinutes:
          alert.durationMinutes ||
          null,
        includeInferred:
          alert.filters
            ?.includeInferred !==
          false,
        includeConfirmed: true,
        includeInactive: false,
        showPast: false,
        limit: 10000
      });

  return inventory.filter(
    (appointment) =>
      appointmentMatchesAlert(
        alert,
        appointment
      )
  );
}

async function processAlert(
  alert,
  options = {}
) {
  if (
    alertHasExpired(
      alert
    )
  ) {
    await userAlertRepository
      .markAlertExpired(
        alert.id
      );

    return {
      alertId: alert.id,
      expired: true,
      matches: 0,
      notified: 0
    };
  }

  try {
    const deliverySettings =
      options.deliverySettings ||
      await userAlertRepository.getDeliverySettings();

    const deliveryState =
      await userAlertRepository.getAlertDeliveryState(
        alert.id
      );

    const deliveryDecision =
      userAlertRepository.evaluateDeliveryLimit(
        deliverySettings,
        deliveryState
      );

    if (!deliveryDecision.allowed) {
      return {
        alertId: alert.id,
        matches: 0,
        notified: 0,
        deliverySuppressed: true,
        reason: deliveryDecision.reason
      };
    }

    const matches =
      await getMatchesForAlert(
        alert
      );

    const maxEmailMatches =
      Math.max(
        1,
        Math.min(
          20,
          Number(
            options.maxEmailMatches ||
            deliverySettings.maxAppointmentsPerEmail ||
            DEFAULT_MAX_EMAIL_MATCHES
          )
        )
      );

    const claimed = [];

    for (
      const appointment
      of matches
    ) {
      if (
        claimed.length >=
        maxEmailMatches
      ) {
        break;
      }

      const notification =
        await userAlertRepository
          .reserveNotification({
            alert,
            appointment,
            appointmentKey:
              appointmentFingerprint(
                appointment
              )
          });

      if (notification) {
        claimed.push({
          notification,
          appointment
        });
      }
    }

    if (!claimed.length) {
      await userAlertRepository
        .markAlertChecked(
          alert.id,
          {
            matchCount:
              matches.length,
            notified: false
          }
        );

      return {
        alertId: alert.id,
        matches:
          matches.length,
        notified: 0
      };
    }

    const ids =
      claimed.map(
        (item) =>
          item.notification.id
      );

    try {
      const emailResult =
        await sendAppointmentAlertEmail({
          to: alert.email,
          firstName:
            alert.firstName,
          alert,
          matches:
            claimed.map(
              (item) =>
                item.appointment
            )
        });

      const emailMessageId =
        emailResult?.id ||
        emailResult?.data?.id ||
        null;

      await userAlertRepository
        .markNotificationsSent(
          ids,
          emailMessageId
        );

      await userAlertRepository
        .markAlertChecked(
          alert.id,
          {
            matchCount:
              matches.length,
            notified: true
          }
        );

      return {
        alertId: alert.id,
        matches:
          matches.length,
        notified:
          claimed.length,
        emailMessageId
      };
    } catch (error) {
      await userAlertRepository
        .markNotificationsFailed(
          ids,
          error
        );

      await userAlertRepository
        .markAlertChecked(
          alert.id,
          {
            matchCount:
              matches.length,
            notified: false,
            error
          }
        );

      throw error;
    }
  } catch (error) {
    await userAlertRepository
      .markAlertChecked(
        alert.id,
        {
          matchCount: 0,
          notified: false,
          error
        }
      )
      .catch(() => {});

    throw error;
  }
}

async function runUserAlertMatcher(
  options = {}
) {
  if (
    localRunInProgress
  ) {
    return {
      success: true,
      skipped: true,
      reason:
        "local_run_in_progress"
    };
  }

  localRunInProgress =
    true;

  let lockClient = null;

  const summary = {
    success: true,
    trigger:
      options.trigger ||
      "scheduled",
    alertsChecked: 0,
    alertsExpired: 0,
    matchesFound: 0,
    notificationsSent: 0,
    errors: []
  };

  try {
    const deliverySettings =
      await userAlertRepository.getDeliverySettings();

    if (!deliverySettings.emailsEnabled) {
      return {
        ...summary,
        skipped: true,
        reason: "global_email_kill_switch",
        deliverySettings
      };
    }

    lockClient =
      await userAlertRepository
        .acquireMatcherLock();

    if (!lockClient) {
      return {
        ...summary,
        skipped: true,
        reason:
          "another_matcher_holds_lock"
      };
    }

    const alerts =
      await userAlertRepository
        .listActiveAlertsForMatching({
          limit:
            options.maxAlerts ||
            DEFAULT_MAX_ALERTS_PER_RUN,
          alertId:
            options.alertId ||
            null
        });

    for (
      const alert
      of alerts
    ) {
      try {
        const result =
          await processAlert(
            alert,
            {
              ...options,
              deliverySettings
            }
          );

        summary.alertsChecked +=
          1;

        summary.matchesFound +=
          Number(
            result.matches ||
            0
          );

        summary.notificationsSent +=
          Number(
            result.notified ||
            0
          );

        if (
          result.expired
        ) {
          summary.alertsExpired +=
            1;
        }
      } catch (error) {
        summary.alertsChecked +=
          1;

        summary.errors.push({
          alertId:
            alert.id,
          error:
            error.message
        });

        console.error(
          `[USER ALERT MATCHER] Alert ${alert.id} failed:`,
          error
        );
      }
    }

    return summary;
  } finally {
    await userAlertRepository
      .releaseMatcherLock(
        lockClient
      )
      .catch(
        (error) => {
          console.error(
            "[USER ALERT MATCHER] Failed to release advisory lock:",
            error
          );
        }
      );

    localRunInProgress =
      false;
  }
}

function startUserAlertMatcher() {
  if (
    String(
      process.env
        .USER_ALERT_MATCHING_ENABLED ||
      "true"
    ).toLowerCase() ===
    "false"
  ) {
    console.log(
      "[USER ALERT MATCHER] Disabled by USER_ALERT_MATCHING_ENABLED=false"
    );
    return;
  }

  if (
    intervalHandle ||
    initialHandle
  ) {
    return;
  }

  const intervalSeconds =
    Math.max(
      60,
      Number(
        process.env
          .USER_ALERT_POLL_INTERVAL_SECONDS ||
        DEFAULT_INTERVAL_SECONDS
      ) ||
        DEFAULT_INTERVAL_SECONDS
    );

  const run = () => {
    runUserAlertMatcher({
      trigger:
        "scheduled"
    })
      .then(
        (summary) => {
          if (
            !summary.skipped &&
            (
              summary.notificationsSent ||
              summary.errors
                ?.length
            )
          ) {
            console.log(
              "[USER ALERT MATCHER]",
              summary
            );
          }
        }
      )
      .catch(
        (error) => {
          console.error(
            "[USER ALERT MATCHER] Run failed:",
            error
          );
        }
      );
  };

  initialHandle =
    setTimeout(
      () => {
        initialHandle =
          null;

        run();
      },
      15000
    );

  intervalHandle =
    setInterval(
      run,
      intervalSeconds *
        1000
    );

  if (
    typeof initialHandle
      .unref ===
    "function"
  ) {
    initialHandle.unref();
  }

  if (
    typeof intervalHandle
      .unref ===
    "function"
  ) {
    intervalHandle.unref();
  }

  console.log(
    `[USER ALERT MATCHER] Enabled every ${intervalSeconds} seconds.`
  );
}

module.exports = {
  startUserAlertMatcher,
  runUserAlertMatcher,
  appointmentMatchesAlert,
  appointmentFingerprint,
  distanceMiles
};