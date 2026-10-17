BEGIN;
DO $$
DECLARE
  v_t uuid; v_u uuid; v_p uuid[]; v_s uuid[]; v_room uuid; v_hand uuid; r jsonb; i int;
BEGIN
  INSERT INTO tournaments (code, name, max_cards, table_secret, current_tour)
    VALUES ('TSTTST', 'test', 2, 'sec', 1) RETURNING id INTO v_t;
  FOR i IN 1..3 LOOP
    v_p[i] := gen_random_uuid();
    INSERT INTO tournament_participants (id, tournament_id, display_name) VALUES (v_p[i], v_t, 'P'||i);
    INSERT INTO room_sessions (display_name, tournament_participant_id)
      VALUES ('P'||i, v_p[i]) RETURNING id INTO v_s[i];
  END LOOP;
  INSERT INTO rooms (code, host_session_id, player_count, max_cards, mode, phase, tournament_id, tour_number, table_number, stake)
    VALUES ('TSTRM1', v_s[1], 3, 2, 'scorekeeper', 'playing', v_t, 1, 1, 5) RETURNING id INTO v_room;
  FOR i IN 1..3 LOOP
    INSERT INTO room_players (room_id, session_id, seat_index, is_ready) VALUES (v_room, v_s[i], i-1, true);
  END LOOP;
  INSERT INTO hands (room_id, hand_number, cards_per_player, trump_suit, starting_seat, current_seat, phase, deck_seed)
    VALUES (v_room, 1, 2, 'hearts', 0, 0, 'betting', 'x') RETURNING id INTO v_hand;
  UPDATE rooms SET current_hand_id = v_hand WHERE id = v_room;

  -- undo with no bets → error
  r := undo_last_bet_action(v_room, v_hand);
  ASSERT (r->>'ok')::bool = false AND r->>'error' = 'nothing_to_undo', 'undo empty: '||r;

  -- bet seat0, undo → seat0 to bet again
  r := place_bet_action(v_room, v_s[1], v_hand, 1);
  ASSERT (r->>'ok')::bool, 'bet0: '||r;
  r := undo_last_bet_action(v_room, v_hand);
  ASSERT (r->>'ok')::bool, 'undo0: '||r;
  ASSERT (SELECT current_seat FROM hands WHERE id = v_hand) = 0, 'seat back to 0';
  ASSERT (SELECT count(*) FROM hand_scores WHERE hand_id = v_hand) = 0, 'bet row deleted';

  -- all three bet → tricks_recording; undo last → back to betting at seat 2
  PERFORM place_bet_action(v_room, v_s[1], v_hand, 1);
  PERFORM place_bet_action(v_room, v_s[2], v_hand, 0);
  r := place_bet_action(v_room, v_s[3], v_hand, 0);
  ASSERT (SELECT phase FROM hands WHERE id = v_hand) = 'tricks_recording', 'phase tricks: '||r;
  r := undo_last_bet_action(v_room, v_hand);
  ASSERT (r->>'ok')::bool, 'undo in tricks_recording: '||r;
  ASSERT (SELECT phase FROM hands WHERE id = v_hand) = 'betting', 'phase back to betting';
  ASSERT (SELECT current_seat FROM hands WHERE id = v_hand) = 2, 'seat back to 2';
  PERFORM place_bet_action(v_room, v_s[3], v_hand, 0);

  -- record tricks 2/0/0 → scoring; balance zero-sum, stake 5
  PERFORM record_tricks_action(v_room, v_s[1], v_hand, 2);
  PERFORM record_tricks_action(v_room, v_s[2], v_hand, 0);
  PERFORM record_tricks_action(v_room, v_s[3], v_hand, 0);
  ASSERT (SELECT phase FROM hands WHERE id = v_hand) = 'scoring', 'scored';

  r := get_tournament_state('tsttst');
  ASSERT r IS NOT NULL, 'state by lowercase code';
  ASSERT NOT (r->'tournament' ? 'table_secret'), 'secret not exposed';
  ASSERT jsonb_array_length(r->'tables') = 1, 'one table';
  ASSERT (r->'tables'->0->'state'->'players'->0->>'is_proxy')::bool, 'proxy flag';
  ASSERT abs((SELECT sum((x->>'balance')::numeric) FROM jsonb_array_elements(r->'leaderboard') x)) < 0.0001, 'zero-sum';
  ASSERT (SELECT (x->>'balance')::numeric FROM jsonb_array_elements(r->'leaderboard') x
          WHERE x->>'participant_id' = v_p[2]::text) > 0, 'winner positive';

  -- edit_hand_action: corrections keep the live-play rules and rescore
  r := edit_hand_action(v_room, v_hand, jsonb_build_array(
    jsonb_build_object('session_id', v_s[1], 'bet', 1, 'taken', 1),
    jsonb_build_object('session_id', v_s[2], 'bet', 0, 'taken', 0),
    jsonb_build_object('session_id', v_s[3], 'bet', 0, 'taken', 0)));
  ASSERT r->>'error' = 'tricks_sum', 'edit: tricks must sum to cards: '||r;
  r := edit_hand_action(v_room, v_hand, jsonb_build_array(
    jsonb_build_object('session_id', v_s[1], 'bet', 1, 'taken', 2),
    jsonb_build_object('session_id', v_s[2], 'bet', 1, 'taken', 0),
    jsonb_build_object('session_id', v_s[3], 'bet', 0, 'taken', 0)));
  ASSERT r->>'error' = 'bets_sum', 'edit: bets may not sum to cards: '||r;
  r := edit_hand_action(v_room, v_hand, jsonb_build_array(
    jsonb_build_object('session_id', v_s[1], 'bet', 1, 'taken', 1),
    jsonb_build_object('session_id', v_s[2], 'bet', 0, 'taken', 1)));
  ASSERT r->>'error' = 'invalid_entries', 'edit: every seat required: '||r;
  r := edit_hand_action(v_room, v_hand, jsonb_build_array(
    jsonb_build_object('session_id', v_s[1], 'bet', 1, 'taken', 1),
    jsonb_build_object('session_id', v_s[2], 'bet', 0, 'taken', 1),
    jsonb_build_object('session_id', v_s[3], 'bet', 0, 'taken', 0)));
  ASSERT (r->>'ok')::bool, 'edit ok: '||r;
  ASSERT (SELECT hand_score FROM hand_scores WHERE hand_id = v_hand AND session_id = v_s[1]) = 11, 'rescored exact';
  ASSERT (SELECT hand_score FROM hand_scores WHERE hand_id = v_hand AND session_id = v_s[2]) = 1, 'rescored miss';
  ASSERT EXISTS (SELECT 1 FROM game_events WHERE hand_id = v_hand AND kind = 'hand_edited'), 'edit journaled';
  r := get_tournament_state('tsttst');
  ASSERT abs((SELECT sum((x->>'balance')::numeric) FROM jsonb_array_elements(r->'leaderboard') x)) < 0.0001, 'zero-sum after edit';

  -- undo after claims is refused
  r := undo_last_bet_action(v_room, v_hand);
  ASSERT (r->>'ok')::bool = false, 'no undo after scoring';

  -- cleanup_stale_rooms must not delete tournament rooms
  UPDATE rooms SET updated_at = now() - interval '3 days', created_at = now() - interval '3 days' WHERE id = v_room;
  UPDATE room_players SET last_seen_at = now() - interval '3 days' WHERE room_id = v_room;
  PERFORM cleanup_stale_rooms();
  ASSERT EXISTS (SELECT 1 FROM rooms WHERE id = v_room), 'tournament room survives cleanup';

  -- cleanup_stale_guests must not delete a stale anonymous guest that hosts a
  -- tournament room (auth.users -> room_sessions -> rooms cascades).
  -- Static only so far (written while the local DB was down).
  v_u := gen_random_uuid();
  INSERT INTO auth.users (id, is_anonymous, created_at, last_sign_in_at)
    VALUES (v_u, true, now() - interval '3 days', now() - interval '3 days');
  UPDATE room_sessions SET auth_user_id = v_u WHERE id = v_s[1];
  PERFORM cleanup_stale_guests();
  ASSERT EXISTS (SELECT 1 FROM auth.users WHERE id = v_u), 'tournament host guest survives cleanup';
  ASSERT EXISTS (SELECT 1 FROM rooms WHERE id = v_room), 'tournament room survives guest cleanup';

  RAISE NOTICE 'offline_tournament: ALL OK';
END $$;
ROLLBACK;
