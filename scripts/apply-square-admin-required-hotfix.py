from pathlib import Path

ROOT = Path.cwd()

def patch(rel, fn):
    p = ROOT / rel
    if not p.exists():
        raise SystemExit(f"{rel} not found")
    src = p.read_text()
    backup = p.with_name(p.name + ".pre-square-admin-required-hotfix")
    if not backup.exists():
        backup.write_text(src)
        print(f"[BACKUP] {rel} -> {backup.name}")
    out = fn(src)
    p.write_text(out)
    print(f"[PATCHED] {rel}")

def patch_admin_html(s):
    s = s.replace(
        "/platformDefinitions.js?v=20260729-platform-config",
        "/platformDefinitions.js?v=20260812-square-v5-required-hotfix",
    )
    s = s.replace(
        "/admin.js?v=20260804-admin-city-workspace",
        "/admin.js?v=20260812-square-v5-required-hotfix",
    )
    s = s.replace(
        "/businessPlatformEditor.js?v=20260729-platform-config",
        "/businessPlatformEditor.js?v=20260812-square-v5-required-hotfix",
    )
    return s

def patch_defs(s):
    replacements = {
        'text("squareBookingBusinessId", "Square Booking Business ID", {':
            'text("squareBookingBusinessId", "Square Booking Business ID (Optional)", {',
        'text("squareLocationId", "Square Location ID", {':
            'text("squareLocationId", "Square Location ID (Optional / auto-parsed)", {',
        'url("squareSiteUrl", "Square Site URL", {':
            'url("squareSiteUrl", "Square Site URL (Optional — Square Online only)", {',
        'text("squarePublishedUserId", "Square Published User ID", {':
            'text("squarePublishedUserId", "Square Published User ID (Optional — Square Online only)", {',
        'text("squareSiteId", "Square Site ID", {':
            'text("squareSiteId", "Square Site ID (Optional — Square Online only)", {',
    }
    for old, new in replacements.items():
        s = s.replace(old, new)
    return s

def patch_admin_js(s):
    replacements = {
        "<span>Square Site URL</span>":
            "<span>Square Site URL (Optional — Square Online only)</span>",
        "<span>Square Published User ID</span>":
            "<span>Square Published User ID (Optional — Square Online only)</span>",
        "<span>Square Site ID</span>":
            "<span>Square Site ID (Optional — Square Online only)</span>",
        "<span>Square Booking Business ID</span>":
            "<span>Square Booking Business ID (Optional)</span>",
        "<span>Square Location ID</span>":
            "<span>Square Location ID (Optional / auto-parsed)</span>",
    }
    for old, new in replacements.items():
        s = s.replace(old, new)
    return s

patch("public/admin.html", patch_admin_html)
patch("public/platformDefinitions.js", patch_defs)
patch("public/admin.js", patch_admin_js)

print("\nSquare Admin required-field/cache hotfix applied.")
print("Run: python3 scripts/verify-square-admin-required-hotfix.py")