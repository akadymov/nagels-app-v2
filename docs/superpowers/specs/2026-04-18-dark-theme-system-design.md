# Dark Theme System — Design Spec

## Goal
Add dark theme support with both system auto-detection and manual toggle.

## Architecture

### 1. Theme Colors (`src/constants/colors.ts`)
Replace single `Colors` object with `lightColors` and `darkColors` sharing the same keys. Export `getColors(theme)` for non-hook contexts.

**Shared across themes (unchanged):**
- Suit colors: spades `#1a1a1a`, hearts `#BE1931`, diamonds `#0094FF`, clubs `#308552`
- Status: success `#308552`, warning `#e67e22`, error `#b10000`
- Brand accent: `#13428f`

**Theme-specific:**
| Token | Light | Dark |
|-------|-------|------|
| background | `#e8e8e8` | `#141720` |
| surface | `#ffffff` | `#1F2130` |
| surfaceSecondary | `#f5f5f5` | `#292D38` |
| card | `#ffffff` | `#ffffff` |
| cardBorder | `#C7C7CC` | `#C7C7CC` |
| table | `#33734D` | `#595F70` |
| tableInner | `#296140` | `#4D5463` |
| textPrimary | `#1a1a1a` | `#EDEDED` |
| textSecondary | `#444444` | `#B3B3BA` |
| textMuted | `#888888` | `#737380` |
| profileBg | `rgba(8,10,14,0.7)` | `rgba(8,10,14,0.7)` |
| profileText | `#ffffff` | `#ffffff` |
| statusBarStyle | `dark-content` | `light-content` |
| statusBarBg | `#e8e8e8` | `#141720` |

Cards are white in both themes. Spades text is always black.

### 2. Settings Store (`src/store/settingsStore.ts`)
Zustand store persisted with AsyncStorage:
- `themePreference: 'system' | 'light' | 'dark'` (default: `'system'`)
- `fourColorDeck: boolean` (default: `true`)
- Setters for both

### 3. useTheme Hook (`src/hooks/useTheme.ts`)
Resolves final theme from preference + system color scheme:
- Returns `{ theme, colors, isDark }`
- Components use `colors.X` instead of `Colors.X`

### 4. App.tsx Updates
- StatusBar style/bg reactive to theme
- SafeAreaView bg reactive to theme
- No ThemeProvider wrapper needed — useTheme is self-contained via Zustand

### 5. Migration Strategy
Phase 1 (this spec): Create infrastructure + update App.tsx only.
Subsequent phases: Migrate individual screens/components from `Colors.X` to `useTheme()`.

## Files to Create
- `src/store/settingsStore.ts`
- `src/hooks/useTheme.ts`

## Files to Modify
- `src/constants/colors.ts` — add lightColors, darkColors, getColors
- `src/store/index.ts` — export settingsStore
- `src/App.tsx` — use useTheme for StatusBar + background

## Out of Scope
- Settings UI screen (Phase 5)
- Individual component migration (Phases 2-4)
- 4-color deck toggle implementation (Phase 2)
