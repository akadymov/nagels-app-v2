/**
 * Pure zero-sum stake settlement.
 *
 * Each opted-in player's rating delta is `(score - mean) * stake`, rounded
 * to an integer. The naive sum can be off by ±1 due to per-player rounding;
 * we absorb the drift into the player with the largest |delta| so the
 * journal balances exactly (sum === 0) for every settle.
 *
 * Inputs preserve their order on the way out.
 */

export interface StakeInput {
  user_id: string;
  score: number;
}

export interface StakeDelta {
  user_id: string;
  delta: number;
}

export function computeSettlement(
  players: StakeInput[],
  stake: number,
): StakeDelta[] {
  if (players.length === 0) return [];
  if (players.length === 1 || stake === 0) {
    return players.map((p) => ({ user_id: p.user_id, delta: 0 }));
  }

  const mean = players.reduce((s, p) => s + p.score, 0) / players.length;

  const out: StakeDelta[] = players.map((p) => ({
    user_id: p.user_id,
    delta: Math.round((p.score - mean) * stake),
  }));

  // Rounding-drift fix: absorb ±1 into the largest |delta| player.
  let drift = out.reduce((s, x) => s + x.delta, 0);
  while (drift !== 0) {
    // Pick the player with the largest |delta|; ties broken by index (first wins).
    let idx = 0;
    for (let i = 1; i < out.length; i += 1) {
      if (Math.abs(out[i].delta) > Math.abs(out[idx].delta)) idx = i;
    }
    out[idx].delta -= Math.sign(drift);
    drift -= Math.sign(drift);
  }

  return out;
}
