-- Per-referrer detail for the popup on the Referrers tab. One JSON object keyed by referrer id in column j.
-- Referrer: [name, bt, onboarded, activated, stated_band, tx_count, volume_inr, first_tx, last_tx]
-- Referee rows: [id, name, bt, signup_date, onboarded, activated, stated_band, tx_count, volume_inr, state]
-- Names are blank unless {{SHOW_NAMES}} is true. Never add emails or phone numbers.
WITH rel AS (
  SELECT rr.referrer_exporter_id AS ref, rr.referee_exporter_id AS id, rr.referral_state AS st,
         (rr.referral_date AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')::date AS sd
  FROM referral_relation rr
  WHERE rr.campaign_id = {{CAMPAIGN_ID}} AND rr.is_deleted = false AND rr.referrer_exporter_id IS NOT NULL
    AND rr.referrer_exporter_id NOT IN ({{EXCLUDED}})
),
ids AS (SELECT DISTINCT ref AS id FROM rel UNION SELECT DISTINCT id FROM rel WHERE id IS NOT NULL),
ob AS (SELECT exporter_id AS id, MIN(created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')::date d FROM cc_account WHERE exporter_id IN (SELECT id FROM ids) GROUP BY 1),
tx AS (
  SELECT exporter_id AS id, COUNT(*) n, ROUND(SUM(amount_converted))::bigint vol,
         MIN(settlement_date AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')::date f,
         MAX(settlement_date AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')::date l
  FROM public."transaction" WHERE transaction_state = 'EXPORTER_SUCCESS' AND exporter_id IN (SELECT id FROM ids) GROUP BY 1
),
prof AS (
  SELECT i.id,
    CASE WHEN {{SHOW_NAMES}} THEN COALESCE(initcap((SELECT MIN(full_name) FROM exporter_user u WHERE u.exporter_id = i.id)), '') ELSE '' END AS name,
    CASE e.business_type::text WHEN 'FREELANCER' THEN 'F' WHEN 'SOLE_PROPRIETORSHIP' THEN 'SP' WHEN 'COMPANY' THEN 'C'
      WHEN 'LIMITED_LIABILITY_PARTNERSHIP' THEN 'LLP' WHEN 'PARTNERSHIP' THEN 'PT' WHEN 'HINDU_UNDIVIDED_FAMILY' THEN 'HUF' ELSE '' END AS bt,
    ob.d::text AS obd, tx.f::text AS actd,
    COALESCE((SELECT MIN(d.monthly_revenue::text) FROM exporter_business_description d WHERE d.exporter_id = i.id AND d.is_deleted = false), '') AS band,
    COALESCE(tx.n, 0) AS n, COALESCE(tx.vol, 0) AS vol, tx.f::text AS f, tx.l::text AS l
  FROM ids i LEFT JOIN exporter e ON e.id = i.id LEFT JOIN ob ON ob.id = i.id LEFT JOIN tx ON tx.id = i.id
),
referees AS (
  SELECT r.ref, json_agg(json_build_array(r.id, p.name, p.bt, r.sd::text, p.obd, p.actd, p.band, p.n, p.vol, r.st) ORDER BY r.sd, r.id) AS js
  FROM rel r LEFT JOIN prof p ON p.id = r.id GROUP BY 1
)
SELECT json_object_agg(p.id::text, json_build_array(p.name, p.bt, p.obd, p.actd, p.band, p.n, p.vol, p.f, p.l, rf.js))::text AS j
FROM prof p JOIN referees rf ON rf.ref = p.id;
