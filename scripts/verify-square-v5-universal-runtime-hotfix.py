from pathlib import Path
import subprocess

ROOT = Path.cwd()
p = ROOT / "scrapers/square.js"
subprocess.run(["node", "--check", str(p)], check=True)
print("[OK] Square syntax")

src = p.read_text()
for marker in [
    "async function discoverSquareSyncIdsInBrowser(",
    "browser network traffic",
    "async function clickConfiguredServiceOption()",
    "serviceId: serviceItemId",
    "durationMinutes: toNumberOrNull(target.durationMinutes)"
]:
    if marker not in src:
        raise SystemExit(f"[FAIL] missing marker: {marker}")
print("[OK] runtime hotfix markers")
print("Square v5 universal runtime hotfix verified.")