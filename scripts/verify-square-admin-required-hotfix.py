from pathlib import Path
import sys

ROOT = Path.cwd()

admin_html = (ROOT / "public/admin.html").read_text()
defs = (ROOT / "public/platformDefinitions.js").read_text()
admin_js = (ROOT / "public/admin.js").read_text()

def ok(msg):
    print(f"[OK] {msg}")

def fail(msg):
    print(f"[FAIL] {msg}")
    sys.exit(1)

for token in [
    "/platformDefinitions.js?v=20260812-square-v5-required-hotfix",
    "/admin.js?v=20260812-square-v5-required-hotfix",
    "/businessPlatformEditor.js?v=20260812-square-v5-required-hotfix",
]:
    if token not in admin_html:
        fail(f"Missing cache-busted asset: {token}")
ok("Admin assets use new cache keys")

start = defs.find("    square: {")
end = defs.find("\n\n    mangomint:", start)
if start == -1 or end == -1:
    fail("Could not isolate Square definition")
block = defs[start:end]

for key in [
    "squareBookingBusinessId",
    "squareLocationId",
    "squareSiteUrl",
    "squarePublishedUserId",
    "squareSiteId",
]:
    idx = block.find(key)
    if idx == -1:
        fail(f"Missing {key}")
    snippet = block[idx:idx+700]
    if 'requiredFor: ["scrape"]' in snippet or "requiredFor: ['scrape']" in snippet:
        fail(f"{key} is still scrape-required")
ok("Square discovery fields are optional")

for marker in [
    "Square Published User ID (Optional",
    "Square Site ID (Optional",
    "Square Site URL (Optional",
]:
    if marker not in defs and marker not in admin_js:
        fail(f"Missing optional label: {marker}")
ok("Square Online-only labels are explicit")

print("\nSquare Admin required-field hotfix verified.")