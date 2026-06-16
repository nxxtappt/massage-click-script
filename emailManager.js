const { Resend } = require("resend");

function getRequiredEnv(name) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`${name} is required.`);
  }

  return value;
}

async function sendBusinessLoginCode({
  to,
  code,
  businessName,
  expiresAt
}) {
  const resend = new Resend(
    getRequiredEnv("RESEND_API_KEY")
  );

  const from =
    process.env.BUSINESS_LOGIN_FROM_EMAIL ||
    "NextAppt <onboarding@resend.dev>";

  const expiresText = expiresAt
    ? new Date(expiresAt).toLocaleString("en-US", {
        timeZone: "America/Chicago"
      })
    : "soon";

  const { data, error } = await resend.emails.send({
    from,
    to: [to],
    subject: "Your NextAppt business login code",
    html: `
      <div style="font-family: Arial, sans-serif; line-height: 1.5;">
        <h2>Your NextAppt login code</h2>

        <p>
          Use this code to access your business dashboard
          ${businessName ? `for <strong>${businessName}</strong>` : ""}.
        </p>

        <p style="font-size: 28px; font-weight: bold; letter-spacing: 4px;">
          ${code}
        </p>

        <p>
          This code expires at ${expiresText}.
        </p>

        <p>
          If you did not request this code, you can ignore this email.
        </p>
      </div>
    `,
    text: `Your NextAppt login code is ${code}. It expires at ${expiresText}.`
  });

  if (error) {
    throw new Error(
      error.message || "Failed to send login code email."
    );
  }

  return data;
}

module.exports = {
  sendBusinessLoginCode
};