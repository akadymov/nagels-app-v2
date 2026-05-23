import React from 'react';
import { Platform, Switch, type SwitchProps } from 'react-native';
import { useTheme } from '../hooks/useTheme';

/**
 * `<Switch>` wearing the app's brand palette.
 *
 * React Native Web defaults to a lime-green track that doesn't exist anywhere
 * else in our UI. Pass through to the platform component but force the on
 * state to `colors.accent` (brand blue) and the off state to `colors.glassLight`.
 * Web needs the legacy `activeThumbColor` / `activeTrackColor` extension to
 * actually override the CSS — both are forwarded when running on web.
 */
export const BrandSwitch: React.FC<SwitchProps> = (props) => {
  const { colors } = useTheme();
  const isOn = !!props.value;

  const trackColor = {
    false: colors.glassLight,
    true: colors.accent,
    ...(props.trackColor ?? {}),
  };

  const thumbColor =
    props.thumbColor ?? (Platform.OS === 'web' ? '#ffffff' : isOn ? '#ffffff' : '#f4f4f5');

  return (
    <Switch
      {...props}
      trackColor={trackColor}
      thumbColor={thumbColor}
      ios_backgroundColor={props.ios_backgroundColor ?? colors.glassLight}
      {...(Platform.OS === 'web'
        ? ({ activeThumbColor: '#ffffff', activeTrackColor: colors.accent } as object)
        : {})}
    />
  );
};
