/** Tiny LRU: Map insertion order is the recency order. `onEvict` gets the dropped value (e.g. to destroy a texture). */
export class Lru<V> {
  private m = new Map<string, V>();
  private max: number;
  private onEvict: (v: V) => void;
  constructor(max: number, onEvict: (v: V) => void = () => {}) {
    this.max = max;
    this.onEvict = onEvict;
  }
  get size() { return this.m.size; }
  get(k: string) {
    const v = this.m.get(k);
    if (v !== undefined) { this.m.delete(k); this.m.set(k, v); }
    return v;
  }
  set(k: string, v: V) {
    this.m.delete(k);
    this.m.set(k, v);
    while (this.m.size > this.max) {
      const old = this.m.keys().next().value!;
      this.onEvict(this.m.get(old)!);
      this.m.delete(old);
    }
  }
  clear() {
    for (const v of this.m.values()) this.onEvict(v);
    this.m.clear();
  }
}

/** Every Look field changes pixels, so the key is the whole object (also covers fields added later). */
export const lookKey = (look: object) => JSON.stringify(look);
