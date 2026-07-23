-- Migration 047: Automate Worker Categories Sync and Management by Keyword/Skills matching

-- 1. Keyword/Skills matching engine function
CREATE OR REPLACE FUNCTION sync_worker_categories_by_skills(p_worker_id UUID)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE
  v_skills TEXT[];
  v_category_ids UUID[];
BEGIN
  -- Fetch worker skills from profile
  SELECT skills INTO v_skills
  FROM worker_profiles
  WHERE worker_id = p_worker_id;
  
  -- If worker has no skills, set categories to empty
  IF v_skills IS NULL OR array_length(v_skills, 1) IS NULL THEN
    UPDATE workers
    SET service_category_ids = '{}'::uuid[]
    WHERE id = p_worker_id;
    RETURN;
  END IF;

  -- Match categories if the stem word (first 4 letters) of any skill matches the category name
  SELECT COALESCE(array_agg(id), '{}'::uuid[]) INTO v_category_ids
  FROM service_categories cat
  WHERE EXISTS (
    SELECT 1 FROM unnest(v_skills) AS skill
    WHERE LOWER(skill) LIKE '%' || LOWER(cat.name) || '%'
       OR LOWER(cat.name) LIKE '%' || LOWER(skill) || '%'
       OR (length(skill) >= 4 AND length(cat.name) >= 4 AND substring(LOWER(skill) from 1 for 4) = substring(LOWER(cat.name) from 1 for 4))
  );

  -- Update worker's approved category IDs
  UPDATE workers
  SET service_category_ids = v_category_ids
  WHERE id = p_worker_id;
END;
$$;

-- 2. Trigger: Sync when worker profile skills are edited
CREATE OR REPLACE FUNCTION trg_fn_sync_categories_on_profile_change()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM sync_worker_categories_by_skills(NEW.worker_id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_categories_on_profile_change ON worker_profiles;
CREATE TRIGGER trg_sync_categories_on_profile_change
AFTER INSERT OR UPDATE OF skills ON worker_profiles
FOR EACH ROW
EXECUTE FUNCTION trg_fn_sync_categories_on_profile_change();

-- 3. Trigger: Sync when a worker's KYC is approved
CREATE OR REPLACE FUNCTION trg_fn_sync_categories_on_worker_approve()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.kyc_status = 'APPROVED' AND (OLD.kyc_status IS NULL OR OLD.kyc_status != 'APPROVED') THEN
    PERFORM sync_worker_categories_by_skills(NEW.id);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_categories_on_worker_approve ON workers;
CREATE TRIGGER trg_sync_categories_on_worker_approve
AFTER UPDATE OF kyc_status ON workers
FOR EACH ROW
EXECUTE FUNCTION trg_fn_sync_categories_on_worker_approve();

-- 4. Trigger: Sync when a new service category is created
CREATE OR REPLACE FUNCTION trg_fn_sync_categories_on_new_category()
RETURNS TRIGGER AS $$
DECLARE
  v_worker_rec RECORD;
BEGIN
  FOR v_worker_rec IN SELECT id FROM workers WHERE kyc_status = 'APPROVED' LOOP
    PERFORM sync_worker_categories_by_skills(v_worker_rec.id);
  END FOR;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_categories_on_new_category ON service_categories;
CREATE TRIGGER trg_sync_categories_on_new_category
AFTER INSERT ON service_categories
FOR EACH ROW
EXECUTE FUNCTION trg_fn_sync_categories_on_new_category();

-- 5. Backfill existing approved workers
DO $$
DECLARE
  v_worker_rec RECORD;
BEGIN
  FOR v_worker_rec IN SELECT id FROM workers WHERE kyc_status = 'APPROVED' LOOP
    PERFORM sync_worker_categories_by_skills(v_worker_rec.id);
  END FOR;
END $$;

-- 6. Ensure all approved workers have active accounts and starting wallets
UPDATE users
SET is_active = TRUE
WHERE role = 'worker';

UPDATE workers
SET status = 'ONLINE',
    commission_wallet_balance = GREATEST(commission_wallet_balance, 1000.00)
WHERE kyc_status = 'APPROVED';

-- 7. Ensure all customers are active
UPDATE users
SET is_active = TRUE
WHERE role = 'customer';

-- 8. Configure Platform Settings
INSERT INTO platform_settings (key, value)
VALUES 
  ('search_radius_km', '15'),
  ('min_cod_wallet_balance', '500')
ON CONFLICT (key) 
DO UPDATE SET value = EXCLUDED.value;
