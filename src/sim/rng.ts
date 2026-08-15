/**
 * Seeded PRNG (PCG32).
 *
 * `Math.random` is forbidden anywhere in the simulation: it is unseeded, so two
 * peers would immediately diverge. PCG32 is pure 32-bit integer arithmetic, so
 * it is exactly reproducible across engines, and it is small enough to snapshot
 * as part of the world state.
 *
 * The state is kept as two 32-bit halves rather than a BigInt because BigInt is
 * both slower and unnecessary — we do the 64-bit multiply by hand.
 */
export class Rng {
  // 64-bit state, split into high/low 32-bit halves.
  private hi: number;
  private lo: number;

  constructor(seed: number) {
    // Splitmix-ish seeding so that adjacent seeds produce unrelated streams.
    this.hi = seed >>> 0;
    this.lo = (seed ^ 0x9e3779b9) >>> 0;
    // Discard a few outputs to wash out seeding structure.
    this.nextUint32();
    this.nextUint32();
    this.nextUint32();
  }

  /** Snapshot for world hashing and replay. */
  getState(): [number, number] {
    return [this.hi, this.lo];
  }

  setState(hi: number, lo: number): void {
    this.hi = hi >>> 0;
    this.lo = lo >>> 0;
  }

  clone(): Rng {
    const r = new Rng(0);
    r.setState(this.hi, this.lo);
    return r;
  }

  /** Raw 32-bit output. Everything else is derived from this. */
  nextUint32(): number {
    // state = state * 6364136223846793005 + 1442695040888963407, done as a
    // 64-bit multiply over 32-bit halves with 16-bit partial products so no
    // intermediate exceeds 2^53 and stays exact in a double.
    const oldHi = this.hi;
    const oldLo = this.lo;

    const mulHi = 0x5851f42d;
    const mulLo = 0x4c957f2d;

    // Low 32 bits of the product, via 16-bit chunks.
    const lo0 = oldLo & 0xffff;
    const lo1 = oldLo >>> 16;
    const m0 = mulLo & 0xffff;
    const m1 = mulLo >>> 16;

    const p00 = lo0 * m0;
    const p01 = lo0 * m1;
    const p10 = lo1 * m0;
    const p11 = lo1 * m1;

    const carry = ((p00 >>> 16) + (p01 & 0xffff) + (p10 & 0xffff)) >>> 0;
    const newLo = (((carry & 0xffff) << 16) | (p00 & 0xffff)) >>> 0;

    const newHiFromLo =
      (p11 + (p01 >>> 16) + (p10 >>> 16) + (carry >>> 16)) >>> 0;
    const newHi =
      (newHiFromLo + Math.imul(oldLo, mulHi) + Math.imul(oldHi, mulLo)) >>> 0;

    // Add the increment 1442695040888963407 = 0x14057b7e * 2^32 + 0xf767814f
    const addLo = 0xf767814f;
    const addHi = 0x14057b7e;
    const sumLo = (newLo + addLo) >>> 0;
    const carryOut = sumLo < newLo >>> 0 ? 1 : 0;

    this.lo = sumLo;
    this.hi = (newHi + addHi + carryOut) >>> 0;

    // PCG output function: XSH RR on the *old* state.
    const xorshifted = (((oldHi >>> 13) ^ oldHi) ^ (oldLo >>> 27)) >>> 0;
    const rot = oldHi >>> 27;
    return ((xorshifted >>> rot) | (xorshifted << ((-rot >>> 0) & 31))) >>> 0;
  }

  /** Uniform float in [0, 1). */
  nextFloat(): number {
    // 2^-32 is exact, so this division is exact.
    return this.nextUint32() * 2.3283064365386963e-10;
  }

  /** Uniform float in [min, max). */
  range(min: number, max: number): number {
    return min + this.nextFloat() * (max - min);
  }

  /** Uniform integer in [min, max] inclusive. */
  int(min: number, max: number): number {
    const span = max - min + 1;
    if (span <= 0) return min;
    return min + Math.floor(this.nextFloat() * span);
  }
}
