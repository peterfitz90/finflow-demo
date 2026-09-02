-- One-off audit: find Revolut-import bank_transactions rows whose dates may have been
-- imported with day/month swapped by the old parseRevolutCSV bug (fixed in App.jsx).
-- Read-only. Run in the Supabase SQL editor and review results manually — do not auto-fix.
--
-- Logic: for each Revolut import batch, rows were inserted in CSV order (which Revolut
-- exports date-ordered). If the stored `date` sequence has many backward jumps relative
-- to insertion order, the batch likely got its day/month swapped for some rows.

with company as (
  select id, name from companies where name ilike '%kota%'
),
ordered as (
  select
    bt.id,
    bt.company_id,
    c.name as company_name,
    bt.import_batch_id,
    bt.date,
    bt.description,
    bt.amount,
    bt.created_at,
    row_number() over (partition by bt.import_batch_id order by bt.created_at, bt.id) as rn,
    lag(bt.date) over (partition by bt.import_batch_id order by bt.created_at, bt.id) as prev_date
  from bank_transactions bt
  join company c on c.id = bt.company_id
  where bt.bank_format = 'revolut'
)
select
  company_name,
  import_batch_id,
  count(*) as rows_in_batch,
  count(*) filter (where date < prev_date) as backward_jumps,
  round(100.0 * count(*) filter (where date < prev_date) / greatest(count(*) - 1, 1), 1) as backward_pct,
  min(date) as earliest,
  max(date) as latest
from ordered
group by company_name, import_batch_id
having count(*) filter (where date < prev_date) > 0
order by backward_pct desc;

-- Then, for any batch flagged above, pull the individual ambiguous rows (day<=12 and
-- month<=12, so a day/month swap is even possible) for manual review:
--
-- select id, date, to_char(date,'YYYY') || '-' || to_char(date,'DD') || '-' || to_char(date,'MM') as swapped_alt,
--        description, amount, created_at
-- from bank_transactions
-- where import_batch_id = '<flagged-batch-id>'
--   and extract(day from date) <= 12
-- order by created_at;
