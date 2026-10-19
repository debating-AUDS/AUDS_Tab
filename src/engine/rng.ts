export type Rng = () => number;

/** Mulberry32 - small, fast, seedable PRNG. Used so draws can be reproduced in tests. */
export function seededRng(seed: number): Rng {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A cryptographically random seed, available in Workers and Node. */
export function randomSeed(): number {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0];
}

/** Fisher-Yates shuffle of arr[first..last] (inclusive, 0-based) in place. */
export function shuffleRange<T>(arr: T[], first: number, last: number, rng: Rng): void {
  for (let i = last; i > first; i--) {
    const j = Math.floor(rng() * (i - first + 1)) + first;
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
}

export function shuffled<T>(arr: T[], rng: Rng): T[] {
  const copy = arr.slice();
  shuffleRange(copy, 0, copy.length - 1, rng);
  return copy;
}
