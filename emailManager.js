const { Resend } = require("resend");

function getRequiredEnv(name) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`${name} is required.`);
  }

  return value;
}

function escapeHtml(value = "") {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function safeHttpUrl(value = "") {
  try {
    const parsed = new URL(
      String(value || "")
    );

    return [
      "http:",
      "https:"
    ].includes(
      parsed.protocol
    )
      ? parsed.toString()
      : "";
  } catch {
    return "";
  }
}

function formatAlertDate(
  value,
  timezone =
    "America/Chicago"
) {
  if (!value) {
    return "";
  }

  const text =
    String(value);

  const match =
    text.match(
      /^(\d{4})-(\d{2})-(\d{2})/
    );

  if (match) {
    const date =
      new Date(
        Date.UTC(
          Number(match[1]),
          Number(match[2]) - 1,
          Number(match[3]),
          12
        )
      );

    return date
      .toLocaleDateString(
        "en-US",
        {
          timeZone:
            timezone,
          weekday:
            "short",
          month:
            "short",
          day:
            "numeric"
        }
      );
  }

  return text;
}

function formatAlertTime(
  value = ""
) {
  const match =
    String(value || "")
      .match(
        /^(\d{1,2}):(\d{2})/
      );

  if (!match) {
    return String(
      value || ""
    );
  }

  const hour24 =
    Number(match[1]);

  const suffix =
    hour24 >= 12
      ? "PM"
      : "AM";

  const hour =
    hour24 % 12 ||
    12;

  return `${hour}:${match[2]} ${suffix}`;
}

async function sendBusinessLoginCode({
  to,
  code,
  businessName,
  expiresAt
}) {
  const resend =
    new Resend(
      getRequiredEnv(
        "RESEND_API_KEY"
      )
    );

  const from =
    process.env
      .BUSINESS_LOGIN_FROM_EMAIL ||
    "NextAppt <onboarding@resend.dev>";

  const expiresText =
    expiresAt
      ? new Date(
          expiresAt
        ).toLocaleString(
          "en-US",
          {
            timeZone:
              "America/Chicago"
          }
        )
      : "soon";

  const {
    data,
    error
  } =
    await resend
      .emails
      .send({
        from,
        to: [to],
        subject:
          "Your NextAppt business login code",
        html: `
          <div style="font-family: Arial, sans-serif; line-height: 1.5;">
            <h2>Your NextAppt login code</h2>
            <p>
              Use this code to access your business dashboard
              ${
                businessName
                  ? `for <strong>${escapeHtml(
                      businessName
                    )}</strong>`
                  : ""
              }.
            </p>
            <p style="font-size: 28px; font-weight: bold; letter-spacing: 4px;">
              ${escapeHtml(code)}
            </p>
            <p>
              This code expires at
              ${escapeHtml(
                expiresText
              )}.
            </p>
            <p>
              If you did not request this code, you can ignore this email.
            </p>
          </div>
        `,
        text:
          `Your NextAppt login code is ${code}. ` +
          `It expires at ${expiresText}.`
      });

  if (error) {
    throw new Error(
      error.message ||
      "Failed to send login code email."
    );
  }

  return data;
}

async function sendUserLoginCode({
  to,
  code,
  expiresAt
}) {
  const resend =
    new Resend(
      getRequiredEnv(
        "RESEND_API_KEY"
      )
    );

  const from =
    process.env
      .USER_LOGIN_FROM_EMAIL ||
    process.env
      .BUSINESS_LOGIN_FROM_EMAIL ||
    "NextAppt <onboarding@resend.dev>";

  const expiresText =
    expiresAt
      ? new Date(
          expiresAt
        ).toLocaleString(
          "en-US",
          {
            timeZone:
              "America/Chicago"
          }
        )
      : "soon";

  const {
    data,
    error
  } =
    await resend
      .emails
      .send({
        from,
        to: [to],
        subject:
          "Your NextAppt login code",
        html: `
          <div style="font-family: Arial, sans-serif; line-height: 1.5;">
            <h2>Your NextAppt login code</h2>
            <p>
              Use this code to sign in to your NextAppt account.
            </p>
            <p style="font-size: 28px; font-weight: bold; letter-spacing: 4px;">
              ${escapeHtml(code)}
            </p>
            <p>
              This code expires at
              ${escapeHtml(
                expiresText
              )}.
            </p>
            <p>
              If you did not request this code, you can ignore this email.
            </p>
          </div>
        `,
        text:
          `Your NextAppt login code is ${code}. ` +
          `It expires at ${expiresText}.`
      });

  if (error) {
    throw new Error(
      error.message ||
      "Failed to send user login code email."
    );
  }

  return data;
}

async function sendAppointmentAlertEmail({
  to,
  firstName,
  alert = {},
  matches = []
}) {
  if (
    !Array.isArray(
      matches
    ) ||
    !matches.length
  ) {
    throw new Error(
      "At least one appointment match is required."
    );
  }

  const resend =
    new Resend(
      getRequiredEnv(
        "RESEND_API_KEY"
      )
    );

  const from =
    process.env
      .APPOINTMENT_ALERT_FROM_EMAIL ||
    process.env
      .USER_LOGIN_FROM_EMAIL ||
    process.env
      .BUSINESS_LOGIN_FROM_EMAIL ||
    "NextAppt <onboarding@resend.dev>";

  const baseUrl =
    String(
      process.env
        .NEXTAPPT_BASE_URL ||
      "https://nextappt.ai"
    ).replace(
      /\/$/,
      ""
    );

  const accountUrl =
    `${baseUrl}/account`;

  const greeting =
    firstName
      ? `Hi ${firstName},`
      : "Good news,";

  const firstMatch =
    matches[0];

  const subjectDetail =
    [
      firstMatch
        .durationMinutes
        ? `${firstMatch.durationMinutes} min`
        : "",
      firstMatch
        .serviceName ||
        firstMatch
          .serviceCategory ||
        alert.categorySlug ||
        "appointment"
    ]
      .filter(Boolean)
      .join(" ");

  const cards =
    matches
      .map(
        (match) => {
          const timezone =
            match.timezone ||
            "America/Chicago";

          const date =
            formatAlertDate(
              match
                .localDateKey ||
              match
                .localDate,
              timezone
            );

          const time =
            formatAlertTime(
              match
                .localTimeKey ||
              match
                .localTime
            );

          const bookingUrl =
            safeHttpUrl(
              match.bookingUrl
            ) ||
            accountUrl;

          const sourceLabel =
            match.sourceType ===
            "inferred"
              ? "Inferred opening"
              : "Confirmed opening";

          return `
            <div style="border:1px solid #dbe4ec;border-radius:12px;padding:16px;margin:14px 0;">
              <div style="font-weight:700;font-size:17px;color:#10202f;">
                ${escapeHtml(
                  match.businessName ||
                  "Appointment opening"
                )}
              </div>
              <div style="margin-top:5px;color:#415a6b;">
                ${escapeHtml(
                  match.serviceName ||
                  match.serviceCategory ||
                  "Appointment"
                )}
                ${
                  match.durationMinutes
                    ? ` · ${escapeHtml(
                        match.durationMinutes
                      )} min`
                    : ""
                }
              </div>
              <div style="margin-top:8px;font-size:18px;font-weight:700;color:#005f95;">
                ${escapeHtml(
                  date
                )}
                ${escapeHtml(
                  time
                )}
              </div>
              ${
                match.providerName
                  ? `<div style="margin-top:5px;color:#64748b;">With ${escapeHtml(
                      match.providerName
                    )}</div>`
                  : ""
              }
              <div style="margin-top:5px;color:#64748b;font-size:12px;">
                ${escapeHtml(
                  sourceLabel
                )}
              </div>
              <div style="margin-top:12px;">
                <a
                  href="${escapeHtml(
                    bookingUrl
                  )}"
                  style="display:inline-block;background:#006ca8;color:white;text-decoration:none;padding:10px 14px;border-radius:9px;font-weight:700;"
                >
                  View &amp; book
                </a>
              </div>
            </div>
          `;
        }
      )
      .join("");

  const textMatches =
    matches
      .map(
        (match) => {
          const timezone =
            match.timezone ||
            "America/Chicago";

          const bookingUrl =
            safeHttpUrl(
              match.bookingUrl
            ) ||
            accountUrl;

          return [
            match.businessName ||
              "Appointment opening",
            [
              match.serviceName ||
                match.serviceCategory,
              match.durationMinutes
                ? `${match.durationMinutes} min`
                : ""
            ]
              .filter(Boolean)
              .join(" - "),
            `${formatAlertDate(
              match.localDateKey ||
              match.localDate,
              timezone
            )} ${formatAlertTime(
              match.localTimeKey ||
              match.localTime
            )}`,
            match.providerName
              ? `With ${match.providerName}`
              : "",
            bookingUrl
          ]
            .filter(Boolean)
            .join("\n");
        }
      )
      .join("\n\n");

  const {
    data,
    error
  } =
    await resend
      .emails
      .send({
        from,
        to: [to],
        subject:
          `New NextAppt opening: ${subjectDetail}`,
        html: `
          <div style="font-family:Arial,sans-serif;line-height:1.5;max-width:620px;margin:0 auto;color:#10202f;">
            <h2 style="margin-bottom:8px;">
              A matching appointment opened up
            </h2>
            <p>
              ${escapeHtml(
                greeting
              )}
            </p>
            <p>
              NextAppt found
              ${
                matches.length ===
                1
                  ? "an opening"
                  : `${matches.length} openings`
              }
              matching your alert
              ${
                alert.label
                  ? `<strong>${escapeHtml(
                      alert.label
                    )}</strong>`
                  : ""
              }.
            </p>

            ${cards}

            <p style="margin-top:22px;color:#64748b;font-size:13px;">
              Availability can change quickly. Booking is completed with the provider.
            </p>
            <p style="color:#64748b;font-size:13px;">
              You received this because appointment alerts are enabled on your NextAppt account.
              <a href="${escapeHtml(
                accountUrl
              )}">
                Manage your alerts
              </a>.
            </p>
          </div>
        `,
        text:
          `${greeting}\n\n` +
          `NextAppt found matching appointment availability for: ` +
          `${alert.label || "your saved alert"}.\n\n` +
          `${textMatches}\n\n` +
          `Manage your alerts: ${accountUrl}`
      });

  if (error) {
    throw new Error(
      error.message ||
      "Failed to send appointment alert email."
    );
  }

  return data;
}

module.exports = {
  sendBusinessLoginCode,
  sendUserLoginCode,
  sendAppointmentAlertEmail
};