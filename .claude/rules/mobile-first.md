---
description: Mobile-first UI/UX constraints for all screen and component work
paths: ["src/screens/**", "src/components/**"]
---

# Mobile-First UI Constraints

## Target Devices
- Screen size: 6.1" to 6.7" (iPhone 14/15/16, Pixel 7/8/9, Galaxy S series)
- Browsers: Safari, Chrome, PWA mode
- Must handle notch, Dynamic Island, and bottom home indicator

## Layout Rules
- Critical game actions (play card, place bet) must be in the **thumb zone** (bottom 40%)
- Minimum touch target: 44x44pt
- Safe areas: always respect `SafeAreaView` insets
- No horizontal scrolling in game views
- Cards must be readable without zooming

## Performance
- All animations at 60fps — use `transform` and `opacity` only
- Haptic feedback via `expo-haptics` for key interactions (card play, bet confirm)
- Blur effects (`expo-blur`) must not drop below 30fps on mid-range devices

## Accessibility
- WCAG AA contrast minimum
- All interactive elements must have accessible labels
- Support for Dynamic Type / system font scaling
