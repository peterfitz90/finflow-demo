// Standing anon check: attacks the live API with only the public anon key (the one shipped in the
// app bundle) and fails if anything leaks or any write lands. Run after every migration that
// touches policies, grants, functions, storage or adds a table:
//
//   node --env-file=.env scripts/anon-check.mjs        (ANON_CHECK_VERBOSE=1 lists every check)
//
// Needs VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY. Never prints either. Exit code 1 on FAIL.
//
// Covers, as anon, with and without an x-company-id header naming a real company:
//   - every public table: select (expect 0 rows) and insert (expect an RLS/permission refusal)
//   - every RPC: refused, except the anon_allowed list, which must return its fixed answer
//   - storage, every bucket: list buckets, list objects, read, sign, upload, delete
//   - GraphQL: every collection returns no rows; an insert mutation is refused
// Inserts target the Fitzsimons Test company only, so a regression can never write into a client.
// Tables and functions come from tests/anon/catalog.json plus whatever the live OpenAPI spec
// exposes to anon. Refresh the catalog with CATALOG_SQL below after adding a table or function.
//
// CATALOG_SQL (run as postgres):
//   select json_build_object(
//    'tables', (select json_agg(c.relname order by c.relname) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('r','p')),
//    'views',  (select json_agg(c.relname order by c.relname) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('v','m')),
//    'functions', (select json_agg(json_build_object('name', p.proname, 'args', coalesce((select json_agg(a) from unnest(p.proargnames[1:p.pronargs]) a), '[]'::json)) order by p.proname)
//       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
//       where n.nspname = 'public' and p.prokind = 'f' and p.prorettype <> 'trigger'::regtype
//         and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')),
//    'buckets', (select json_agg(id order by id) from storage.buckets));
import { readFileSync } from 'node:fs';

const URL_ = process.env.VITE_SUPABASE_URL?.replace(/\/$/, '');
const KEY = process.env.VITE_SUPABASE_ANON_KEY;
if (!URL_ || !KEY) { console.error('VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY must be set (node --env-file=.env ...)'); process.exit(2); }

const cat = JSON.parse(readFileSync(new URL('../tests/anon/catalog.json', import.meta.url), 'utf8'));
const TEST_CO = cat.companies.test;
const CLIENT_CO = cat.companies.client;
const HEADER_VARIANTS = [['no header', {}], ['x-company-id test', { 'x-company-id': TEST_CO }], ['x-company-id client', { 'x-company-id': CLIENT_CO }]];

const results = [];
const record = (status, area, target, detail) => results.push({ status, area, target, detail });
const base = { apikey: KEY, Authorization: `Bearer ${KEY}` };

async function call(path, { method = 'GET', headers = {}, body, raw = false } = {}) {
  const h = { ...base, ...headers };
  if (body !== undefined && !raw) h['Content-Type'] = 'application/json';
  const r = await fetch(`${URL_}${path}`, { method, headers: h, body: body === undefined ? undefined : raw ? body : JSON.stringify(body) });
  const text = await r.text();
  let json; try { json = JSON.parse(text); } catch { json = undefined; }
  return { status: r.status, json, text, headers: r.headers };
}
const errCode = r => r.json?.code ?? r.json?.error ?? r.json?.statusCode ?? '';
const short = r => `${r.status} ${errCode(r)} ${(r.json?.message ?? r.json?.msg ?? r.text ?? '').toString().slice(0, 90)}`.trim();
const refused = r => r.status === 401 || r.status === 403 || errCode(r) === '42501';

// ── Discover what anon can see (OpenAPI) ─────────────────────────────────────────────────────
const spec = await call('/rest/v1/', { headers: { Accept: 'application/openapi+json' } });
const specPaths = spec.status === 200 && spec.json?.paths ? Object.keys(spec.json.paths) : [];
const specTables = specPaths.filter(p => p !== '/' && !p.startsWith('/rpc/')).map(p => p.slice(1));
const specRpcs = specPaths.filter(p => p.startsWith('/rpc/')).map(p => p.slice(5));
const columnsOf = t => Object.keys(spec.json?.definitions?.[t]?.properties ?? {});
if (!specPaths.length) record('WARN', 'discovery', 'OpenAPI', `anon spec unavailable (${spec.status}); using catalog only`);

