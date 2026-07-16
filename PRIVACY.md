# Privacy

Codex Reset Radar is local-first and read-only.

## Data it reads

When enabled, the extension reads:

- public items from `https://api.dayclaw.com/`
- Codex usage metadata from
  `https://chatgpt.com/backend-api/wham/usage`
- banked reset-credit metadata from
  `https://chatgpt.com/backend-api/wham/rate-limit-reset-credits`

The two ChatGPT requests reuse the user's existing browser login. The
extension does not ask for an OpenAI API key.

## Data it stores

Persistent browser storage contains only derived display data:

- usage percentages and quota-window duration
- UTC/Unix reset timestamps
- available reset-credit count and expiry timestamps
- public-item IDs used for deduplication
- notification history
- extension settings

An access token may be cached in `chrome.storage.session` so a background
refresh can reuse the current browser session. Session storage is not
persistent and is cleared when the browser session ends.

The extension does not persist:

- access tokens or refresh tokens
- raw ChatGPT responses
- email addresses
- full account IDs or user IDs
- reset-credit IDs
- cookies
- prompts, files, or Codex conversation content

## Data it sends

Codex Reset Radar does not operate a server and does not include analytics,
advertising, telemetry, or crash reporting.

Requests are sent only to the public signal source and the two exact ChatGPT
endpoints listed above. The extension never redeems a reset credit or mutates
the user's account.

## Time zones

All timestamps are stored as UTC/Unix values. Display and notification times
are converted with `Intl.DateTimeFormat` using either:

- the browser/system IANA time zone; or
- a valid IANA time zone manually selected by the user.

This automatically follows daylight-saving-time rules supplied by the browser.
