/* Seeded pseudo-random numbers. Everything the composer and scheduler do is
 * derived from string keys, so the same seed always yields the same hour of
 * music, and each loop of the piece is identical to the last. */
(function (root) {
  const AN = root.AN = root.AN || {};

  // cyrb53 string hash -> 32-bit unsigned int
  function hashString(str, seed = 0) {
    let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
    for (let i = 0; i < str.length; i++) {
      const ch = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (h1 ^ h2) >>> 0;
  }

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  class Rng {
    constructor(key) { this.next = mulberry32(hashString(String(key))); }
    float(min = 0, max = 1) { return min + (max - min) * this.next(); }
    int(min, max) { return Math.floor(this.float(min, max + 1)); }
    bool(p = 0.5) { return this.next() < p; }
    pick(arr) { return arr[Math.floor(this.next() * arr.length)]; }
    weighted(items) { // [[value, weight], ...]
      let total = 0;
      for (const it of items) total += it[1];
      let r = this.next() * total;
      for (const it of items) { r -= it[1]; if (r <= 0) return it[0]; }
      return items[items.length - 1][0];
    }
    shuffle(arr) {
      const a = arr.slice();
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(this.next() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
      }
      return a;
    }
    gauss(mean = 0, sd = 1) {
      let u = 0, v = 0;
      while (u === 0) u = this.next();
      while (v === 0) v = this.next();
      return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    }
    poisson(lambda) {
      if (lambda <= 0) return 0;
      if (lambda > 30) return Math.max(0, Math.round(this.gauss(lambda, Math.sqrt(lambda))));
      const L = Math.exp(-lambda);
      let k = 0, p = 1;
      do { k++; p *= this.next(); } while (p > L);
      return k - 1;
    }
  }

  AN.hashString = hashString;
  AN.Rng = Rng;
  /** Build an Rng from any number of key parts, e.g. AN.rng(seed, 'melody', bar). */
  AN.rng = (...parts) => new Rng(parts.join('|'));
})(typeof globalThis !== 'undefined' ? globalThis : this);
