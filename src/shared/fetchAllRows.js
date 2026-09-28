// PostgREST silently caps every response at 1,000 rows (HTTP 206, no error) and clamps any
// .range()/.limit() above that too — so a query that can match more rows must page through.
// `build` returns a FRESH query builder each call (one can't be re-ranged once awaited), and
// must carry a total order ending in a unique column (e.g. .order('date').order('id')) or rows
// can be skipped/duplicated across page boundaries. Stops on an empty page rather than a short
// one, so it stays correct even if the server cap is ever set below PAGE_SIZE. Returns
// { data, error } like a single supabase-js call.
//
// `max` (optional) is a deliberate UI cap — stop once that many rows are in hand, the way a
// .limit(max) was *meant* to behave before the server silently clamped it to 1,000.
const PAGE_SIZE = 1000;

export async function fetchAllRows(build, { max = Infinity } = {}) {
  const all = [];
  for (let from = 0; all.length < max; ) {
    const size = Math.min(PAGE_SIZE, max - all.length);
    const { data, error } = await build().range(from, from + size - 1);
    if (error) return { data: null, error };
    if (!data || !data.length) break;
    all.push(...data);
    from += data.length;
  }
  return { data: all, error: null };
}
