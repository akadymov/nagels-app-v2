import React from 'react';
import { Platform, Switch, View, type SwitchProps } from 'react-native';
import { useTheme } from '../hooks/useTheme';

/**
 * `<Switch>` wearing the app's brand palette.
 *
 * React Native Web defaults to a lime-green track that doesn't exist anywhere
 * else in our UI. Pass through to the platform component but force the on
 * state to `colors.accent` (brand blue) and the off state to `colors.glassLight`.
 * Web needs the legacy `activeThumbColor` / `activeTrackColor` extension to
 * actually override the CSS — both are forwarded when running on web.
 *
 * Disabled rendering: thumb goes to a muted gray and overall opacity drops so
 * the control reads as "not clickable" without looking like just-off. Plain
 * `disabled` on RN's Switch only blocks input; the colors don't change.
 */
export const BrandSwitch: React.FC<SwitchProps> = (props) => {
  const { colors } = useTheme();
  const isOn = !!props.value;
  const isDisabled = !!props.disabled;

  // Disabled palette overrides everything: a muted track that doesn't pull
  // the eye, and a clearly-gray thumb circle so users don't try to drag it.
  const disabledTrackColor = colors.glassLight;
  const disabledThumbColor = colors.textMuted ?? '#a1a1aa';

  const trackColor = isDisabled
    ? { false: disabledTrackColor, true: disabledTrackColor }
    : {
        false: colors.glassLight,
        true: colors.accent,
        ...(props.trackColor ?? {}),
      };

  const thumbColor = isDisabled
    ? disabledThumbColor
    : props.thumbColor ?? (Platform.OS === 'web' ? '#ffffff' : isOn ? '#ffffff' : '#f4f4f5');

  const webOverrides = Platform.OS === 'web'
    ? isDisabled
      ? ({ activeThumbColor: disabledThumbColor, activeTrackColor: disabledTrackColor } as object)
      : ({ activeThumbColor: '#ffffff', activeTrackColor: colors.accent } as object)
    : {};

  // Wrap so we can also reduce opacity on the whole control; RN's Switch
  // does not pick up its parent's opacity reliably on web.
  return (
    <View style={isDisabled ? { opacity: 0.55 } : undefined}>
      <Switch
        {...props}
        trackColor={trackColor}
        thumbColor={thumbColor}
        ios_backgroundColor={
          isDisabled ? disabledTrackColor : (props.ios_backgroundColor ?? colors.glassLight)
        }
        {...webOverrides}
      />
    </View>
  );
};