const tables = [...new Set([...cat.tables, ...cat.views, ...specTables])].sort();
for (const t of specTables) if (!cat.tables.includes(t) && !cat.views.includes(t)) record('WARN', 'discovery', t, 'exposed by API but not in catalog.json (tested anyway; refresh the catalog)');
const fnArgs = Object.fromEntries(cat.functions.map(f => [f.name, f.args]));
for (const f of specRpcs) if (!(f in fnArgs)) { record('WARN', 'discovery', f, 'RPC exposed but not in catalog.json (tested with no args)'); fnArgs[f] = []; }

// ── Tables: select and insert ────────────────────────────────────────────────────────────────
for (const t of tables) {
  for (const [label, hdr] of HEADER_VARIANTS) {
    const nullCol = cat.anon_readable?.[t];
    if (nullCol) {
      // Shared reference rows are allowed; every visible row must have no company.
      const r = await call(`/rest/v1/${encodeURIComponent(t)}?select=${nullCol}&limit=10000`, { headers: hdr });
      const leaked = Array.isArray(r.json) ? r.json.filter(row => row[nullCol] !== null).length : null;
      if (leaked === 0) record('PASS', 'select', t, `${label}: ${r.json.length} shared rows (${nullCol} null, allowed), 0 company rows`);
      else if (leaked === null && refused(r)) record('PASS', 'select', t, `${label}: refused ${short(r)}`);
      else record('FAIL', 'select', t, `${label}: ${leaked ?? '?'} rows with ${nullCol} set visible to anon ${leaked === null ? short(r) : ''}`);
      continue;
    }
    const r = await call(`/rest/v1/${encodeURIComponent(t)}?select=*&limit=5`, { headers: { ...hdr, Prefer: 'count=exact' } });
    const total = r.headers.get('content-range')?.split('/')[1];
    if (r.status === 200 && Array.isArray(r.json) && r.json.length === 0 && (total === undefined || total === '0' || total === '*'))
      record('PASS', 'select', t, `${label}: 0 rows`);
    else if (r.status !== 200 && (refused(r) || r.status === 404))
      record('PASS', 'select', t, `${label}: refused ${short(r)}`);
    else
      record('FAIL', 'select', t, `${label}: ${Array.isArray(r.json) ? `${r.json.length} rows returned (total ${total})` : short(r)}`);
  }
  const cols = columnsOf(t);
  const body = cols.length && !cols.includes('company_id') ? {} : { company_id: TEST_CO };
  for (const [label, hdr] of [HEADER_VARIANTS[0], HEADER_VARIANTS[1]]) {
    let r = await call(`/rest/v1/${encodeURIComponent(t)}`, { method: 'POST', headers: { ...hdr, Prefer: 'return=minimal' }, body });
    if (errCode(r) === 'PGRST204') r = await call(`/rest/v1/${encodeURIComponent(t)}`, { method: 'POST', headers: { ...hdr, Prefer: 'return=minimal' }, body: {} });
    if (refused(r)) record('PASS', 'insert', t, `${label}: refused ${short(r)}`);
    else if (r.status >= 200 && r.status < 300) record('FAIL', 'insert', t, `${label}: ROW WRITTEN (${r.status}) into Fitzsimons Test, remove it`);
    else if (['23502', '23503', '23505', '23514'].includes(errCode(r))) record('FAIL', 'insert', t, `${label}: passed RLS, stopped only by a constraint: ${short(r)}`);
    else if (r.status === 404 || r.status === 405) record('PASS', 'insert', t, `${label}: not insertable ${short(r)}`);
    else record('WARN', 'insert', t, `${label}: refused, but not by RLS/permission: ${short(r)}`);
  }
}

