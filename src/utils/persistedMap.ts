/*
Helper for react-query data that is logically a Map.

The query cache is persisted to localStorage (see persistQueryClient in
main.tsx) with plain JSON.stringify, and `JSON.stringify(new Map(...))` is
`"{}"` — the contents are silently dropped and the rehydrated value is a plain
object with no `.get`. So a queryFn must return entry pairs and the consumer
rebuilds the Map.

The Array.isArray guard matters for more than loading state: a cache entry
written before the queryFn started returning entries deserializes as `{}`, and
`new Map({})` throws "object is not iterable". Treating anything that is not an
array as empty lets a stale entry expire and refetch instead of breaking the
render.
*/
// `entries` is deliberately `unknown`: the whole point is that rehydrated cache
// data cannot be trusted to match its declared type. The key/value types come
// from `emptyValue`, and Array.isArray is the runtime trust boundary.
export function mapFromEntries<K, V>(
  entries: unknown,
  emptyValue: Map<K, V>
): Map<K, V> {
  if (!Array.isArray(entries)) return emptyValue;
  return new Map(entries as readonly (readonly [K, V])[]);
}
