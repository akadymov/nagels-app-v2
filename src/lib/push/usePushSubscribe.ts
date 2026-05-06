import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getSupabaseClient } from '../supabase/client';
import { getPushPlatformState } from './iosGate';

export type PushState =
  | 'unsupported' | 'ios-needs-pwa'
  | 'denied' | 'default' | 'subscribed' | 'pending';

const VAPID_PUB = process.env.EXPO_PUBLIC_VAPID_PUBLIC_KEY;

function urlB64ToUint8Array(b64: string): Uint8Array {
  const padding = '='.repeat((4 - (b64.length % 4)) % 4);
  const base64 = (b64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function getActiveEndpoint(): Promise<string | null> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return null;
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  return sub?.endpoint ?? null;
}

interface UsePushSubscribe {
  state: PushState;
  enable: () => Promise<void>;
  disable: () => Promise<void>;
}

export function usePushSubscribe(): UsePushSubscribe {
  const { i18n } = useTranslation();
  const [state, setState] = useState<PushState>('default');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const platform = getPushPlatformState();
      if (platform !== 'ok') { if (!cancelled) setState(platform); return; }
      const perm = Notification.permission;
      if (perm === 'denied') { if (!cancelled) setState('denied'); return; }
      if (perm === 'default') { if (!cancelled) setState('default'); return; }
      const ep = await getActiveEndpoint();
      if (!cancelled) setState(ep ? 'subscribed' : 'default');
    })();
    return () => { cancelled = true; };
  }, []);

  const subscribeToServer = useCallback(async (endpoint: string, p256dh: string, auth: string) => {
    const supabase = getSupabaseClient();
    await supabase.functions.invoke('push-subscribe', {
      body: { endpoint, p256dh, auth_secret: auth, lang: i18n.language || 'en' },
    });
  }, [i18n.language]);

  const enable = useCallback(async () => {
    if (!VAPID_PUB) { console.warn('[push] EXPO_PUBLIC_VAPID_PUBLIC_KEY missing'); return; }
    if (state === 'unsupported' || state === 'ios-needs-pwa') return;
    setState('pending');
    try {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') { setState(perm === 'denied' ? 'denied' : 'default'); return; }
      const reg = await navigator.serviceWorker.ready;
      const existing = await reg.pushManager.getSubscription();
      const sub = existing ?? await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlB64ToUint8Array(VAPID_PUB) as BufferSource,
      });
      const j: any = sub.toJSON();
      await subscribeToServer(j.endpoint, j.keys.p256dh, j.keys.auth);
      setState('subscribed');
    } catch (err) {
      console.warn('[push] enable failed:', err);
      setState('default');
    }
  }, [state, subscribeToServer]);

  const disable = useCallback(async () => {
    setState('pending');
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await getSupabaseClient().functions.invoke('push-unsubscribe', { body: { endpoint: sub.endpoint } });
        await sub.unsubscribe();
      }
      setState(Notification.permission === 'denied' ? 'denied' : 'default');
    } catch (err) {
      console.warn('[push] disable failed:', err);
      setState('subscribed');
    }
  }, []);

  // Re-register on language change so the lang column stays current.
  useEffect(() => {
    if (state !== 'subscribed') return;
    (async () => {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (!sub) return;
      const j: any = sub.toJSON();
      await subscribeToServer(j.endpoint, j.keys.p256dh, j.keys.auth);
    })().catch((e) => console.warn('[push] lang resync failed:', e));
  }, [i18n.language, state, subscribeToServer]);

  return { state, enable, disable };
}
