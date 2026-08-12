from pathlib import Path
import subprocess, sys

ROOT = Path.cwd()
p = ROOT / "scrapers/square.js"
if not p.exists():
    raise SystemExit("scrapers/square.js not found")

subprocess.run(["node", "--check", str(p)], check=True)
print("[OK] syntax")

src = p.read_text()
for marker in [
    "target.integrationConfig",
    "target.primaryIntegration",
    "const directBuyerStartUrl = buildSquareBuyerStartUrl",
]:
    if marker not in src:
        raise SystemExit(f"Missing marker: {marker}")
print("[OK] patch markers")

js = r'''
const square = require("./scrapers/square");

const meta = square.normalizeSquareTarget({
  bookingUrl: "https://metahairco.square.site/",
  integrationConfig: {
    squareSiteUrl: "https://metahairco.square.site/",
    squarePublishedUserId: "140362466",
    squareSiteId: "893942011352907588",
    squareLocationId: "89AQ7C8CEM2SM"
  }
});

if (meta.squarePublishedUserId !== "140362466") throw new Error("published user ID not resolved");
if (meta.squareSiteId !== "893942011352907588") throw new Error("site ID not resolved");
if (meta.squareLocationId !== "89AQ7C8CEM2SM") throw new Error("location ID not resolved");

const zen = square.normalizeSquareTarget({
  bookingUrl:
    "https://book.squareup.com/appointments/s4hhr5q8oh2ok8/location/LEQJ0XZDY3KXG/services"
});

const buyer = square.buildSquareBuyerStartUrl({
  locationId: zen.squareLocationId,
  serviceItemId: "4OMBQWMCOST2WVWLZ74D7IUR",
  target: zen
});

if (!buyer.includes("/appointments/book/LEQJ0XZDY3KXG/start")) throw new Error("wrong buyer start");
if (!buyer.includes("service_id=4OMBQWMCOST2WVWLZ74D7IUR")) throw new Error("missing service_id");

console.log("[OK] config lookup and direct buyer-start");
'''
subprocess.run(["node", "-e", js], cwd=ROOT, check=True)
print("\nSquare v5 live-error hotfix verified.")