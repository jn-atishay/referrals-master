-- Cohort grid: every onboarded exporter placed in one cell per month (columns 1-6 by product stage, rows A / Ba / Bb by referral history),
-- from June 2025 to the current month. Same definitions as the Oct 2026 cohort analysis:
--   1 Active: activated before month start, a settled payment in this month or last.   2 New activations: first settled payment this month.
--   3 Dormant: activated before, no payment this month or last, one 2 or 3 months ago.    4 Churned: activated before, none in the last four months.
--   5 Not activated, old onboarder: no settlement by month end, onboarded before last month.   6 Not activated, new onboarder: onboarded this month or last.
--   A: no referral before month start.  Ba: at least one referral ACHIEVED before month start.  Bb: referred before but no achieved referral.
-- Referrer = at least one referral dated in the month. Referrer activity excludes {{EXCLUDED}}; the base excludes {{ALWAYS_EXCLUDED}} only. Payees stay in.
-- Rows (text): month, code, base, referrers in the month, referrers in the first N days (N = full days elapsed this month, for like-for-like reads).
-- Extra codes 1A:new / 1A:mid / 1A:old split 1A by months since first payment at month start (under 6, 6 to 12, 12+).
WITH today AS (SELECT (now() AT TIME ZONE 'Asia/Kolkata')::date d),
n AS (SELECT EXTRACT(day FROM d)::int - 1 full_days, date_trunc('month', d)::date m0 FROM today),
months AS (SELECT g::date ms FROM n, generate_series(DATE '2025-06-01', n.m0, INTERVAL '1 month') g),
ob AS (SELECT exporter_id, MIN(created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')::date fo FROM cc_account WHERE exporter_id NOT IN ({{ALWAYS_EXCLUDED}}) GROUP BY 1),
act AS (SELECT exporter_id, MIN(settlement_date AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')::date fa FROM public."transaction" WHERE transaction_state = 'EXPORTER_SUCCESS' GROUP BY 1),
txm AS (SELECT DISTINCT exporter_id, date_trunc('month', settlement_date AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')::date ms
        FROM public."transaction" WHERE transaction_state = 'EXPORTER_SUCCESS' AND settlement_date >= DATE '2025-01-01'),
tx_active AS (SELECT DISTINCT exporter_id, (ms + (i || ' month')::interval)::date ms FROM txm, generate_series(0, 1) i),
tx_dorm AS (SELECT DISTINCT exporter_id, (ms + (i || ' month')::interval)::date ms FROM txm, generate_series(2, 3) i),
rr AS (SELECT referrer_exporter_id ref, (referral_date AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')::date sd, id
       FROM referral_relation WHERE is_deleted = false AND referrer_exporter_id IS NOT NULL AND referrer_exporter_id NOT IN ({{EXCLUDED}})
         AND referral_state IN ('SIGNUP_COMPLETE','ONBOARDING_COMPLETE','ACHIEVED')),
ref_first AS (SELECT ref, MIN(sd) first_sd FROM rr GROUP BY 1),
ach_first AS (SELECT rr.ref, MIN(t.action_timestamp AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')::date first_ach
              FROM referral_milestone_tracking t JOIN rr ON rr.id = t.referral_relation_id WHERE t.is_deleted = false AND t.referral_state = 'ACHIEVED' GROUP BY 1),
refm AS (SELECT ref, date_trunc('month', sd)::date ms, MIN(EXTRACT(day FROM sd))::int first_day FROM rr GROUP BY 1, 2),
cells AS (
  SELECT m.ms, ob.exporter_id,
    CASE WHEN a.fa < m.ms THEN (CASE WHEN ta.exporter_id IS NOT NULL THEN 1 WHEN td.exporter_id IS NOT NULL THEN 3 ELSE 4 END)
         WHEN a.fa >= m.ms AND a.fa < m.ms + INTERVAL '1 month' THEN 2
         WHEN ob.fo >= m.ms - INTERVAL '1 month' THEN 6 ELSE 5 END col,
    CASE WHEN rf.first_sd IS NULL OR rf.first_sd >= m.ms THEN 'A' WHEN af.first_ach IS NOT NULL AND af.first_ach < m.ms THEN 'Ba' ELSE 'Bb' END row_,
    CASE WHEN a.fa < m.ms THEN (CASE WHEN a.fa >= m.ms - INTERVAL '6 months' THEN 'new' WHEN a.fa >= m.ms - INTERVAL '12 months' THEN 'mid' ELSE 'old' END) END tenure,
    (rm.ref IS NOT NULL) referred, (rm.first_day <= n.full_days) referred_n
  FROM months m CROSS JOIN n
  JOIN ob ON ob.fo < m.ms + INTERVAL '1 month'
  LEFT JOIN act a ON a.exporter_id = ob.exporter_id
  LEFT JOIN tx_active ta ON ta.exporter_id = ob.exporter_id AND ta.ms = m.ms
  LEFT JOIN tx_dorm td ON td.exporter_id = ob.exporter_id AND td.ms = m.ms
  LEFT JOIN ref_first rf ON rf.ref = ob.exporter_id
  LEFT JOIN ach_first af ON af.ref = ob.exporter_id
  LEFT JOIN refm rm ON rm.ref = ob.exporter_id AND rm.ms = m.ms
)
SELECT to_char(ms, 'YYYY-MM') AS ym, col::text || row_ code, COUNT(*)::text base, COUNT(*) FILTER (WHERE referred)::text refs, COUNT(*) FILTER (WHERE referred_n)::text refs_n
FROM cells GROUP BY 1, 2
UNION ALL
SELECT to_char(ms, 'YYYY-MM'), '1A:' || tenure, COUNT(*)::text, COUNT(*) FILTER (WHERE referred)::text, COUNT(*) FILTER (WHERE referred_n)::text
FROM cells WHERE col = 1 AND row_ = 'A' GROUP BY 1, 2
ORDER BY 1, 2;
