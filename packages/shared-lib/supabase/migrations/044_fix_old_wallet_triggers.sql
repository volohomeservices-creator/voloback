-- Migration 044: Fix old wallet triggers referencing deleted commission_wallet_transactions table

-- 1. Drop the trigger from bookings table
DROP TRIGGER IF EXISTS trg_cod_commission ON bookings;

-- 2. Drop the trigger function
DROP FUNCTION IF EXISTS deduct_cod_commission();
