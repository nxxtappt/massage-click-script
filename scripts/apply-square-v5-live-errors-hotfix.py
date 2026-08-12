from pathlib import Path

ROOT = Path.cwd()
SQUARE = ROOT / "scrapers/square.js"
if not SQUARE.exists():
    raise SystemExit("scrapers/square.js not found")

src = SQUARE.read_text()
backup = SQUARE.with_name("square.js.pre-v5-live-errors-hotfix")
if not backup.exists():
    backup.write_text(src)
    print(f"[BACKUP] {backup}")

old_sources = '''  const primarySources = [
    target,
    target.square,
    target.squareConfig,
    target.square_config,
    target.integration,
    ...matchingIntegrations
  ].filter((value) => value && typeof value === "object");'''

new_sources = '''  const primarySources = [
    target,
    target.integrationConfig,
    target.integration_config,
    target.primaryIntegration,
    target.primary_integration,
    target.square,
    target.squareConfig,
    target.square_config,
    target.integration,
    ...matchingIntegrations
  ].filter((value) => value && typeof value === "object");'''

if old_sources in src:
    src = src.replace(old_sources, new_sources)

old_direct = '''  const availabilityPayload = await fetchSquareAvailabilityInBrowser({
    bookingUrl: context.directBookingUrl || target.bookingUrl || "",
    buyerStartUrl: context.directBookingUrl || target.bookingUrl || "",
    payload: null,
    serviceName,
    staffProfiles: [],
    timeoutMs: Math.max(Number(target.squareTimeoutMs || 20000), 35000)
  });'''

new_direct = '''  const directBuyerStartUrl = buildSquareBuyerStartUrl({
    locationId,
    serviceItemId,
    target
  });

  console.log("[SQUARE] Direct booking buyer start", {
    serviceItemId,
    buyerStartUrl: directBuyerStartUrl
  });

  const availabilityPayload = await fetchSquareAvailabilityInBrowser({
    bookingUrl: context.directBookingUrl || target.bookingUrl || "",
    buyerStartUrl:
      directBuyerStartUrl ||
      context.directBookingUrl ||
      target.bookingUrl ||
      "",
    payload: null,
    serviceName,
    staffProfiles: [],
    timeoutMs: Math.max(Number(target.squareTimeoutMs || 20000), 35000)
  });'''

if old_direct in src:
    src = src.replace(old_direct, new_direct)

old_service = '''    if (serviceName) {
      const escaped = serviceName.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&");
      const servicePattern = new RegExp(escaped, "i");

      if (
        (await clickButton(servicePattern, `service-button:${serviceName}`)) ||
        (await clickText(servicePattern, `service-text:${serviceName}`))
      ) {
        result = await waitForNative(3500);
        if (result) return result;
      }
    }'''

new_service = '''    if (serviceName) {
      const serviceCandidates = unique([
        String(serviceName).trim(),
        String(serviceName).split("|")[0].trim(),
        String(serviceName)
          .replace(/\\b\\d+\\s*(?:hr|hrs|hour|hours|min|mins|minute|minutes)\\b/gi, "")
          .replace(/[|\\-–—]+\\s*$/g, "")
          .trim()
      ]).filter(Boolean);

      for (const candidateName of serviceCandidates) {
        const escaped = candidateName.replace(
          /[.*+?^${}()|[\\]\\\\]/g,
          "\\\\$&"
        );
        const servicePattern = new RegExp(escaped, "i");

        if (
          (await clickButton(
            servicePattern,
            `service-button:${candidateName}`
          )) ||
          (await clickText(
            servicePattern,
            `service-text:${candidateName}`
          ))
        ) {
          result = await waitForNative(3500);
          if (result) return result;
          break;
        }
      }
    }'''

if old_service in src:
    src = src.replace(old_service, new_service)

for marker in [
    "target.integrationConfig",
    "const directBuyerStartUrl = buildSquareBuyerStartUrl",
]:
    if marker not in src:
        raise SystemExit(f"Patch marker missing after edit: {marker}")

SQUARE.write_text(src)
print("[PATCHED] scrapers/square.js")
print("Run: python3 scripts/verify-square-v5-live-errors-hotfix.py")