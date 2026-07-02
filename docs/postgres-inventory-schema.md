# NextAppt PostgreSQL Inventory Schema

Goal: replace results.json appointment storage with PostgreSQL while keeping businesses.json as the current source of business configuration.

Phase 1 tables:
- scrape_runs
- raw_scrape_results
- confirmed_appointments
- inferred_appointments
- appointment_inventory

## Core Principle

PostgreSQL will become the appointment inventory layer only.

For now:
- businesses.json remains the source of truth for business configuration.
- scrapers continue working normally.
- results.json is gradually replaced by PostgreSQL storage.
- /api/search eventually reads from appointment_inventory.

## Table: scrape_runs

Purpose: records every scraper/API execution.

Suggested fields:
- id
- run_started_at
- run_finished_at
- run_status
- trigger_type
- business_name
- platform
- service_name
- service_type
- duration_minutes
- scrape_start_date
- scrape_end_date
- lookahead_hours
- days_forward
- scrape_window_mode
- error_message
- created_at

---

## Table: raw_scrape_results

Purpose:

Stores exactly what each scraper or API returned before any normalization or inference occurs.

This table acts as the permanent audit trail for every scrape.

Suggested fields:

- id
- scrape_run_id
- business_name
- platform
- service_name
- service_type
- duration_minutes
- scrape_start_date
- scrape_end_date
- raw_response_json
- response_size_bytes
- scraper_version
- created_at

Notes:

- Never modify these records.
- Never infer from these records directly.
- Preserve exactly what the CRM or API returned.
- Useful for debugging scraper issues.

---

## Table: confirmed_appointments

Purpose:

Stores normalized appointments generated directly from scrapers or APIs.

These represent real confirmed appointment inventory.

Suggested fields:

- id
- scrape_run_id
- business_name
- platform
- location_id
- service_name
- service_category
- duration_minutes
- provider_name
- booking_url
- appointment_start
- appointment_end
- local_date
- local_time
- timezone
- source_type
- confidence
- created_at
- updated_at

Notes:

- confidence always begins at 1.00
- source_type = confirmed
- Inventory Manager reads from this table.

---

## Table: inferred_appointments

Purpose:

Stores appointments created by the inference engine.

These are never directly scraped.

Suggested fields:

- id
- parent_confirmed_id
- business_name
- platform
- service_name
- service_category
- duration_minutes
- provider_name
- appointment_start
- appointment_end
- inference_type
- confidence
- inference_reason
- created_at
- expires_at

Possible inference types:

- duration
- equivalent_service
- window_expansion
- historical_prediction

Notes:

- Every inferred appointment references the confirmed appointment that created it.
- Confidence depends on inference type.

---

## Table: appointment_inventory

Purpose:

The final searchable inventory.

This is the only table searched by /api/search.

Suggested fields:

- id
- appointment_source
- confirmed_id
- inferred_id
- business_name
- platform
- service_name
- service_category
- duration_minutes
- provider_name
- appointment_start
- appointment_end
- booking_url
- confidence
- inventory_reason
- inventory_horizon
- searchable
- created_at
- updated_at

Notes:

- Scrapers never write directly here.
- Inventory Manager is solely responsible for this table.
- This table represents what users can actually search.

---

# Appointment Lifecycle

Every appointment should move through the following lifecycle:

Scraper/API

↓

raw_scrape_results

↓

Normalization

↓

confirmed_appointments

↓

Inference Engine

↓

inferred_appointments

↓

Inventory Manager

↓

appointment_inventory

↓

/api/search

↓

Website

↓

AI Search

---

# Inventory Horizons

The Inventory Manager should behave differently depending on how far away an appointment is.

## Horizon 1 (0–2 Days)

Goal:

Maximum accuracy.

Strategy:

- Scrape all major durations.
- Prefer APIs when available.
- Minimal duration inference.
- Allow equivalent-service duplication.
- Avoid aggressive window expansion.

## Horizon 2 (3–7 Days)

Goal:

Balanced accuracy and inventory size.

Strategy:

- Scrape anchor durations.
- Duration inference.
- Equivalent-service duplication.
- Moderate window expansion.

## Horizon 3 (8–60 Days)

Goal:

Maximum searchable inventory.

Strategy:

- Scrape only inference anchors.
- Aggressive duration inference.
- Equivalent-service duplication.
- Window expansion.
- Future historical prediction.

---

# Inventory Manager Responsibilities

The Inventory Manager becomes the intelligence layer of NextAppt.

Responsibilities include:

1. Read confirmed appointments.

2. Generate duration inference.

Example:

120

↓

90

↓

60

↓

45

↓

30

3. Generate equivalent-service inventory.

Example:

Deep Tissue

↓

Swedish

when configured in businesses.json.

4. Generate window expansion.

5. Merge overlapping inventory.

6. Deduplicate appointments.

7. Remove stale inventory.

8. Assign confidence scores.

9. Apply horizon-aware inference rules.

10. Publish final searchable inventory.

---

# Confidence Guidelines

Confirmed Appointment

1.00

Equivalent Service

0.97

Duration Inference

0.95

Window Expansion

0.92

Historical Prediction

0.70

Confidence values may evolve over time as real-world accuracy is measured.

---

# Scheduler Evolution

The scheduler should eventually decide:

- What businesses need scraping.
- Which services to scrape.
- Which durations to scrape.
- Which appointments can be inferred.
- Whether API sync is available.
- Which horizon strategy to use.

Decision inputs include:

- inventory horizon
- business configuration
- platform capability
- historical scrape success
- confidence
- API availability

---

# Phase 1 Migration

Keep:

- businesses.json
- current scrapers
- current APIs

Replace:

- results.json

with PostgreSQL.

No frontend changes.

---

# Phase 2

Build the Inventory Manager.

Inventory generation now occurs inside PostgreSQL.

---

# Phase 3

Update /api/search to read from appointment_inventory.

The frontend should require little or no modification.

---

# Phase 4

Move businesses.json into PostgreSQL.

Business Dashboard edits become database updates.

---

# Long-Term Vision

Scrapers become simple data collectors.

The Inventory Manager becomes the intelligence layer of NextAppt.

Every appointment should know:

- where it came from
- why it exists
- how confident it is
- when it expires
- whether it should remain searchable

This architecture supports:

- multiple CRMs
- API integrations
- intelligent inference
- horizon-aware inventory
- confidence scoring
- future prediction
- business analytics
- AI search
- millions of appointments
- expansion into additional cities

without requiring another architectural redesign.