# NextAppt Multi-Widget Businesses

This update lets one business own multiple booking widgets and maps each service
to the correct widget. It is backward compatible: businesses with only the
existing top-level `platform` and `bookingUrl` continue to behave as before.

## What changes

- Admin business profiles gain a **Booking Widgets** editor.
- Every service gains a **Booking Widget** selector.
- The targeted manual scraper gains a widget selector and a protected,
  widget-aware endpoint.
- Scheduled and on-demand jobs resolve the widget assigned to each service.
- Cache entries are separated by widget so same-named services do not collide.
- Appointment inventory retains widget identity and the widget-specific booking
  URL.
- Search cards, map links, analytics payloads, and business-page data use the
  appointment/service-specific booking URL.
- Existing `integrations` storage is reused, so no database migration is needed.

## Configure a multi-widget business

1. Open `/admin` and expand the business.
2. Under **Booking Widgets**, add each widget (for example, `Massage` and
   `Acupuncture`). Give each a unique name, platform, and booking URL.
3. Mark one widget as the default fallback.
4. Under **Services**, select the correct Booking Widget for every service.
5. Click **Save Businesses**.
6. In **Admin Controls → Run Targeted Scrape**, select the business, service,
   and widget for a manual verification scrape.

## Install from the repository root

If the ZIP was dragged into the `massage-click-script` folder, run:

```bash
git status
unzip -o nextappt-multi-widget-businesses-2026-09-19.zip
node --check bookingWidgetManager.js
node --check businessManager.js
node --check jobBuilder.js
node --check scrape.js
node --check scrapeRunner.js
node --check cacheManager.js
node --check inventoryManager.js
node --check searchDecisionEngine.js
node --check server.js
node --check public/admin.js
node --check public/app.js
node scripts/verify-multi-widget-update.js
git diff --check
git status
git add bookingWidgetManager.js businessManager.js jobBuilder.js scrape.js scrapeRunner.js cacheManager.js inventoryManager.js searchDecisionEngine.js server.js public/admin.js public/app.js scripts/verify-multi-widget-update.js README-MULTI-WIDGET.md
git commit -m "Add multiple booking widgets per business"
git push origin main
```

Render should deploy automatically after the push. If your service is set to
manual deploy, open the Render service and choose **Manual Deploy → Deploy latest
commit**.

## Rollback

```bash
git revert HEAD
git push origin main
```
