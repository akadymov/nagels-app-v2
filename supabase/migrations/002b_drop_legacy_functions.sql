-- Drop legacy functions left over from the dropped game_states schema.
-- update_game_state was a JSON-blob updater; update_updated_at was a trigger
-- function for tables we have removed.
DROP FUNCTION IF EXISTS public.update_game_state(uuid, integer, text, integer, integer, text, integer, jsonb);
DROP FUNCTION IF EXISTS public.update_updated_at();
