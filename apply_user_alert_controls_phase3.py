from pathlib import Path

ROOT = Path(__file__).resolve().parent

path = ROOT / "public" / "admin.html"

if not path.exists():
    raise SystemExit("Missing required file: public/admin.html")

text = path.read_text(encoding="utf-8")

old = "/adminUsers.js?v=20260807-alerts-phase2"
new = "/adminUsers.js?v=20260807-alert-controls-phase3"

if new in text:
    print("[already patched] admin users cache version")
elif old not in text:
    raise SystemExit(
        "Could not find the Phase 2 adminUsers.js cache marker. "
        "No edit was made."
    )
else:
    path.write_text(
        text.replace(old, new, 1),
        encoding="utf-8"
    )
    print("[patched] admin users cache version")

print("")
print("Phase 3 admin delivery controls patch applied.")
print("Next: node runMigration.js 014_user_alert_delivery_controls.sql")