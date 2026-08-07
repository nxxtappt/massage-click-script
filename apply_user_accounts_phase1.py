from pathlib import Path

ROOT = Path.cwd()


def read(path):
    return (ROOT / path).read_text(encoding="utf-8")


def write(path, text):
    (ROOT / path).write_text(text, encoding="utf-8")


def replace_once(path, old, new):
    text = read(path)
    if new in text:
        print(f"[skip] {path}: change already applied")
        return
    if old not in text:
        raise RuntimeError(f"Could not find expected marker in {path}:\n{old[:240]}")
    write(path, text.replace(old, new, 1))
    print(f"[edit] {path}")


def insert_before_once(path, marker, insertion, unique_marker):
    text = read(path)
    if unique_marker in text:
        print(f"[skip] {path}: insertion already present")
        return
    if marker not in text:
        raise RuntimeError(f"Could not find insertion marker in {path}: {marker}")
    write(path, text.replace(marker, insertion + marker, 1))
    print(f"[edit] {path}")


def check_new_files():
    required = [
        "db/migrations/012_user_accounts.sql",
        "database/userRepository.js",
        "userRoutes.js",
        "adminUserRoutes.js",
        "public/adminUsers.js",
        "public/emailCapture.js",
        "public/account.html",
        "public/account.css",
        "public/account.js",
    ]
    missing = [path for path in required if not (ROOT / path).exists()]
    if missing:
        raise RuntimeError(
            "Run this script from the repository root after copying/extracting the new files. "
            f"Missing: {', '.join(missing)}"
        )


def patch_server():
    replace_once(
        "server.js",
        'const { saveEmailCapture } = require("./database/runtimeStateRepository");',
        'const userRepository = require("./database/userRepository");\n'
        'const userRoutes = require("./userRoutes");\n'
        'const adminUserRoutes = require("./adminUserRoutes");',
    )

    replace_once(
        "server.js",
        '    await saveEmailCapture(email, source);\n'
        '    res.json({ success: true, message: "Email saved." });',
        '    const consent =\n'
        '      req.body?.consent && typeof req.body.consent === "object"\n'
        '        ? req.body.consent\n'
        '        : {};\n\n'
        '    await userRepository.captureEmail({\n'
        '      email,\n'
        '      source,\n'
        '      productUpdatesEnabled: consent.productUpdates === true\n'
        '    });\n\n'
        '    res.json({ success: true, message: "Email saved." });',
    )

    replace_once(
        "server.js",
        'app.use("/api/admin/v2", adminV2Routes);\n'
        'app.use("/api/admin", adminRoutes);',
        'app.use("/api/admin/v2", adminV2Routes);\n'
        'app.use("/api/admin/users", adminUserRoutes);\n'
        'app.use("/api/admin", adminRoutes);\n'
        'app.use("/api/user", userRoutes);',
    )

    insert_before_once(
        "server.js",
        'app.get("/business", (req, res) => {',
        'app.get("/account", (req, res) => {\n'
        '  res.sendFile(path.join(__dirname, "public", "account.html"));\n'
        '});\n\n',
        'app.get("/account", (req, res) => {',
    )


def patch_email_manager():
    insertion = r'''

async function sendUserLoginCode({
  to,
  code,
  expiresAt
}) {
  const resend = new Resend(
    getRequiredEnv("RESEND_API_KEY")
  );

  const from =
    process.env.USER_LOGIN_FROM_EMAIL ||
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
    subject: "Your NextAppt login code",
    html: `
      <div style="font-family: Arial, sans-serif; line-height: 1.5;">
        <h2>Your NextAppt login code</h2>
        <p>Use this code to sign in to your NextAppt account.</p>
        <p style="font-size: 28px; font-weight: bold; letter-spacing: 4px;">
          ${code}
        </p>
        <p>This code expires at ${expiresText}.</p>
        <p>If you did not request this code, you can ignore this email.</p>
      </div>
    `,
    text: `Your NextAppt login code is ${code}. It expires at ${expiresText}.`
  });

  if (error) {
    throw new Error(
      error.message || "Failed to send user login code email."
    );
  }

  return data;
}
'''

    text = read("emailManager.js")
    if "async function sendUserLoginCode" not in text:
        marker = "\nmodule.exports = {\n  sendBusinessLoginCode\n};"
        if marker not in text:
            raise RuntimeError("Could not find emailManager.js export marker.")
        text = text.replace(marker, insertion + marker, 1)

    old_exports = "module.exports = {\n  sendBusinessLoginCode\n};"
    new_exports = "module.exports = {\n  sendBusinessLoginCode,\n  sendUserLoginCode\n};"
    if new_exports not in text:
        if old_exports not in text:
            raise RuntimeError("Could not update emailManager.js exports.")
        text = text.replace(old_exports, new_exports, 1)

    write("emailManager.js", text)
    print("[edit] emailManager.js")


def patch_admin_html():
    replace_once(
        "public/admin.html",
        '  <script src="/admin.js?v=20260804-admin-city-workspace"></script>\n'
        '  <script src="/businessPlatformEditor.js?v=20260729-platform-config"></script>',
        '  <script src="/admin.js?v=20260804-admin-city-workspace"></script>\n'
        '  <script src="/adminUsers.js?v=20260807-user-accounts"></script>\n'
        '  <script src="/businessPlatformEditor.js?v=20260729-platform-config"></script>',
    )


def patch_landing_html():
    insert_before_once(
        "public/landing.html",
        "</body>",
        '  <script src="/emailCapture.js?v=20260807-user-accounts"></script>\n',
        '/emailCapture.js?v=20260807-user-accounts',
    )


def main():
    check_new_files()
    patch_server()
    patch_email_manager()
    patch_admin_html()
    patch_landing_html()
    print("\nPhase 1 user-account edits applied successfully.")
    print("Next: node runMigration.js 012_user_accounts.sql")
    print("Then: node --check server.js && node --check userRoutes.js && node --check adminUserRoutes.js && node --check database/userRepository.js")


if __name__ == "__main__":
    main()