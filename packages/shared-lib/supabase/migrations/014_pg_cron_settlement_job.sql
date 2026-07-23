-- Sunday 10 PM IST = 16:30 UTC
SELECT cron.schedule(
  'weekly-worker-settlements',
  '30 16 * * 0',
  $$
    UPDATE settlement_ledger
    SET status = 'PROCESSING',
        week_end_date = CURRENT_DATE
    WHERE status = 'PENDING';
  $$
);