// ── RPC endpoints ────────────────────────────────────────────────────────────────────────────
for (const [fn, args] of Object.entries(fnArgs).sort()) {
  const allowed = cat.anon_allowed[fn];
  const body = allowed
    ? Object.fromEntries(Object.entries(allowed.args).map(([k, v]) => [k, v === 'client' ? CLIENT_CO : v === 'test' ? TEST_CO : v]))
    : Object.fromEntries(args.map(a => [a, a === 'p_company_id' ? TEST_CO : null]));
  for (const [label, hdr] of [HEADER_VARIANTS[0], HEADER_VARIANTS[2]]) {
    const r = await call(`/rest/v1/rpc/${fn}`, { method: 'POST', headers: hdr, body });
    if (allowed) {
      const ok = r.status === 200 && JSON.stringify(r.json) === JSON.stringify(allowed.expect);
      record(ok ? 'PASS' : 'FAIL', 'rpc', fn, `${label}: anon-allowed, ${ok ? 'returned expected' : `expected ${JSON.stringify(allowed.expect)}, got ${short(r)}`}`);
    } else if (refused(r)) record('PASS', 'rpc', fn, `${label}: refused ${short(r)}`);
    else if (r.status === 404 && errCode(r) === 'PGRST202') record('WARN', 'rpc', fn, `${label}: signature not matched, permission not exercised (refresh catalog args)`);
    else record('FAIL', 'rpc', fn, `${label}: anon could execute: ${short(r)}`);
  }
}

// ── Storage ──────────────────────────────────────────────────────────────────────────────────
{
  const r = await call('/storage/v1/bucket');
  const n = Array.isArray(r.json) ? r.json.length : null;
  record(n === 0 || (n === null && r.status >= 400) ? 'PASS' : 'FAIL', 'storage', 'list buckets', n === null ? `refused ${short(r)}` : `${n} buckets visible`);
}
const prefixes = ['', `${CLIENT_CO}/`, `ap/${CLIENT_CO}/`, 'logos/', `${TEST_CO}/`, `${TEST_CO}/anon-check/`, 'ap/'];
for (const b of cat.buckets) {
  for (const p of prefixes) {
    const r = await call(`/storage/v1/object/list/${encodeURIComponent(b)}`, { method: 'POST', body: { prefix: p, limit: 100, offset: 0 } });
    const n = Array.isArray(r.json) ? r.json.length : null;
    record(n === 0 || (n === null && r.status >= 400) ? 'PASS' : 'FAIL', 'storage list', `${b}/${p}`, n === null ? `refused ${short(r)}` : `${n} items`);
  }
  const upPath = `${TEST_CO}/anon-check/upload-${Date.now()}.txt`;
  const up = await call(`/storage/v1/object/${encodeURIComponent(b)}/${upPath}`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: 'anon check probe', raw: true });
  record(up.status >= 400 ? 'PASS' : 'FAIL', 'storage upload', `${b}/${upPath}`, up.status >= 400 ? `refused ${short(up)}` : `UPLOADED (${up.status}), remove it`);
  const logo = await call(`/storage/v1/object/${encodeURIComponent(b)}/logos/${TEST_CO}.png`, { method: 'POST', headers: { 'Content-Type': 'image/png', 'x-upsert': 'true' }, body: 'x', raw: true });
  record(logo.status >= 400 ? 'PASS' : 'FAIL', 'storage upsert', `${b}/logos/<test>.png`, logo.status >= 400 ? `refused ${short(logo)}` : `UPLOADED (${logo.status}), remove it`);
}
{
  const { bucket, name } = cat.storage.read_object;
  const get = await call(`/storage/v1/object/${encodeURIComponent(bucket)}/${name}`);
  record(get.status >= 400 ? 'PASS' : 'FAIL', 'storage read', `${bucket}/${name}`, get.status >= 400 ? `refused ${short(get)}` : `DOWNLOADED ${get.text.length} bytes`);
  const pub = await call(`/storage/v1/object/public/${encodeURIComponent(bucket)}/${name}`);
  record(pub.status >= 400 ? 'PASS' : 'FAIL', 'storage read', `public/${bucket}/${name}`, pub.status >= 400 ? `refused ${short(pub)}` : `DOWNLOADED via public URL`);
  const sign = await call(`/storage/v1/object/sign/${encodeURIComponent(bucket)}/${name}`, { method: 'POST', body: { expiresIn: 60 } });
  record(sign.json?.signedURL || sign.json?.signedUrl ? 'FAIL' : 'PASS', 'storage sign', `${bucket}/${name}`, sign.json?.signedURL || sign.json?.signedUrl ? 'SIGNED URL ISSUED' : `refused ${short(sign)}`);
}
{
  const { bucket, name } = cat.storage.delete_target;
  const del = await call(`/storage/v1/object/${encodeURIComponent(bucket)}`, { method: 'DELETE', body: { prefixes: [name] } });
  const n = Array.isArray(del.json) ? del.json.length : null;
  record(n === 0 || (n === null && del.status >= 400) ? 'PASS' : 'FAIL', 'storage delete', `${bucket}/${name}`, n === null ? `refused ${short(del)}` : n === 0 ? '0 removed' : `${n} REMOVED`);
  const del1 = await call(`/storage/v1/object/${encodeURIComponent(bucket)}/${name}`, { method: 'DELETE' });
  record(del1.status >= 400 ? 'PASS' : 'FAIL', 'storage delete', `${bucket}/${name} (single)`, del1.status >= 400 ? `refused ${short(del1)}` : `${del1.status} ${del1.text.slice(0, 80)}`);
}

