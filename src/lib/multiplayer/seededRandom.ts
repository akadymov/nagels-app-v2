/**
 * Nägels Online - Seeded Random
 *
 * Seeded random number generator for multiplayer card games.
 * Ensures all players get the same deck shuffle.
 */

/**
 * Simple seeded random number generator (Mulberry32)
 */
export function createSeededRandom(seed: string): () => number {
  // Convert string seed to number
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = Math.imul(seed.charCodeAt(i), 31) + hash;
  }

  // Mulberry32 algorithm
  let t = hash += 0x6D2B79F5;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);

  return () => {
    t += 0x6D2B79F5;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Shuffle an array using seeded random
 */
export function seededShuffle<T>(array: T[], seed: string): T[] {
  const random = createSeededRandom(seed);
  const result = [...array];

  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }

  return result;
}
