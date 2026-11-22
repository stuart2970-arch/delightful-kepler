-- STYL-312: explicit voice_minutes on legacy tiers (Foundation cap, never unlimited).
-- Safe to apply on staging/production; does not mutate tenant rows.

INSERT INTO public.tier_entitlements (tier_id, feature_id, limit_value)
SELECT legacy.tier_id, 'voice_minutes', foundation.limit_value
FROM (VALUES
  ('basic'),
  ('starter'),
  ('premium'),
  ('ultimate')
) AS legacy(tier_id)
CROSS JOIN LATERAL (
  SELECT te.limit_value
  FROM public.tier_entitlements te
  WHERE te.feature_id = 'voice_minutes'
    AND te.tier_id IN ('foundation', 'base_tier')
  ORDER BY CASE te.tier_id WHEN 'foundation' THEN 0 ELSE 1 END
  LIMIT 1
) AS foundation
ON CONFLICT (tier_id, feature_id) DO UPDATE
SET limit_value = EXCLUDED.limit_value
WHERE public.tier_entitlements.limit_value IS DISTINCT FROM EXCLUDED.limit_value
  AND (
    public.tier_entitlements.limit_value IS NULL
    OR public.tier_entitlements.limit_value < 0
  );

-- Reviewed, idempotent tenant normalisation for the four live `ultimate` workspaces (run manually after PO sign-off):
-- UPDATE public.tenants
-- SET plan_tier = 'foundation'
-- WHERE plan_tier = 'ultimate';