import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import webpush from 'npm:web-push@3';
import type { PushEvent } from './transitions.ts';
import { formatPushBody, type Lang } from './i18n.ts';

const TG_TIMEOUT_MS = 3_000;
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
 * - 410/404 from a push endpoint → row deleted from push_subscriptions.
 * - All other failures → console.warn with status code only (never logs token,
 *   endpoint, or message body).
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
        .in('session_id', recipients);
      const cutoff = Date.now() - VISIBILITY_THRESHOLD_MS;
      const stale = new Set<string>(
        (data ?? [])
          .filter((r: any) => Date.parse(r.last_seen_at) < cutoff)
          .map((r: any) => r.session_id),
      );
      recipients = recipients.filter((sid) => stale.has(sid));
    } catch (err) {
      console.warn(`[push] visibility lookup threw: ${(err as Error).message}`);
    }
  }
  if (recipients.length === 0) return;

  let winner_name: string | undefined;
  if (event.type === 'game_end') {
    const { data } = await svc
      .from('room_players')
      .select('session_id, display_name')
      .eq('session_id', event.winner_session_id)
      .maybeSingle();
    winner_name = (data as any)?.display_name;
  }

  const { data: sessionRows, error: sessErr } = await svc
    .from('room_sessions')
    .select('id, auth_user_id')
    .in('id', recipients);
  if (sessErr) {
    console.warn(`[push] room_sessions lookup failed: ${sessErr.message}`);
    return;
  }
  const sessionToUser = new Map<string, string>();
  for (const r of (sessionRows ?? []) as Array<{ id: string; auth_user_id: string }>) {
    sessionToUser.set(r.id, r.auth_user_id);
  }
  const userIds = [...new Set([...sessionToUser.values()])];
  if (userIds.length === 0) return;

  const { data: subs, error: subsErr } = await svc
    .from('push_subscriptions')
    .select('endpoint, p256dh, auth_secret, lang, auth_user_id')
    .in('auth_user_id', userIds);
  if (subsErr) {
    console.warn(`[push] subscriptions lookup failed: ${subsErr.message}`);
    return;
  }

  const userToSession = new Map<string, string>();
  for (const [sid, uid] of sessionToUser) userToSession.set(uid, sid);

  await Promise.all(((subs ?? []) as SubscriptionRow[]).map(async (sub) => {
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
      let timer: number | undefined;
      const sendP = webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth_secret } },
        payload,
      );
      const timeoutP = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('push_timeout')), TG_TIMEOUT_MS);
      });
      try {
        await Promise.race([sendP, timeoutP]);
      } finally {
        if (timer !== undefined) clearTimeout(timer);
      }
      await svc.from('push_subscriptions')
        .update({ last_used_at: new Date().toISOString() })
        .eq('endpoint', sub.endpoint);
    } catch (err: any) {
      const status: number | undefined = err?.statusCode;
      if (status === 404 || status === 410) {
        await svc.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
        return;
      }
      console.warn(`[push] sendNotification failed: status=${status ?? '<none>'} name=${err?.name ?? 'unknown'}`);
    }
  }));
}
