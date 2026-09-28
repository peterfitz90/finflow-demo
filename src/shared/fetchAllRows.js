// PostgREST silently caps every response at 1,000 rows (HTTP 206, no error) and clamps any
// .range()/.limit() above that too — so a query that can match more rows must page through.
// `build` returns a FRESH query builder each call (one can't be re-ranged once awaited), and
// must carry a total order ending in a unique column (e.g. .order('date').order('id')) or rows
// can be skipped/duplicated across page boundaries. Stops on an empty page rather than a short
// one, so it stays correct even if the server cap is ever set below PAGE_SIZE. Returns
// { data, error } like a single supabase-js call.
const PAGE_SIZE = 1000;

export async function fetchAllRows(build) {
  const all = [];
  for (let from = 0; ; ) {
    const { data, error } = await build().range(from, from + PAGE_SIZE - 1);
    if (error) return { data: null, error };
    if (!data || !data.length) return { data: all, error: null };
    all.push(...data);
    from += data.length;
  }
}
