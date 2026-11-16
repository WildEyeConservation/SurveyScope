export type CacheEntry = { data: unknown; fetchedAt: string };

export type ReportCache = {
  get: (key: string) => Promise<CacheEntry | undefined>;
  set: (key: string, entry: CacheEntry) => void;
  delete: (key: string) => void;
  keys: () => string[];
};

const DATABASE = 'survey-metrics-cache';
const STORE = 'entries';
const SCOPE_KEY = '__scope';
// Bump when the shape of stored data changes, to drop what is stored.
const VERSION = 3;

function settle<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function openDatabase(): Promise<IDBDatabase> {
  const open = indexedDB.open(DATABASE, 1);
  open.onupgradeneeded = () => open.result.createObjectStore(STORE);
  return settle(open);
}

// Stores one scope in the browser; opening another scope drops the last one.
export async function openReportCache(scope: string): Promise<ReportCache> {
  const memory = new Map<string, CacheEntry>();
  const stored = new Set<string>();
  let database: IDBDatabase | null = null;

  const entries = (mode: IDBTransactionMode) =>
    database!.transaction(STORE, mode).objectStore(STORE);

  try {
    database = await openDatabase();
    const marker = `${VERSION}:${scope}`;
    if ((await settle(entries('readonly').get(SCOPE_KEY))) !== marker) {
      const store = entries('readwrite');
      store.clear();
      await settle(store.put(marker, SCOPE_KEY));
    }
    for (const key of await settle(entries('readonly').getAllKeys())) {
      if (key !== SCOPE_KEY) stored.add(String(key));
    }
  } catch (error) {
    console.warn('Survey metrics data will not be kept after a reload', error);
    database = null;
  }

  const write = (run: (store: IDBObjectStore) => void) => {
    if (!database) return;
    try {
      const transaction = database.transaction(STORE, 'readwrite');
      transaction.onabort = () =>
        console.warn('Could not store survey metrics data', transaction.error);
      run(transaction.objectStore(STORE));
    } catch (error) {
      console.warn('Could not store survey metrics data', error);
    }
  };

  return {
    get: async (key) => {
      const held = memory.get(key);
      if (held || !stored.has(key)) return held;
      try {
        const entry = (await settle(entries('readonly').get(key))) as
          CacheEntry | undefined;
        // Skipped if the key was dropped or replaced while reading.
        if (entry && stored.has(key) && !memory.has(key)) {
          memory.set(key, entry);
        }
        return memory.get(key);
      } catch (error) {
        console.warn('Could not read stored survey metrics data', error);
        return undefined;
      }
    },
    set: (key, entry) => {
      memory.set(key, entry);
      stored.delete(key);
      write((store) => store.put(entry, key));
    },
    delete: (key) => {
      memory.delete(key);
      stored.delete(key);
      write((store) => store.delete(key));
    },
    keys: () => [...new Set([...memory.keys(), ...stored])],
  };
}
