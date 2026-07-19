# Codex Reset Radar

[简体中文](README.zh-CN.md)

Codex Reset Radar is a local-first Chrome/Edge extension that combines:

- possible official Codex quota-reset signals from public posts
- current 5-hour and weekly usage windows
- banked reset-credit count and expiry times
- read-only advice about whether to spend or hold a reset credit
- native browser notifications

![Approved UI design](docs/design/codex-reset-radar-ui.png)

## Implemented interface

![420 by 600 extension popup](docs/screenshots/popup.png)

![Responsive settings page](docs/screenshots/settings.png)

> [!IMPORTANT]
> This is an unofficial community project. It is not affiliated with or
> endorsed by OpenAI. The extension never redeems reset credits or changes your
> account.

## Why this exists

An official reset announcement and a banked reset credit answer different
questions:

1. **Could OpenAI reset limits soon?**
2. **Should I use a reset credit right now?**

Codex Reset Radar puts both decisions in one compact browser surface.

## Features

- **Weighted multi-source radar** — checks the Codex lead's public posts,
  OpenAI Status, community reset history, and public rate-limit reports in the
  OpenAI/Codex repository.
- **Date/time forecast** — converts an active public signal into heuristic
  probabilities for six-hour slots over the next 72 hours.
- **Quota monitor** — shows known 5-hour and weekly windows without guessing
  when the backend omits a trustworthy duration.
- **Banked resets** — uses the authoritative available count and shows the
  nearest known expiry.
- **Advice engine** — blocked state, expiring credits, official signals,
  short-window refill timing, weekly capacity, and reset count are evaluated in
  a strict priority order.
- **Time-zone aware** — stores UTC/Unix timestamps and renders them using the
  system IANA time zone or a valid manual override.
- **Native notifications** — supports official-reset signals, credit expiry,
  quota advice, action buttons, and quiet hours.
- **Local-first privacy** — no project server, analytics, telemetry, or API key.
- **Eight interface languages** — automatically follows Chrome in English,
  Simplified Chinese, Japanese, Korean, French, Italian, Spanish, or Arabic,
  including right-to-left layout for Arabic.

## Install from source

1. Download or clone this repository.
2. Run:

   ```bash
   npm install
   npm run verify
   ```

3. Open `chrome://extensions` or `edge://extensions`.
4. Enable **Developer mode**.
5. Choose **Load unpacked**.
6. Select the repository directory.

The public-signal radar, time forecast, and signal notifications work without
signing in. Sign in to ChatGPT in the same browser only if you also want
personal quota, reset-credit status, and personalized advice.

The build command also creates a distributable zip under `dist/`.

## Permissions

| Permission | Why it is needed |
| --- | --- |
| `storage` | Save settings, sanitized quota snapshots, signal IDs, and notification dedupe state |
| `alarms` | Schedule durable Manifest V3 background checks |
| `notifications` | Display native system notifications |
| `tabs` | Open evidence/settings and ask an existing ChatGPT tab for a fresh read |
| `https://chatgpt.com/*` | Read Codex usage and reset-credit metadata from the existing login |
| `https://api.dayclaw.com/*` | Read the configured public reset-signal source |
| `https://status.openai.com/*` | Read official OpenAI incident and recovery updates |
| `https://codex-resets.com/*` | Read public reset history and user-milestone records |
| `https://api.github.com/*` | Read public rate-limit issues in the OpenAI/Codex repository |

See [PRIVACY.md](PRIVACY.md) for the complete data boundary.

## Time zones

Backend timestamps remain UTC/Unix values. The popup, settings page, quiet
hours, and notification copy convert them at render time with
`Intl.DateTimeFormat`.

Default: follow the browser/system IANA time zone.

Manual examples:

- `Asia/Shanghai`
- `America/Los_Angeles`
- `Europe/London`
- `UTC`

Invalid manual time zones are rejected and never silently used.

## Forecast boundary

The popup shows a 72-hour reset forecast in six-hour slots. It derives the
estimate from classifier score, source weight, corroborating source count,
recent milestone cadence, and approximate event time, rendered in the user's
time zone. The default weights are `1.00` for the Codex lead's public feed,
`0.70` for OpenAI Status, `0.58` for community reset history, and `0.35` for
GitHub community reports. A recent sequence of million-user milestones can
produce a medium-confidence forecast, but remains labeled as community
experience rather than an official announcement. With no active signal it
shows only a low baseline. This is a deterministic heuristic—not a statistical
model, private OpenAI information, or an official commitment.

## Advice priority

The engine evaluates in this order:

1. Account blocked now
2. Reset credit expires within 24 hours
3. High-confidence future official-reset signal
4. Missing or partial account data
5. Very low 5-hour capacity and refill distance
6. Low weekly capacity and weekly reset distance
7. Healthy capacity / hold advice

Advice is informational. The user must redeem a credit inside an official
Codex surface.

## Development

```bash
npm test
npm run lint
npm run build
npm run verify
```

The project intentionally uses plain Manifest V3 JavaScript, HTML, and CSS:
there is no runtime framework and no remotely hosted code.

## Architecture

```text
Weighted public sources ─> signal classifier ─> time-slot forecast ─┐
                                                                   ├─> popup / badge / notifications
ChatGPT usage + reset credits ─> tolerant normalization ─┘
```

Persistent storage contains derived display values only. A short-lived access
token may be cached in `chrome.storage.session`, never local persistent
storage.

## Attribution

The project directly ports and adapts MIT-licensed ideas/code from
`jordan-edai/codex-reset-watcher` and
`codexquotamonitor/codex-quota-monitor`.

It is also inspired by `thinkingjimmy/codex-reset-watchdog`; no source from
that repository is included because its license was not exposed at the
referenced revision. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## License

[MIT](LICENSE)

---

## ❤️ 支持与关注 / Support & Follow

> 开源代码可以免费，但显卡、电费、服务器和咖啡豆暂时还没学会开源。

你好，我是**赛博迪克朗**。我平时给 AI 喂提示词、给 ComfyUI 接管线，也负责修复那些“昨天明明还能跑”的神秘问题。教程里看起来三分钟解决的事，背后往往是三十次失败和一句又一句“这不应该啊”。

如果这个项目帮你少踩了一个坑、少重装了一次环境，那些和报错窗口深情对视的夜晚就算没有白熬。欢迎通过下面的方式支持和关注：

- [💙 支付宝 / Alipay](https://github.com/whmc76/.github/blob/main/SUPPORT.md#alipay)
- [🌍 PayPal](https://paypal.me/CyberDickLang)
- [📺 哔哩哔哩 / Bilibili](https://space.bilibili.com/339984)
- [▶️ YouTube](https://www.youtube.com/@CyberDickLang)

抖音、小红书、快手、今日头条、微信视频号、X：搜索全网统一名称 **“赛博迪克朗”**。

**不赞助也完全没关系。** 使用、Star、反馈、分享，甚至一句“这东西真能用”，都是继续更新的动力。谢谢你让这个项目不只是躺在我的硬盘里感动自己。
