import type { RoomSnapshot } from '../../../supabase/functions/_shared/types.ts';

export interface TournamentParticipant { id: string; display_name: string; no_stakes: boolean }
export interface TournamentTable { table_number: number; room_id: string; stake: number; claimed: boolean; state: RoomSnapshot }
export interface LeaderRow { participant_id: string; balance: number; total_points: number }
export interface TournamentState {
  tournament: { id: string; code: string; name: string; max_cards: number; current_tour: number; version: number; admin_session_id: string | null };
  participants: TournamentParticipant[]; tables: TournamentTable[]; leaderboard: LeaderRow[];
}
