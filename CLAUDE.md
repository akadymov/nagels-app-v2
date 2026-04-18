# CLAUDE.md — Nagels Online

## Stack
Expo (React Native) + TypeScript + Supabase + Zustand

## Run
```bash
npx expo start --port 8081   # Dev server
npm run tunnel               # ngrok tunnel (device testing)
npm run demo                 # 2-player Playwright demo
npm run demo:6players        # 6-player demo
```

## Env
`EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`, `EXPO_PUBLIC_APP_URL`

## Key Principles
- **Mobile-first**: all UI validated for 6.1"–6.7" screens (Safari/Chrome/PWA)
- **Guest-first**: no registration required to play
- **i18n**: full EN / RU / ES support
- **Game logic is immutable**: Nagels rules preserved from [legacy reference](https://github.com/akadymov/nagels-app/blob/main/api/info_en.html)

## Sources of Truth
- [Legacy codebase](https://github.com/akadymov/nagels-app) — original Svelte/Firebase implementation
- [Product roadmap spreadsheet](https://docs.google.com/spreadsheets/d/117oYt6tzSbarLFpdtWTk-ohP1Usm7WvgBH-RtXKfbB4/edit?gid=1424757228#gid=1424757228)

## Workflow
Akula (User) provides strategic direction. Specialized agents in `.claude/agents/` handle domain-specific tasks. See `.claude/rules/` for immutable constraints.
