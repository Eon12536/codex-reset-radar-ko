# Contributing

Thanks for helping improve Codex Reset Radar.

## Development

Requirements:

- Node.js 20+
- Chrome or Microsoft Edge

```bash
npm install
npm run verify
```

Load the extension:

1. Open `chrome://extensions` or `edge://extensions`.
2. Enable Developer mode.
3. Choose **Load unpacked**.
4. Select this repository directory.

## Pull requests

- Keep the extension read-only.
- Do not persist auth tokens or account identifiers.
- Add tests for signal, quota, reset-credit, advice, or time-zone changes.
- Preserve missing and partial-data states.
- Update `CHANGELOG.md` for user-visible changes.
- Include screenshots when changing the popup or settings page.

## Design changes

The approved design artifact and implementation contract are stored under
`docs/design/`. Update the parity ledger when changing visible modules or
controls.
