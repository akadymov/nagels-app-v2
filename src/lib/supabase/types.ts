/**
 * Nägels Online — Supabase Type Definitions
 *
 * Auto-generated from the Supabase schema via the MCP tool
 * `mcp__claude_ai_Supabase__generate_typescript_types`.
 * Regenerate after every migration.
 */

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  __InternalSupabase: {
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      dealt_cards: {
        Row: {
          card: string
          hand_id: string
          session_id: string
        }
        Insert: {
          card: string
          hand_id: string
          session_id: string
        }
        Update: {
          card?: string
          hand_id?: string
          session_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "dealt_cards_hand_id_fkey"
            columns: ["hand_id"]
            isOneToOne: false
            referencedRelation: "hands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dealt_cards_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "room_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      game_events: {
        Row: {
          created_at: string
          hand_id: string | null
          id: number
          kind: string
          payload: Json
          room_id: string
          session_id: string | null
        }
        Insert: {
          created_at?: string
          hand_id?: string | null
          id?: number
          kind: string
          payload?: Json
          room_id: string
          session_id?: string | null
        }
        Update: {
          created_at?: string
          hand_id?: string | null
          id?: number
          kind?: string
          payload?: Json
          room_id?: string
          session_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "game_events_hand_id_fkey"
            columns: ["hand_id"]
            isOneToOne: false
            referencedRelation: "hands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "game_events_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "game_events_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "room_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      hand_scores: {
        Row: {
          bet: number
          hand_id: string
          hand_score: number
          session_id: string
          taken_tricks: number
        }
        Insert: {
          bet: number
          hand_id: string
          hand_score?: number
          session_id: string
          taken_tricks?: number
        }
        Update: {
          bet?: number
          hand_id?: string
          hand_score?: number
          session_id?: string
          taken_tricks?: number
        }
        Relationships: [
          {
            foreignKeyName: "hand_scores_hand_id_fkey"
            columns: ["hand_id"]
            isOneToOne: false
            referencedRelation: "hands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hand_scores_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "room_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      hands: {
        Row: {
          cards_per_player: number
          closed_at: string | null
          current_seat: number
          deck_seed: string
          hand_number: number
          id: string
          phase: string
          room_id: string
          started_at: string
          starting_seat: number
          trump_suit: string
        }
        Insert: {
          cards_per_player: number
          closed_at?: string | null
          current_seat: number
          deck_seed: string
          hand_number: number
          id?: string
          phase?: string
          room_id: string
          started_at?: string
          starting_seat: number
          trump_suit: string
        }
        Update: {
          cards_per_player?: number
          closed_at?: string | null
          current_seat?: number
          deck_seed?: string
          hand_number?: number
          id?: string
          phase?: string
          room_id?: string
          started_at?: string
          starting_seat?: number
          trump_suit?: string
        }
        Relationships: [
          {
            foreignKeyName: "hands_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      room_players: {
        Row: {
          is_connected: boolean
          is_ready: boolean
          last_seen_at: string
          room_id: string
          seat_index: number
          session_id: string
        }
        Insert: {
          is_connected?: boolean
          is_ready?: boolean
          last_seen_at?: string
          room_id: string
          seat_index: number
          session_id: string
        }
        Update: {
          is_connected?: boolean
          is_ready?: boolean
          last_seen_at?: string
          room_id?: string
          seat_index?: number
          session_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "room_players_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "room_players_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "room_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      room_sessions: {
        Row: {
          auth_user_id: string
          created_at: string
          display_name: string
          id: string
        }
        Insert: {
          auth_user_id: string
          created_at?: string
          display_name: string
          id?: string
        }
        Update: {
          auth_user_id?: string
          created_at?: string
          display_name?: string
          id?: string
        }
        Relationships: []
      }
      rooms: {
        Row: {
          code: string
          created_at: string
          current_hand_id: string | null
          host_session_id: string
          id: string
          max_cards: number
          phase: string
          player_count: number
          updated_at: string
          version: number
        }
        Insert: {
          code: string
          created_at?: string
          current_hand_id?: string | null
          host_session_id: string
          id?: string
          max_cards?: number
          phase?: string
          player_count: number
          updated_at?: string
          version?: number
        }
        Update: {
          code?: string
          created_at?: string
          current_hand_id?: string | null
          host_session_id?: string
          id?: string
          max_cards?: number
          phase?: string
          player_count?: number
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "rooms_current_hand_fk"
            columns: ["current_hand_id"]
            isOneToOne: false
            referencedRelation: "hands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rooms_host_session_id_fkey"
            columns: ["host_session_id"]
            isOneToOne: false
            referencedRelation: "room_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      trick_cards: {
        Row: {
          card: string
          played_at: string
          seat_index: number
          trick_id: string
        }
        Insert: {
          card: string
          played_at?: string
          seat_index: number
          trick_id: string
        }
        Update: {
          card?: string
          played_at?: string
          seat_index?: number
          trick_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "trick_cards_trick_id_fkey"
            columns: ["trick_id"]
            isOneToOne: false
            referencedRelation: "tricks"
            referencedColumns: ["id"]
          },
        ]
      }
      tricks: {
        Row: {
          closed_at: string | null
          hand_id: string
          id: string
          lead_seat: number
          trick_number: number
          winner_seat: number | null
        }
        Insert: {
          closed_at?: string | null
          hand_id: string
          id?: string
          lead_seat: number
          trick_number: number
          winner_seat?: number | null
        }
        Update: {
          closed_at?: string | null
          hand_id?: string
          id?: string
          lead_seat?: number
          trick_number?: number
          winner_seat?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "tricks_hand_id_fkey"
            columns: ["hand_id"]
            isOneToOne: false
            referencedRelation: "hands"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      get_my_hand: {
        Args: { p_hand_id: string; p_session_id: string }
        Returns: Json
      }
      get_room_state: { Args: { p_room_id: string }; Returns: Json }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
