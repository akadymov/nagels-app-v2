-- Two correctness bugs in 005_pl_handlers:
--
-- 1. _rank_to_int returned 0 for ranks 2/3/4/5, which the 52-card deck
--    actually contains. So a trick of 3♣ vs 4♣ on a clubs-trump hand
--    compared 0 vs 0 → first card kept by default → wrong winner.
--
--    Also missing the Nägels trump-suit hierarchy: in the trump suit,
--    Jack is highest, then 9, then A, K, Q, 10, 8, 7, 6, 5, 4, 3, 2.
--    Off-trump (or no-trump round) keeps the standard A>K>Q>J>10>...>2.
--
--    Replaced by _rank_value(rank, is_trump). _determine_trick_winner
--    now passes the per-card is_trump flag in.
--
-- 2. _compute_hand_score returned 10+bet on an exact bid and a NEGATIVE
--    -|bet-taken| on a miss. Akula's actual ruleset: hand_score is
--    always positive — tricks taken plus a flat +10 bonus when the bid
--    matches exactly. No penalty for missing a bid.
--
--    New rule: hand_score = taken + (bet == taken ? 10 : 0).

CREATE OR REPLACE FUNCTION public._rank_value(p_rank TEXT, p_is_trump BOOLEAN)
RETURNS INT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_is_trump THEN
      CASE p_rank
        WHEN '2'  THEN 0  WHEN '3' THEN 1  WHEN '4' THEN 2  WHEN '5' THEN 3
        WHEN '6'  THEN 4  WHEN '7' THEN 5  WHEN '8' THEN 6
        WHEN '10' THEN 7  WHEN 'Q' THEN 8  WHEN 'K' THEN 9  WHEN 'A' THEN 10
        WHEN '9'  THEN 11 WHEN 'J' THEN 12
        ELSE 0
      END
    ELSE
      CASE p_rank
        WHEN '2'  THEN 0  WHEN '3' THEN 1  WHEN '4' THEN 2  WHEN '5' THEN 3
        WHEN '6'  THEN 4  WHEN '7' THEN 5  WHEN '8' THEN 6  WHEN '9' THEN 7
        WHEN '10' THEN 8  WHEN 'J' THEN 9  WHEN 'Q' THEN 10 WHEN 'K' THEN 11 WHEN 'A' THEN 12
        ELSE 0
      END
  END;
$$;

CREATE OR REPLACE FUNCTION public._determine_trick_winner(
  p_cards JSONB,    -- [{ seat, suit, rank }] in play order
  p_trump TEXT
)
RETURNS INT
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_lead_suit  TEXT;
  v_card       JSONB;
  v_winner     JSONB;
  v_w_is_trump BOOLEAN;
  v_c_is_trump BOOLEAN;
  v_w_rank     INT;
  v_c_rank     INT;
  v_w_suit     TEXT;
  v_c_suit     TEXT;
BEGIN
  v_lead_suit := p_cards->0->>'suit';
  v_winner := p_cards->0;
  FOR i IN 1 .. jsonb_array_length(p_cards) - 1 LOOP
    v_card := p_cards->i;
    v_w_suit := v_winner->>'suit';
    v_c_suit := v_card->>'suit';
    v_w_is_trump := (v_w_suit = p_trump);
    v_c_is_trump := (v_c_suit = p_trump);
    -- Use trump-rank hierarchy when comparing trump-vs-trump, normal
    -- hierarchy otherwise. (For two off-trump cards we still compare
    -- normal ranks — the lead-suit guard below decides if they're even
    -- comparable.)
    v_w_rank := public._rank_value(v_winner->>'rank', v_w_is_trump);
    v_c_rank := public._rank_value(v_card->>'rank',   v_c_is_trump);

    IF v_c_is_trump AND NOT v_w_is_trump THEN
      v_winner := v_card;
    ELSIF v_c_is_trump AND v_w_is_trump AND v_c_rank > v_w_rank THEN
      v_winner := v_card;
    ELSIF NOT v_c_is_trump AND NOT v_w_is_trump
          AND v_c_suit = v_lead_suit AND v_w_suit = v_lead_suit
          AND v_c_rank > v_w_rank THEN
      v_winner := v_card;
    END IF;
  END LOOP;
  RETURN (v_winner->>'seat')::int;
END;
$$;

CREATE OR REPLACE FUNCTION public._compute_hand_score(p_bet INT, p_taken INT)
RETURNS INT
LANGUAGE sql
IMMUTABLE
AS $$
  -- Always positive: every trick taken counts as 1 point; an exact bid
  -- adds a flat +10 bonus. Missing the bid simply forfeits the bonus.
  SELECT p_taken + CASE WHEN p_bet = p_taken THEN 10 ELSE 0 END;
$$;
