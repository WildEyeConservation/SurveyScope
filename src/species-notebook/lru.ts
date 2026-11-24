export class Lru<V> {
  private readonly entries = new Map<string, V>();
  private readonly pins = new Map<string, number>();

  constructor(
    private readonly max: number,
    private readonly onEvict?: (key: string, value: V) => void,
  ) {}

  get size() {
    return this.entries.size;
  }

  peek(key: string): V | undefined {
    return this.entries.get(key);
  }

  get(key: string): V | undefined {
    const value = this.entries.get(key);
    if (value !== undefined) {
      this.entries.delete(key);
      this.entries.set(key, value);
    }
    return value;
  }

  set(key: string, value: V) {
    const old = this.entries.get(key);
    this.entries.delete(key);
    if (old !== undefined && old !== value) this.onEvict?.(key, old);
    this.entries.set(key, value);
    this.trim();
  }

  delete(key: string) {
    const value = this.entries.get(key);
    if (value === undefined) return;
    this.entries.delete(key);
    this.onEvict?.(key, value);
  }

  pin(key: string) {
    this.pins.set(key, (this.pins.get(key) ?? 0) + 1);
  }

  unpin(key: string) {
    const count = (this.pins.get(key) ?? 0) - 1;
    if (count > 0) this.pins.set(key, count);
    else this.pins.delete(key);
    this.trim();
  }

  clear() {
    const all = [...this.entries];
    this.entries.clear();
    for (const [key, value] of all) this.onEvict?.(key, value);
  }

  private trim() {
    if (this.entries.size <= this.max) return;
    const newest = [...this.entries.keys()].pop();
    // Pinned entries are on screen, so they outlive the cap.
    for (const [key, value] of this.entries) {
      if (this.entries.size <= this.max) break;
      if (this.pins.has(key) || key === newest) continue;
      this.entries.delete(key);
      this.onEvict?.(key, value);
    }
  }
}
