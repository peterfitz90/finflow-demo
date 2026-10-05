-- Rollback for supabase/mcp_reader_role.sql: removes every privilege granted to mcp_reader and the
-- role itself. mcp_reader owns no objects, so DROP OWNED only revokes its grants.
-- On Postgres 16+, DROP OWNED needs the caller to hold mcp_reader's privileges; postgres only has
-- ADMIN over the role it created, so grant membership first (the DROP ROLE removes it again).
grant mcp_reader to postgres;
drop owned by mcp_reader;
drop role mcp_reader;
