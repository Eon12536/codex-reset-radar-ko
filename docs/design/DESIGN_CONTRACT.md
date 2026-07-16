# Design contract

- **Authoritative artifact:** `docs/design/codex-reset-radar-ui.png`
- **Popup shell:** fixed 420×600 Chrome/Edge popup; all primary data remains
  visible without vertical scrolling.
- **Settings shell:** fixed 210px navigation rail and a restrained linear
  settings workspace; responsive single-column layout below 900px.
- **Visual system:** graphite background, thin hairline borders, 8–16px radii,
  warm off-white text, amber for actionable signals, teal for healthy state,
  red only for blocked or expiring states.
- **Popup module order:** header, official-reset signal, quota windows, banked
  resets, recommendation, refresh/status footer.
- **Settings module order:** monitoring, strategy, time zone, notifications,
  data/privacy, about.
- **Notifications:** native `chrome.notifications` content only. Custom visual
  chrome in the design is illustrative; implementation controls title, body,
  icon, context, and action buttons.
- **Time contract:** persist UTC/Unix timestamps; render with system IANA time
  zone or a valid manual override.
- **Data lifecycle:** no mock production data. Empty, signed-out, partial,
  source-error, and live states are explicit. Manual refresh attempts a content
  capture from an existing ChatGPT tab before the background fallback.
- **Must not exist:** automatic credit redemption, remote analytics, account ID
  display, persisted auth token, generic dashboard-card mosaic.

## Module mapping

| Design module | Implementation owner | Action | Verification |
| --- | --- | --- | --- |
| 420×600 popup shell | `src/popup/*` | create | viewport and screenshot |
| Radar signal area | `popup.html`, `signals.js` | create | `#signalHeadline`, evidence action |
| Two quota meters | `usage.js`, `popup.js` | create | two `.quota-row` nodes |
| Banked reset row | `usage.js`, `popup.js` | create | `#creditsCount` and expiry text |
| Advice strip | `advice.js`, `popup.js` | port and extend | tier tests and screenshot |
| Settings rail | `options.html`, `options.css` | create | four `.nav-item` nodes |
| Time-zone controls | `time.js`, `options.js` | create | system/manual interaction test |
| Native notifications | `background.js` | create | notification payload tests/manual QA |
