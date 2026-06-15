> ⚠️ **DRAFT — NOT PUBLISHED, NOT LEGAL ADVICE.**
> Working draft for the Discord Activity verification path. Review (ideally with a
> lawyer) and fill the placeholders before publishing or referencing it from the
> Discord Developer Portal. Keep this in sync with the actual data flows as the
> Discord integration evolves (esp. Discord auth and account linking).
>
> **Placeholders to fill before publishing:**
> - `[OPERATOR]` — legal entity / individual operating Nägels Online.
> - `[JURISDICTION]` — primary jurisdiction.
> - `[CONTACT_EMAIL]` — privacy / data-request contact address.
> - `[EFFECTIVE_DATE]` — the date this Policy takes effect.
>
> Last drafted: 2026-06-15.

# Privacy Policy — Nägels Online (DRAFT)

`[OPERATOR]` ("we", "us") operates **Nägels Online** (the "Service") — a free
card game on the web, as a PWA, and as a Discord Activity. This Policy explains
what we collect, why, and your choices. We aim to collect as little as possible.

## 1. Data we collect

**Identity / profile**
- *Guest play:* a randomly generated session identifier stored on your device, the
  nickname you choose, and your selected avatar.
- *Optional account (e.g. Google sign-in):* your email address, display name, and
  avatar provided by the identity provider, used to persist your profile and stats.
- *Discord Activity:* when you launch the Service inside Discord, we may receive a
  limited set of Discord profile data via Discord's Embedded App SDK — your Discord
  user ID, username, and avatar — used to identify you in the game. We do not
  receive your Discord password or message history.

**Gameplay**
- Rooms you join, game state, bids, tricks, scores, and in-game chat messages you
  send.

**Notifications (opt-in only)**
- If you enable notifications, we store the technical subscription needed to
  deliver them (e.g. a Web Push subscription, or a Telegram chat identifier).

**Technical**
- Standard server/operational data such as IP address, device/browser type, and
  logs, processed by our infrastructure providers for delivery, security, and
  abuse prevention.

We do **not** run third-party advertising or cross-site tracking, and we do **not**
sell your personal data.

## 2. How we use data

- To run the game and synchronize real-time multiplayer rooms.
- To persist your nickname, avatar, and stats if you use an account.
- To deliver notifications you have opted into.
- To keep the Service secure, prevent cheating/abuse, and diagnose problems.

## 3. Legal bases (where GDPR applies)

- **Performance of the service** — to provide gameplay you request.
- **Consent** — for optional sign-in and for notifications; you can withdraw it.
- **Legitimate interests** — security, abuse prevention, and basic operation.

## 4. Service providers / sub-processors

We share data only with providers that help us run the Service, under their terms:

- **Supabase** — database, authentication, and real-time backend.
- **Vercel** — application hosting.
- **Google** — only if you choose Google sign-in.
- **Discord** — when you use the Service as a Discord Activity (data flows through
  Discord's Embedded App SDK / proxy); your use is also governed by Discord's
  Privacy Policy.
- **Web Push / Telegram** — only if you opt into notifications.

## 5. Data retention

- *Guest data* persists until you clear your device storage or after a period of
  inactivity.
- *Account data* is retained while your account exists and is removed on deletion,
  subject to limited retention required for security or legal reasons.

## 6. Your rights

Depending on your location, you may have the right to access, correct, delete, or
export your personal data, and to withdraw consent. Guest data can typically be
removed by clearing your device storage; for account or other requests, contact us
at `[CONTACT_EMAIL]`.

## 7. Children

The Service is not directed to children under 13 (or the minimum digital age of
consent in your country, if higher). When used inside Discord, Discord's own age
requirements also apply. We do not knowingly collect data from children below that
age; if you believe we have, contact us and we will delete it.

## 8. Security

We use reasonable technical and organizational measures to protect data. No method
of transmission or storage is completely secure, so we cannot guarantee absolute
security.

## 9. International transfers

Our providers may process data in countries other than yours. Where required, such
transfers rely on appropriate safeguards.

## 10. Changes to this Policy

We may update this Policy; we will update the effective date and, for material
changes, provide an in-app or in-channel notice.

## 11. Contact

Privacy questions or data requests: `[CONTACT_EMAIL]`.

Effective date: `[EFFECTIVE_DATE]`.
