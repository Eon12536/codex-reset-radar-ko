# Privacy

Codex Reset Radar is local-first and read-only.

## Data it reads

When enabled, the extension reads:

- public items from `https://api.dayclaw.com/`
- public incident data from `https://status.openai.com/`
- public reset-history and user-milestone data from `https://codex-resets.com/`
- public rate-limit issues from `https://api.github.com/repos/openai/codex/`
- Codex usage metadata from
  `https://chatgpt.com/backend-api/wham/usage`
- banked reset-credit metadata from
  `https://chatgpt.com/backend-api/wham/rate-limit-reset-credits`

The two ChatGPT requests are optional and reuse the user's existing browser
login. Without a ChatGPT login, the public-signal radar, forecast, and signal
notifications continue to work. The extension does not ask for an OpenAI API
key.

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

Requests are sent only to the four public sources and the two exact ChatGPT
endpoints listed above. GitHub issue authors and public incident text are
processed locally as weighted signal context and are not persisted as raw
responses. Public milestone dates are processed locally to derive a
community-experience forecast. The extension never redeems a reset credit or
mutates the user's account.

## Chrome Web Store limited use

Codex Reset Radar's use and transfer of information received from Chrome APIs
will adhere to the Chrome Web Store User Data Policy, including the Limited Use
requirements. User data is used only to provide the extension's disclosed
features. It is not sold, used for advertising or creditworthiness decisions,
or made available for humans to read except when required for security, legal
compliance, or user-requested support with explicit consent.

## Time zones

All timestamps are stored as UTC/Unix values. Display and notification times
are converted with `Intl.DateTimeFormat` using either:

- the browser/system IANA time zone; or
- a valid IANA time zone manually selected by the user.

This automatically follows daylight-saving-time rules supplied by the browser.
