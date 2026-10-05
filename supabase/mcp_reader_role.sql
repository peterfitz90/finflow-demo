-- INT-01 Stage 1: mcp_reader, the read-only login role the MCP server will use. Every query runs
-- inside a transaction that sets request.jwt.claims to the verified Clerk user, so the existing RLS
-- policies (all written TO public, keyed on auth.jwt()->>'sub') decide which rows it sees.
--
-- No password here. It is set separately, only ever from a SCRAM-SHA-256 verifier computed locally,
-- because log_statement = 'ddl' would write a plaintext PASSWORD clause into the Postgres logs. The
-- real credential is set later, by Peter, in Vercel.
--
-- Rollback: supabase/mcp_reader_role_rollback.sql (DROP OWNED BY mcp_reader; DROP ROLE mcp_reader;)

create role mcp_reader with
  login nosuperuser nocreatedb nocreaterole noreplication nobypassrls noinherit
  connection limit 5;
-- A member of no other role: nothing is granted TO mcp_reader below except object privileges.

-- Guard rails on every session.
alter role mcp_reader set statement_timeout = '15s';
alter role mcp_reader set idle_in_transaction_session_timeout = '30s';
alter role mcp_reader set default_transaction_read_only = on;   -- belt and braces; grants are SELECT-only anyway

grant usage on schema public to mcp_reader;

-- SELECT only, column by column, limited to what the seven v1 tools read.
-- Excluded on purpose: companies.inbound_token (AP mailbox secret), companies.mailbox_slug, clerk ids;
-- bank_accounts.bank_connection_id / external_account_id; ap_invoices.raw_email_id / attachment_path;
-- expenses.receipt_image_url / receipt_text / submitted_by_clerk_id. Whole tables not granted include
-- bank_connections and provider_connections (credentials / consent tokens), customers,
-- user_company_access, period_lock_events and everything else not listed.
grant select (id, name, company_type, vat_registered, vat_number, vat_period, period_start,
              year_end_month, ard_month, ard_day, paye_registered, rct_registered, cro_number,
              currency, base_currency, ros_efiler, sales_vat_rate, frs_regime, plan)
  on public.companies to mcp_reader;
grant select (id, company_id, date, description, reference, debit_account, credit_account, amount, vat_code)
  on public.journals to mcp_reader;
grant select (id, company_id, code, name, account_type, category, is_active, default_vat_code)
  on public.chart_of_accounts to mcp_reader;
grant select (id, company_id, display_name, nominal_code, currency, is_active, feed_balance, feed_balance_synced_at)
  on public.bank_accounts to mcp_reader;
grant select (id, company_id, type, customer_id, client, invoice_number, invoice_ref, status, total,
              amount_paid, subtotal, vat_total, currency, issue_date, invoice_date, due_date, due_date_calc,
              credit_note_for)
  on public.invoices to mcp_reader;
grant select (id, invoice_id, vat_code, line_total, vat_amount, gross_total)
  on public.invoice_lines to mcp_reader;
grant select (id, company_id, invoice_ref, supplier, invoice_date, due_date, status, amount, net_amount,
              vat_amount, gross_amount, vat_code, amount_paid)
  on public.ap_invoices to mcp_reader;
grant select (id, company_id, date, description, amount, settlement_type, reconciled)
  on public.bank_transactions to mcp_reader;
grant select (id, company_id, supplier, description, receipt_date, amount, status)
  on public.expenses to mcp_reader;
grant select (id, company_id, period_val, period_start, period_end, status, filed_at, superseded_at, t1, t2, t3, t4)
  on public.vat_returns to mcp_reader;

-- Functions. RLS policies call user_company_ids() / user_is_accountant(); those have PUBLIC execute
-- today, granted explicitly here so the role keeps working if that changes.
grant execute on function public.user_company_ids()                       to mcp_reader;
grant execute on function public.user_is_accountant(uuid)                 to mcp_reader;
grant execute on function public.nominal_balance_as_of(uuid, text[], date) to mcp_reader;
grant execute on function public.get_locked_periods(uuid)                 to mcp_reader;
grant execute on function public.search_invoices(uuid, text)              to mcp_reader;
grant execute on function public.search_journals(uuid, text)              to mcp_reader;
grant execute on function public.search_bank_transactions(uuid, text)     to mcp_reader;
-- Not granted: search_customers (returns customer emails and phone numbers; v1 needs only names,
-- which invoices.client already carries).
