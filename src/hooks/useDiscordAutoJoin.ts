import { useEffect, useRef } from 'react';
import { useNavigation } from '@react-navigation/native';
import { maybeAutoJoinInstanceRoom } from '../lib/discord/autoJoinInstanceRoom';
import { isDiscordActivity } from '../lib/discord/context';
import { useAuthStore } from '../store/authStore';

/**
 * Runs once per launch inside a Discord Activity: after auth is available,
 * auto-joins the Activity instance's room (if any) and navigates into it.
 * Mounted at the navigator root so navigation is available.
 */
export function useDiscordAutoJoin(): void {
  const navigation = useNavigation<any>();
  const displayName = useAuthStore((s) => s.displayName);
  const user = useAuthStore((s) => s.user);
  const attempted = useRef(false);

  useEffect(() => {
    if (!isDiscordActivity()) return;
    if (attempted.current) return;
    if (!user) return; // wait until Discord auth has minted a session
    attempted.current = true;
    (async () => {
      const result = await maybeAutoJoinInstanceRoom(displayName || 'Guest');
      if (result.joined) {
        navigation.navigate(result.phase === 'waiting' ? 'WaitingRoom' : 'GameTable', {
          isMultiplayer: true,
        });
      }
    })();
  }, [user, displayName, navigation]);
}
