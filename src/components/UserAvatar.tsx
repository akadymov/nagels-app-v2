/**
 * Resolves the best avatar source in priority order:
 *   1. avatarUrl (image URL — e.g. Google profile picture)
 *   2. emoji (single-char emoji picked from the AVATAR_PRESETS picker)
 *   3. fallback initial (first letter of display_name)
 *
 * Single component so adding a new render site doesn't repeat the
 * 3-branch logic; switching to Google-only or removing emojis later
 * is a one-file change.
 */

import React from 'react';
import { Image, Text, View, StyleSheet, type ViewStyle } from 'react-native';

export interface UserAvatarProps {
  /** Profile picture URL (Google `avatar_url` / `picture`). */
  avatarUrl?: string | null;
  /** Emoji picked via the in-app avatar picker. */
  emoji?: string | null;
  /** Falls back to this single character when neither URL nor emoji is set. */
  fallback: string;
  /** Background color for the circular badge. */
  backgroundColor: string;
  /** Diameter in px. */
  size: number;
  /** Font size for the emoji / fallback text. Defaults to size * 0.5. */
  textSize?: number;
  /** Additional style overrides on the circular container. */
  style?: ViewStyle;
  /** testID forwarded to the outer View. */
  testID?: string;
}

export const UserAvatar: React.FC<UserAvatarProps> = ({
  avatarUrl,
  emoji,
  fallback,
  backgroundColor,
  size,
  textSize,
  style,
  testID,
}) => {
  const radius = size / 2;
  const fontSize = textSize ?? Math.round(size * 0.5);
  const container: ViewStyle = {
    width: size,
    height: size,
    borderRadius: radius,
    backgroundColor,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  };

  if (avatarUrl) {
    return (
      <View testID={testID} style={[container, style]}>
        <Image
          source={{ uri: avatarUrl }}
          style={{ width: size, height: size, borderRadius: radius }}
        />
      </View>
    );
  }

  return (
    <View testID={testID} style={[container, style]}>
      <Text style={[styles.text, { fontSize, color: '#ffffff' }]}>
        {emoji || fallback}
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  text: {
    fontWeight: '700',
  },
});

export default UserAvatar;
