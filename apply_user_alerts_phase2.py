from pathlib import Path

ROOT = Path(__file__).resolve().parent


def patch(path, old, new, label):
    file_path = ROOT / path

    if not file_path.exists():
        raise SystemExit(f"Missing required file: {path}")

    text = file_path.read_text(encoding="utf-8")

    if new in text:
        print(f"[already patched] {label}")
        return

    if old not in text:
        raise SystemExit(
            f"Could not find patch marker for {label} in {path}. "
            "No edit was made for this step."
        )

    file_path.write_text(
        text.replace(old, new, 1),
        encoding="utf-8"
    )

    print(f"[patched] {label}")


patch(
    "server.js",
    'const adminUserRoutes = require("./adminUserRoutes");\n',
    'const adminUserRoutes = require("./adminUserRoutes");\n'
    'const { startUserAlertMatcher } = require("./userAlertMatcher");\n',
    "server alert matcher import"
)

patch(
    "server.js",
    'async function initializeRuntime() {\n'
    '  await initializeAdminSettings();\n'
    '  await warmBusinessCache();\n'
    '}\n',
    'async function initializeRuntime() {\n'
    '  await initializeAdminSettings();\n'
    '  await warmBusinessCache();\n'
    '  startUserAlertMatcher();\n'
    '}\n',
    "server alert matcher startup"
)

patch(
    "userRoutes.js",
    'const { sendUserLoginCode } = require("./emailManager");\n',
    'const { sendUserLoginCode } = require("./emailManager");\n'
    'const { buildAlertFromSearch } = require("./userAlertSearchBuilder");\n',
    "user alert search builder import"
)

from_search_route = (
    'router.post("/alerts/from-search", requireUser, async (req, res) => {\n'
    '  try {\n'
    '    const alertPayload = buildAlertFromSearch(req.body || {});\n'
    '\n'
    '    if (\n'
    '      !alertPayload.metro &&\n'
    '      !alertPayload.categorySlug &&\n'
    '      !alertPayload.filters?.search\n'
    '    ) {\n'
    '      return res.status(400).json({\n'
    '        success: false,\n'
    '        error: "Add a city, appointment category, or search request before saving an alert."\n'
    '      });\n'
    '    }\n'
    '\n'
    '    const alert = await userRepository.createAlert(\n'
    '      req.user.id,\n'
    '      alertPayload\n'
    '    );\n'
    '\n'
    '    res.status(201).json({\n'
    '      success: true,\n'
    '      alert,\n'
    '      message: "Appointment alert saved."\n'
    '    });\n'
    '  } catch (error) {\n'
    '    console.error("[USER ALERT FROM SEARCH]", error);\n'
    '    res.status(400).json({ success: false, error: error.message });\n'
    '  }\n'
    '});\n'
    '\n'
)

route_marker = 'router.post("/alerts", requireUser, async (req, res) => {\n'

user_routes_path = ROOT / "userRoutes.js"
user_routes_text = user_routes_path.read_text(encoding="utf-8")

if from_search_route in user_routes_text:
    print("[already patched] create alert from search route")
elif route_marker not in user_routes_text:
    raise SystemExit(
        "Could not find alert POST route marker in userRoutes.js. "
        "No route insertion was made."
    )
else:
    user_routes_path.write_text(
        user_routes_text.replace(
            route_marker,
            from_search_route + route_marker,
            1
        ),
        encoding="utf-8"
    )
    print("[patched] create alert from search route")

index_path = ROOT / "public" / "index.html"

if not index_path.exists():
    raise SystemExit("Missing required file: public/index.html")

index_text = index_path.read_text(encoding="utf-8")

search_alert_css = (
    '  <link\n'
    '    rel="stylesheet"\n'
    '    href="/searchAlerts.css?v=20260807-alerts-phase2"\n'
    '  />\n'
)

if search_alert_css in index_text:
    print("[already patched] search alert stylesheet")
else:
    styles_marker = (
        '  <link\n'
        '    rel="stylesheet"\n'
        '    href="/styles.css"\n'
        '  />\n'
    )

    if styles_marker not in index_text:
        raise SystemExit(
            "Could not find /styles.css marker in public/index.html."
        )

    index_text = index_text.replace(
        styles_marker,
        styles_marker + "\n" + search_alert_css,
        1
    )

    index_path.write_text(index_text, encoding="utf-8")
    print("[patched] search alert stylesheet")

index_text = index_path.read_text(encoding="utf-8")

search_alert_script = (
    '  <script src="/searchAlerts.js?v=20260807-alerts-phase2"></script>\n'
)

if search_alert_script in index_text:
    print("[already patched] search alert frontend script")
else:
    app_script_marker = '  <script src="/app.js"></script>\n'

    if app_script_marker not in index_text:
        raise SystemExit(
            "Could not find /app.js marker in public/index.html."
        )

    index_path.write_text(
        index_text.replace(
            app_script_marker,
            app_script_marker + search_alert_script,
            1
        ),
        encoding="utf-8"
    )
    print("[patched] search alert frontend script")

patch(
    "public/account.html",
    '/account.css?v=20260807-user-accounts',
    '/account.css?v=20260807-alerts-phase2',
    "account stylesheet cache version"
)

patch(
    "public/account.html",
    '/account.js?v=20260807-user-accounts',
    '/account.js?v=20260807-alerts-phase2',
    "account script cache version"
)

patch(
    "public/admin.html",
    '/adminUsers.js?v=20260807-user-accounts',
    '/adminUsers.js?v=20260807-alerts-phase2',
    "admin users cache version"
)

print("")
print("Phase 2 alert patches applied successfully.")
print("Next: node runMigration.js 013_user_alert_notifications.sql")