// ── GraphQL ──────────────────────────────────────────────────────────────────────────────────
{
  const gql = (query, hdr = {}) => call('/graphql/v1', { method: 'POST', headers: hdr, body: { query } });
  const intro = await gql('{ __schema { queryType { fields { name } } mutationType { fields { name } } } }');
  const qFields = intro.json?.data?.__schema?.queryType?.fields?.map(f => f.name) ?? [];
  const mFields = intro.json?.data?.__schema?.mutationType?.fields?.map(f => f.name) ?? [];
  const gqlErr = intro.json?.errors?.[0]?.message;
  if (intro.status !== 200 || gqlErr) record('PASS', 'graphql', 'introspection', `refused ${gqlErr ?? short(intro)}`);
  else record('PASS', 'graphql', 'introspection', `${qFields.length} query fields, ${mFields.length} mutations visible`);
  for (const f of qFields.filter(f => f.endsWith('Collection'))) {
    for (const [label, hdr] of [HEADER_VARIANTS[0], HEADER_VARIANTS[2]]) {
      const r = await gql(`{ ${f}(first: 5) { edges { node { __typename } } } }`, hdr);
      const edges = r.json?.data?.[f]?.edges;
      if (Array.isArray(edges) && edges.length === 0) record('PASS', 'graphql', f, `${label}: 0 rows`);
      else if (!edges) record('PASS', 'graphql', f, `${label}: refused ${(r.json?.errors?.[0]?.message ?? short(r)).slice(0, 90)}`);
      else record('FAIL', 'graphql', f, `${label}: ${edges.length} rows returned`);
    }
  }
  if (mFields.includes('insertIntoInvoicesCollection')) {
    const r = await gql(`mutation { insertIntoInvoicesCollection(objects: [{ companyId: "${TEST_CO}", type: "invoice", status: "draft" }]) { affectedCount } }`, { 'x-company-id': TEST_CO });
    const n = r.json?.data?.insertIntoInvoicesCollection?.affectedCount;
    record(n ? 'FAIL' : 'PASS', 'graphql', 'insertIntoInvoicesCollection', n ? `${n} ROWS WRITTEN into Fitzsimons Test` : `refused ${(r.json?.errors?.[0]?.message ?? short(r)).slice(0, 90)}`);
  }
}

// ── Report ───────────────────────────────────────────────────────────────────────────────────
const by = s => results.filter(r => r.status === s);
for (const r of process.env.ANON_CHECK_VERBOSE ? results : [...by('FAIL'), ...by('WARN')]) console.log(`${r.status}  ${r.area.padEnd(15)} ${r.target}  ${r.detail}`);
const areas = [...new Set(results.map(r => r.area))];
for (const a of areas) {
  const rs = results.filter(r => r.area === a);
  console.log(`${a.padEnd(15)} ${rs.filter(r => r.status === 'PASS').length} pass, ${rs.filter(r => r.status === 'WARN').length} warn, ${rs.filter(r => r.status === 'FAIL').length} fail`);
}
console.log(`\n${by('FAIL').length ? 'FAILED' : 'OK'}: ${results.length} checks, ${by('PASS').length} pass, ${by('WARN').length} warn, ${by('FAIL').length} fail`);
process.exit(by('FAIL').length ? 1 : 0);
