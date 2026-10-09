-- $1/$2 local dates; $3 true for reconstruction. Source tables are SELECT-only.
-- Optional metadata comes from JSON so deployment does not require extra columns.
WITH source_rows AS (
 SELECT to_jsonb(a) AS j, 'inventory' AS origin
 FROM appointment_inventory a WHERE a.local_date BETWEEN $1::date AND $2::date
 UNION ALL
 SELECT to_jsonb(a) || jsonb_build_object('appointment_source','confirmed'), 'history'
 FROM confirmed_appointments a WHERE $3::boolean AND a.local_date BETWEEN $1::date AND $2::date
 UNION ALL
 SELECT to_jsonb(a) || jsonb_build_object('appointment_source','inferred'), 'history'
 FROM inferred_appointments a WHERE $3::boolean AND a.local_date BETWEEN $1::date AND $2::date
), matched AS (
 SELECT s.*, bm.id AS business_id, bm.raw_json AS business_json,
   bm.city AS matched_city, bm.state AS matched_state, bm.service_json
 FROM source_rows s
 LEFT JOIN LATERAL (
   SELECT b.id, b.raw_json, loc.city,loc.state,to_jsonb(bs) AS service_json
   FROM businesses b
   LEFT JOIN business_services bs ON bs.business_id=b.id
     AND bs.id::text=s.j->>'business_service_id'
   LEFT JOIN LATERAL (
     SELECT bl.city,bl.state FROM business_locations bl
     WHERE bl.business_id=b.id
       AND (to_jsonb(bs)->>'business_location_id' IS NULL
            OR bl.id::text=to_jsonb(bs)->>'business_location_id')
     -- Never pick an arbitrary city for a business with multiple locations.
     AND (to_jsonb(bs)->>'business_location_id' IS NOT NULL OR
          (SELECT count(*) FROM business_locations x WHERE x.business_id=b.id)=1)
     LIMIT 1
   ) loc ON true
   WHERE bs.id IS NOT NULL OR (
     NOT EXISTS (SELECT 1 FROM business_services known WHERE known.id::text=s.j->>'business_service_id')
     AND lower(b.business_name)=lower(s.j->>'business_name')
     AND (SELECT count(*) FROM businesses x WHERE lower(x.business_name)=lower(s.j->>'business_name'))=1
   )
   ORDER BY (bs.id IS NOT NULL) DESC,b.id LIMIT 1
 ) bm ON true
), normalized AS (
 SELECT
   (j->>'local_date')::date AS appointment_date,
   lower(coalesce(nullif(matched_city,''),nullif(j->>'city',''),
     nullif(business_json->>'city',''),'unmapped')) AS city,
   lower(coalesce(nullif(matched_state,''),nullif(j->>'state',''),
     nullif(business_json->>'state',''),'unmapped')) AS state,
   lower(coalesce(nullif(service_json->>'category_slug',''),nullif(j->>'category_slug',''),
     nullif(j->>'service_category',''),'unmapped')) AS industry,
   coalesce(business_id::text, 'unmapped:'||lower(coalesce(j->>'business_name',''))||':'||coalesce(j->>'booking_url','')) AS business_key,
   -- Natural card identity deliberately ignores scrape-run IDs and confirmed/inferred source.
   jsonb_build_array(coalesce(business_id::text,lower(j->>'business_name')),lower(coalesce(j->>'platform','')),
     lower(coalesce(j->>'service_name','')),lower(coalesce(j->>'service_category','')),
     coalesce(j->>'duration_minutes',''),lower(coalesce(j->>'provider_name','')),
     j->>'local_date',coalesce(j->>'local_time',j->>'appointment_start',''),
     coalesce(j->>'booking_url','')) AS card_key,
   lower(coalesce(j->>'appointment_source',j->>'source_type','unknown')) AS source
 FROM matched
 WHERE ($4::text <> 'daily' OR (j->>'local_time')::time <= (CURRENT_TIMESTAMP AT TIME ZONE 'America/Chicago')::time)
 AND ($3::boolean OR (
     coalesce(j->>'searchable','true')='true'
     AND coalesce(j->>'inventory_status',j->>'status','active') NOT IN ('inactive','expired','archived','deleted')
   ))
), cards AS (
 SELECT appointment_date,city,state,industry,business_key,card_key,
   bool_or(source='confirmed') AS confirmed,
   bool_or(source='inferred') AS inferred,
   count(*) AS raw_rows
 FROM normalized
 GROUP BY appointment_date,city,state,industry,business_key,card_key
)
SELECT appointment_date::text,city,state,industry,
 count(*) FILTER(WHERE confirmed)::text AS confirmed_cards,
 count(*) FILTER(WHERE NOT confirmed AND inferred)::text AS inferred_only_cards,
 count(*) FILTER(WHERE NOT confirmed AND NOT inferred)::text AS unknown_source_cards,
 count(*)::text AS total_cards,
 count(DISTINCT business_key)::text AS businesses_with_cards,
 sum(raw_rows)::text AS raw_rows
FROM cards GROUP BY appointment_date,city,state,industry
ORDER BY appointment_date,city,state,industry
