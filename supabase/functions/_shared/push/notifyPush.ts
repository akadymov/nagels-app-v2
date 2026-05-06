import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import webpush from 'npm:web-push@3';
import type { PushEvent } from './transitions.ts';
import { formatPushBody, type Lang } from './i18n.ts';

const PUSH_TIMEOUT_MS = 3_000;
const VISIBILITY_THRESHOLD_MS = 15_000;

interface SubscriptionRow {
  endpoint: string;
  p256dh: string;
  auth_secret: string;
  lang: string;
  auth_user_id: string;
}

function vapidConfigured(): boolean {
  return !!Deno.env.get('VAPID_PUBLIC_KEY')
      && !!Deno.env.get('VAPID_PRIVATE_KEY')
      && !!Deno.env.get('VAPID_SUBJECT');
}

function configureVapid() {
  webpush.setVapidDetails(
    Deno.env.get('VAPID_SUBJECT')!,
    Deno.env.get('VAPID_PUBLIC_KEY')!,
    Deno.env.get('VAPID_PRIVATE_KEY')!,
  );
}

function recipientsOf(event: PushEvent): string[] {
  return 'recipients' in event ? event.recipients : [event.recipient];
}

function tagFor(event: PushEvent): string {
  switch (event.type) {
    case 'your_turn':     return `nagels-turn-${event.room_id}`;
    case 'your_bid':      return `nagels-bid-${event.room_id}`;
    case 'game_start':
    case 'game_end':      return `nagels-game-${event.room_id}`;
    case 'hand_end':      return `nagels-hand-${event.room_id}-${event.hand_number}`;
    case 'player_joined': return `nagels-join-${event.room_id}-${event.recipient}`;
  }
}

/**
 * Fire-and-forget push for one event. Never throws.
 *
 * - No-op when VAPID env vars are unset (dev/preview path).
 * - For your_turn only: filters out recipients whose room_players.last_seen_at
 *   is fresher than VISIBILITY_THRESHOLD_MS (they're actively viewing the tab).
 *   Scoped to event.room_id — a session_id can have rows in multiple rooms.
 * - 410/404 from a push endpoint → row deleted from push_subscriptions
 *   (scoped by auth_user_id as defense-in-depth even though endpoint is UNIQUE).
 * - All other failures → console.warn with status code / err.name only —
 *   never logs token, endpoint, payload, or PostgREST error messages (they
 *   can echo filter values into the log).
 */
export async function notifyPush(
  svc: SupabaseClient,
  event: PushEvent,
): Promise<void> {
  if (!vapidConfigured()) return;
  configureVapid();

  let recipients = recipientsOf(event);

  if (event.type === 'your_turn' && recipients.length > 0) {
    try {
      const { data } = await svc
        .from('room_players')
        .select('session_id, last_seen_at')
        .eq('room_id', event.room_id)
        .in('session_id', recipients);
      const cutoff = Date.now() - VISIBILITY_THRESHOLD_MS;
      const stale = new Set<string>(
        (data ?? [])
          .filter((r: any) => Date.parse(r.last_seen_at) < cutoff)
          .map((r: any) => r.session_id),
      );
      recipients = recipients.filter((sid) => stale.has(sid));
    } catch (err: any) {
      console.warn(`[push] visibility lookup threw: name=${err?.name ?? 'unknown'} code=${err?.code ?? '<none>'}`);
    }
  }
  if (recipients.length === 0) return;

  let winner_name: string | undefined;
  if (event.type === 'game_end') {
    try {
      const { data } = await svc
        .from('room_players')
        .select('display_name')
        .eq('room_id', event.room_id)
        .eq('session_id', event.winner_session_id)
        .maybeSingle();
      winner_name = (data as any)?.display_name;
    } catch (err: any) {
      console.warn(`[push] winner lookup threw: name=${err?.name ?? 'unknown'} code=${err?.code ?? '<none>'}`);
    }
  }

  let sessionRows: Array<{ id: string; auth_user_id: string }> | null = null;
  try {
    const { data, error } = await svc
      .from('room_sessions')
      .select('id, auth_user_id')
      .in('id', recipients);
    if (error) {
      console.warn(`[push] room_sessions lookup failed: code=${error.code ?? '<none>'}`);
      return;
    }
    sessionRows = (data ?? []) as Array<{ id: string; auth_user_id: string }>;
  } catch (err: any) {
    console.warn(`[push] room_sessions lookup threw: name=${err?.name ?? 'unknown'} code=${err?.code ?? '<none>'}`);
    return;
  }

  const sessionToUser = new Map<string, string>();
  for (const r of sessionRows!) sessionToUser.set(r.id, r.auth_user_id);
  const userIds = [...new Set([...sessionToUser.values()])];
  if (userIds.length === 0) return;

  let subs: SubscriptionRow[] = [];
  try {
    const { data, error } = await svc
      .from('push_subscriptions')
      .select('endpoint, p256dh, auth_secret, lang, auth_user_id')
      .in('auth_user_id', userIds);
    if (error) {
      console.warn(`[push] subscriptions lookup failed: code=${error.code ?? '<none>'}`);
      return;
    }
    subs = (data ?? []) as SubscriptionRow[];
  } catch (err: any) {
    console.warn(`[push] subscriptions lookup threw: name=${err?.name ?? 'unknown'} code=${err?.code ?? '<none>'}`);
    return;
  }

  // Pick one session_id per auth_user_id for the deep-link context. If the
  // user has multiple sessions in this event's recipient set we just take one;
  // since they're the same user the link target is equivalent.
  const userToSession = new Map<string, string>();
  for (const [sid, uid] of sessionToUser) {
    if (!userToSession.has(uid)) userToSession.set(uid, sid);
  }

  await Promise.all(subs.map(async (sub) => {
    const sid = userToSession.get(sub.auth_user_id);
    if (!sid) return;
    const { title, body } = formatPushBody(event, (sub.lang as Lang) || 'en', {
      recipient_session_id: sid,
      winner_name,
    });
    const payload = JSON.stringify({
      title, body,
      tag: tagFor(event),
      room_id: event.room_id,
      room_code: event.room_code,
      type: event.type,
    });
    try {
      // web-push timeout option aborts the underlying https.request after N ms.
      // Promise.race is a belt-and-suspenders cap in case the npm shim ignores it.
      let timer: number | undefined;
      const sendP = webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth_secret } },
        payload,
        { timeout: PUSH_TIMEOUT_MS } as any,
      );
      const timeoutP = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('push_timeout')), PUSH_TIMEOUT_MS);
      });
      try {
        await Promise.race([sendP, timeoutP]);
      } finally {
        if (timer !== undefined) clearTimeout(timer);
      }
      await svc.from('push_subscriptions')
        .update({ last_used_at: new Date().toISOString() })
        .eq('endpoint', sub.endpoint)
        .eq('auth_user_id', sub.auth_user_id);
    } catch (err: any) {
      const status: number | undefined = err?.statusCode;
      if (status === 404 || status === 410) {
        try {
          await svc.from('push_subscriptions')
            .delete()
            .eq('endpoint', sub.endpoint)
            .eq('auth_user_id', sub.auth_user_id);
        } catch (delErr: any) {
          console.warn(`[push] cleanup delete threw: name=${delErr?.name ?? 'unknown'} code=${delErr?.code ?? '<none>'}`);
        }
        return;
      }
      console.warn(`[push] sendNotification failed: status=${status ?? '<none>'} name=${err?.name ?? 'unknown'}`);
    }
  }));
}
