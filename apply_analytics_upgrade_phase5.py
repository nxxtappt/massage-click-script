from pathlib import Path

ROOT = Path(__file__).resolve().parent


def replace_once(path, old, new, label):
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
            "No guessed edit was made."
        )

    file_path.write_text(
        text.replace(old, new, 1),
        encoding="utf-8"
    )

    print(f"[patched] {label}")


replace_once(
    "server.js",
    'const analyticsRoutes = require("./analyticsRoutes");\n',
    'const analyticsRoutes = require("./analyticsRoutes");\n'
    'const adminSiteAnalyticsRoutes = require("./adminSiteAnalyticsRoutes");\n',
    "server admin analytics import"
)

replace_once(
    "server.js",
    'app.use("/api/admin/v2", adminV2Routes);\n',
    'app.use("/api/admin/v2", adminV2Routes);\n'
    'app.use("/api/admin/analytics", adminSiteAnalyticsRoutes);\n',
    "server protected analytics route"
)

replace_once(
    "businessDashboardRoutes.js",
    '    analytics: getBusinessClickSummary(businessName)\n',
    '    analytics: await getBusinessClickSummary(\n'
    '      businessName,\n'
    '      {\n'
    '        days: 30,\n'
    '        businessSlug:\n'
    '          business?.businessSlug ||\n'
    '          business?.slug ||\n'
    '          slugify(businessName)\n'
    '      }\n'
    '    )\n',
    "business dashboard persistent analytics"
)

routes_path = ROOT / "businessDashboardRoutes.js"
routes_text = routes_path.read_text(encoding="utf-8")

analytics_route = (
    'router.get("/analytics", requireBusinessSession, async (req, res) => {\n'
    '  try {\n'
    '    const business = await findBusinessForSession(\n'
    '      req.businessSession\n'
    '    );\n'
    '\n'
    '    const businessName =\n'
    '      business?.businessName ||\n'
    '      business?.name ||\n'
    '      req.businessSession.businessName ||\n'
    '      "";\n'
    '\n'
    '    if (!businessName) {\n'
    '      return res.status(404).json({\n'
    '        success: false,\n'
    '        error: "Business not found."\n'
    '      });\n'
    '    }\n'
    '\n'
    '    const analytics =\n'
    '      await getBusinessClickSummary(\n'
    '        businessName,\n'
    '        {\n'
    '          days:\n'
    '            req.query.days ||\n'
    '            30,\n'
    '          businessSlug:\n'
    '            business?.businessSlug ||\n'
    '            business?.slug ||\n'
    '            slugify(\n'
    '              businessName\n'
    '            )\n'
    '        }\n'
    '      );\n'
    '\n'
    '    res.json({\n'
    '      success: true,\n'
    '      analytics\n'
    '    });\n'
    '  } catch (error) {\n'
    '    console.error(\n'
    '      "[BUSINESS DASHBOARD ANALYTICS ERROR]",\n'
    '      error\n'
    '    );\n'
    '\n'
    '    res.status(500).json({\n'
    '      success: false,\n'
    '      error: error.message\n'
    '    });\n'
    '  }\n'
    '});\n'
    '\n'
)

dashboard_marker = 'router.get("/dashboard", requireBusinessSession, async (req, res) => {'

if analytics_route in routes_text:
    print("[already patched] business analytics period endpoint")
elif dashboard_marker not in routes_text:
    raise SystemExit(
        "Could not find /dashboard route in businessDashboardRoutes.js."
    )
else:
    routes_path.write_text(
        routes_text.replace(
            dashboard_marker,
            analytics_route + dashboard_marker,
            1
        ),
        encoding="utf-8"
    )
    print("[patched] business analytics period endpoint")


admin_path = ROOT / "public" / "admin.html"
admin_text = admin_path.read_text(encoding="utf-8")
admin_script = (
    '  <script src="/adminAnalytics.js?v=20260808-persistent-analytics"></script>\n'
)

if admin_script in admin_text:
    print("[already patched] admin analytics UI script")
else:
    admin_marker = (
        '  <script src="/adminUsers.js?v=20260807-alert-controls-phase3"></script>\n'
    )

    if admin_marker not in admin_text:
        raise SystemExit(
            "Could not find the current adminUsers.js script in public/admin.html."
        )

    admin_path.write_text(
        admin_text.replace(
            admin_marker,
            admin_marker + admin_script,
            1
        ),
        encoding="utf-8"
    )
    print("[patched] admin analytics UI script")


business_html_path = ROOT / "public" / "business-dashboard.html"
business_html = business_html_path.read_text(encoding="utf-8")

analytics_css = (
    '  <link rel="stylesheet" '
    'href="/business-dashboard-analytics.css?v=20260808-persistent-analytics" />\n'
)

if analytics_css in business_html:
    print("[already patched] business dashboard analytics CSS")
else:
    css_marker = '  <link rel="stylesheet" href="/admin.css" />\n'

    if css_marker not in business_html:
        raise SystemExit(
            "Could not find admin.css in public/business-dashboard.html."
        )

    business_html = business_html.replace(
        css_marker,
        css_marker + analytics_css,
        1
    )

upgrade_script = (
    '  <script src="/businessDashboardAnalyticsUpgrade.js?v=20260808-persistent-analytics"></script>\n'
)

if upgrade_script in business_html:
    print("[already patched] business dashboard analytics UI script")
else:
    dashboard_script_marker = (
        '  <script src="/business-dashboard.js"></script>\n'
    )

    if dashboard_script_marker not in business_html:
        raise SystemExit(
            "Could not find business-dashboard.js in public/business-dashboard.html."
        )

    business_html = business_html.replace(
        dashboard_script_marker,
        dashboard_script_marker + upgrade_script,
        1
    )

business_html_path.write_text(
    business_html,
    encoding="utf-8"
)


public_pages = [
    "public/landing.html",
    "public/index.html",
    "public/business-page.html",
    "public/business.html",
    "public/account.html",
    "public/ai.html"
]

site_script = (
    '  <script src="/siteAnalytics.js?v=20260808-persistent-analytics"></script>\n'
)

for relative in public_pages:
    file_path = ROOT / relative

    if not file_path.exists():
        print(f"[skip] {relative} does not exist")
        continue

    text = file_path.read_text(encoding="utf-8")

    if site_script in text:
        print(f"[already patched] visitor analytics: {relative}")
        continue

    if "</body>" not in text:
        raise SystemExit(
            f"Could not find </body> in {relative}."
        )

    file_path.write_text(
        text.replace(
            "</body>",
            site_script + "</body>",
            1
        ),
        encoding="utf-8"
    )

    print(f"[patched] visitor analytics: {relative}")


print("")
print("Persistent analytics Phase 5 patches applied.")
print("Run the database migration before starting the updated server:")
print("  node runMigration.js 015_persistent_analytics.sql")