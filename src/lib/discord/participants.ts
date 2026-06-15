// Discord Activity participant tracking → prompt freeze. The pure diff is
// unit-tested; the hook (added in a later task) wires it to the SDK + snapshot
// resync.

import { useEffect, useRef } from 'react';
import { useRoomStore } from '../../store/roomStore';
import { gameClient } from '../gameClient';
import { getSupabaseClient } from '../supabase/client';
import { isDiscordActivity } from './context';
import { getDiscordSdk } from './bootstrap';

/** Given the previous id set and the new id list, return who left + the new set. */
export function diffParticipants(prev: Set<string>, nextIds: string[]): { next: Set<string>; left: string[] } {
  const next = new Set(nextIds);
  const left: string[] = [];
  for (const id of prev) {
    if (!next.has(id)) left.push(id);
  }
  return { next, left };
}

// Discord SDK event for instance participant changes. Verified live in a later
// manual task; the constant is isolated here for easy correction.
const PARTICIPANTS_UPDATE = 'ACTIVITY_INSTANCE_PARTICIPANTS_UPDATE';
const PARTICIPANT_RESYNC_DEBOUNCE_MS = 1_000;

/**
 * While in a room inside a Discord Activity, watch the voice-channel
 * participants. When someone leaves, force an immediate snapshot resync so the
 * existing freeze/host-absent detection fires without waiting out the heartbeat
 * staleness window. Mount once per room screen (next to useReconnectOnFocus).
 */
export function useDiscordParticipantSync(): void {
  const roomId = useRoomStore((s) => s.snapshot?.room?.id);
  const lastResync = useRef(0);

  useEffect(() => {
    if (!roomId) return;
    if (!isDiscordActivity()) return;
    const sdk = getDiscordSdk() as any;
    if (!sdk?.subscribe || !sdk?.commands?.getInstanceConnectedParticipants) return;

    let prev = new Set<string>();
    let active = true;

    const resync = () => {
      const now = Date.now();
      if (now - lastResync.current < PARTICIPANT_RESYNC_DEBOUNCE_MS) return; // debounce churn
      lastResync.current = now;
      const supabase = getSupabaseClient();
      Promise.resolve(supabase.rpc('heartbeat', { p_room_id: roomId })).catch(() => {});
      void gameClient.refreshSnapshot(roomId);
    };

    const toIds = (payload: any): string[] =>
      (payload?.participants ?? []).map((p: any) => String(p?.id ?? p?.user?.id)).filter(Boolean);

    const onUpdate = (payload: any) => {
      if (!active) return;
      const { next, left } = diffParticipants(prev, toIds(payload));
      prev = next;
      if (left.length > 0) resync();
    };

    // Seed the initial set, THEN subscribe — subscribing first risks an update
    // arriving before the seed resolves, which would diff against an empty set
    // and treat every current participant as "left" (a spurious resync on join).
    Promise.resolve(sdk.commands.getInstanceConnectedParticipants())
      .then((p: any) => {
        if (!active) return;
        prev = new Set(toIds(p));
        try { sdk.subscribe(PARTICIPANTS_UPDATE, onUpdate); }
        catch (e) { console.warn('[Discord] participant subscribe failed', e); }
      })
      .catch(() => {});

    return () => {
      active = false;
      try { sdk.unsubscribe?.(PARTICIPANTS_UPDATE, onUpdate); } catch {}
    };
  }, [roomId]);
}
