-- Month projection block: the current month and the previous three, day by day, plus who is referring this month.
-- Rows (all text): g, k, v1..v7.
--   'day'      k = date. v1 signups (all campaigns, {{EXCLUDED}}), v2 distinct referrers, v3 referral onboardings (target definition,
--              {{ALWAYS_EXCLUDED}} only), v4 referral activations (same definition), v5 gold coins claimed ({{GOLD_CAMPAIGN_ID}}),
--              v6 signups tagged to the gold coin campaign, v7 first-ever referrers (first referral that day).
--   'group'    k = pinned_first | pinned_repeat | open_first | open_repeat: referrers this month by whether they were pinned to the gold
--              coin campaign before it opened to everyone, and whether this month holds their first ever referral.
--              v1 referrers, v2 signups, v3 onboarded, v4 achieved, v5 referrers with a coin claimed this month.
--   'tag'      k = campaign id of this month's signups. v1 signups, v2 referrers, v3 campaign name.
--   'pipeline' k = all. v1 gold coin referrers with an onboarded referee waiting to pay and no coin yet, v2 onboarded referees waiting,
--              v3 gold coin referrers with signups but nobody onboarded yet, v4 their signups, v5 coins claimed in total,
--              v6 referrers (campaign total) without a coin, v7 their signups.
WITH today AS (SELECT (now() AT TIME ZONE 'Asia/Kolkata')::date d),
m AS (SELECT date_trunc('month', d)::date m0, (date_trunc('month', d) - INTERVAL '3 months')::date m3 FROM today),
rr AS (
  SELECT r.campaign_id, r.referrer_exporter_id ref, r.referee_exporter_id referee, r.referral_state::text st,
         (r.referral_date AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')::date sd
  FROM referral_relation r
  WHERE r.is_deleted = false AND r.referrer_exporter_id IS NOT NULL AND r.referrer_exporter_id NOT IN ({{EXCLUDED}})
    AND r.referral_state IN ('SIGNUP_COMPLETE','ONBOARDING_COMPLETE','ACHIEVED')
),
firsts AS (SELECT ref, MIN(sd) first_sd FROM rr GROUP BY 1),
rd AS (
  SELECT DISTINCT ON (referee_exporter_id) referee_exporter_id referee FROM referral_relation
  WHERE referral_state IN ('ONBOARDING_COMPLETE','ACHIEVED') AND is_deleted = false
    AND referrer_exporter_id IS NOT NULL AND referrer_exporter_id NOT IN ({{ALWAYS_EXCLUDED}})
  ORDER BY referee_exporter_id, referral_date
),
ob AS (SELECT exporter_id, MIN(created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')::date fo FROM cc_account GROUP BY 1),
act AS (SELECT exporter_id, MIN(settlement_date AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')::date fa
        FROM public."transaction" WHERE transaction_state = 'EXPORTER_SUCCESS' GROUP BY 1),
robs AS (SELECT ob.fo d, COUNT(*) n FROM rd JOIN ob ON ob.exporter_id = rd.referee, m WHERE ob.fo >= m.m3 GROUP BY 1),
racts AS (SELECT act.fa d, COUNT(*) n FROM rd JOIN act ON act.exporter_id = rd.referee, m WHERE act.fa >= m.m3 GROUP BY 1),
coins AS (SELECT (claimed_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')::date d, referrer_exporter_id ref FROM referral_milestone_claim
          WHERE campaign_id = {{GOLD_CAMPAIGN_ID}} AND is_deleted = false AND status = 'CLAIMED' AND referrer_exporter_id NOT IN ({{EXCLUDED}})),
days AS (SELECT g::date d FROM m, today, generate_series(m.m3, today.d, INTERVAL '1 day') g),
p AS (SELECT exporter_id FROM user_referral_data WHERE pinned_campaign_id = {{GOLD_CAMPAIGN_ID}} AND is_deleted = false),
mrr AS (SELECT rr.*, EXISTS (SELECT 1 FROM p WHERE p.exporter_id = rr.ref) pinned, f.first_sd >= m.m0 first_month FROM rr JOIN firsts f USING (ref), m WHERE rr.sd >= m.m0),
gref AS (SELECT ref, COUNT(*) signups, COUNT(*) FILTER (WHERE st IN ('ONBOARDING_COMPLETE','ACHIEVED')) onboarded, COUNT(*) FILTER (WHERE st = 'ACHIEVED') achieved,
                EXISTS (SELECT 1 FROM coins c WHERE c.ref = rr.ref) coin
         FROM rr WHERE campaign_id = {{GOLD_CAMPAIGN_ID}} GROUP BY 1)
SELECT 'day' g, d::text k, (SELECT COUNT(*) FROM rr WHERE sd = d)::text v1, (SELECT COUNT(DISTINCT ref) FROM rr WHERE sd = d)::text v2,
  COALESCE((SELECT n FROM robs WHERE robs.d = days.d), 0)::text v3, COALESCE((SELECT n FROM racts WHERE racts.d = days.d), 0)::text v4,
  (SELECT COUNT(*) FROM coins WHERE coins.d = days.d)::text v5, (SELECT COUNT(*) FROM rr WHERE sd = d AND campaign_id = {{GOLD_CAMPAIGN_ID}})::text v6,
  (SELECT COUNT(*) FROM firsts WHERE first_sd = d)::text v7
FROM days
UNION ALL
SELECT 'group', (CASE WHEN pinned THEN 'pinned' ELSE 'open' END) || '_' || (CASE WHEN first_month THEN 'first' ELSE 'repeat' END),
  COUNT(DISTINCT ref)::text, COUNT(*)::text, COUNT(*) FILTER (WHERE st IN ('ONBOARDING_COMPLETE','ACHIEVED'))::text, COUNT(*) FILTER (WHERE st = 'ACHIEVED')::text,
  (SELECT COUNT(DISTINCT c.ref) FROM coins c, m WHERE c.d >= m.m0 AND c.ref IN (SELECT ref FROM mrr x WHERE x.pinned = mrr.pinned AND x.first_month = mrr.first_month))::text, NULL, NULL
FROM mrr GROUP BY pinned, first_month
UNION ALL
SELECT 'tag', campaign_id::text, COUNT(*)::text, COUNT(DISTINCT ref)::text, (SELECT name FROM referral_campaign c WHERE c.id = mrr.campaign_id), NULL, NULL, NULL, NULL
FROM mrr GROUP BY campaign_id
UNION ALL
SELECT 'pipeline', 'all', COUNT(*) FILTER (WHERE NOT coin AND onboarded > achieved)::text, SUM(onboarded - achieved)::text,
  COUNT(*) FILTER (WHERE onboarded = 0)::text, SUM(signups) FILTER (WHERE onboarded = 0)::text, (SELECT COUNT(*) FROM coins)::text,
  COUNT(*) FILTER (WHERE NOT coin)::text, SUM(signups) FILTER (WHERE NOT coin)::text
FROM gref
ORDER BY 1, 2;
