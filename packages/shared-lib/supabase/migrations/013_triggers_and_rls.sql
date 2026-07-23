-- Auto-deduct COD commission from worker wallet on booking completion
CREATE OR REPLACE FUNCTION deduct_cod_commission()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_commission NUMERIC(10,2);
BEGIN
  IF NEW.status = 'COMPLETED' AND NEW.payment_mode = 'COD' THEN
    v_commission := ROUND(NEW.total_amount * 0.15, 2);

    UPDATE workers
    SET commission_wallet_balance = commission_wallet_balance - v_commission
    WHERE id = NEW.worker_id;

    INSERT INTO commission_wallet_transactions
      (worker_id, booking_id, type, amount, balance_after, description)
    SELECT
      NEW.worker_id,
      NEW.id,
      'DEDUCTION',
      v_commission,
      commission_wallet_balance,
      'COD commission 15% for booking ' || NEW.id
    FROM workers WHERE id = NEW.worker_id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_cod_commission
AFTER UPDATE ON bookings
FOR EACH ROW EXECUTE FUNCTION deduct_cod_commission();

-- Auto-update updated_at timestamps
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_bookings_updated_at
BEFORE UPDATE ON bookings
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_workers_updated_at
BEFORE UPDATE ON workers
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Enable Row Level Security on all tables
ALTER TABLE users                          ENABLE ROW LEVEL SECURITY;
ALTER TABLE workers                        ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_categories             ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_items                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE bookings                       ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments                       ENABLE ROW LEVEL SECURITY;
ALTER TABLE settlement_ledger              ENABLE ROW LEVEL SECURITY;
ALTER TABLE commission_wallet_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE worker_location_logs           ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE reviews                        ENABLE ROW LEVEL SECURITY;
-- Granular RLS policies will be added in Phase 2
