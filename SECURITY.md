# Security policy

## Supported versions

Only the latest release and current `main` branch are supported.

## Reporting a vulnerability

Please use a private GitHub security advisory. Do not paste ChatGPT cookies,
access tokens, `auth.json`, raw endpoint responses, or screenshots containing
account identifiers into a public issue.

## Security boundaries

- The extension is read-only and contains no reset-redemption call.
- ChatGPT requests use exact HTTPS endpoint constants.
- Redirects are rejected for authenticated requests.
- Tokens are used in memory for authenticated reads and are never persisted.
- Account-scoped hashes, bounded counters and notification state remain local.
- Persisted snapshots exclude identifiers and raw response payloads.
- Manifest V3 remote hosted code is not used.
- No `eval` or dynamically downloaded executable JavaScript is allowed.

The ChatGPT endpoints are internal and may change without notice. Decoding is
tolerant, but missing or unrecognized fields are shown as unavailable rather
than guessed as zero.
