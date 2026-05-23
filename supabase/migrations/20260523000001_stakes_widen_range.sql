-- Widen the rooms.stake CHECK from the preset-only set (0, 1, 5, 10, 25)
-- to any non-negative integer up to 999. Matches the server-side range
-- validation in setStake and the Custom-amount input in StakeSelector.
ALTER TABLE public.rooms DROP CONSTRAINT IF EXISTS rooms_stake_check;
ALTER TABLE public.rooms ADD CONSTRAINT rooms_stake_check
  CHECK (stake >= 0 AND stake <= 999);
