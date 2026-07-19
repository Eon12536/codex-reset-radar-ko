# Microsoft Edge 加载项提交材料

适用于 Codex Reset Radar v0.2.2。发布入口：Microsoft Partner Center 的 Microsoft Edge 工作区。

## 基本设置

- 可见性：公开（Public）
- 市场：所有市场，包括未来新增市场
- 定价：免费；当前版本没有应用内购买
- 类别：Productivity（效率）或 Developer Tools（如果后台提供该类别，优先选择）
- 官方网站：https://github.com/whmc76/codex-reset-radar
- 支持页面：https://github.com/whmc76/codex-reset-radar/issues
- 隐私政策：https://github.com/whmc76/codex-reset-radar/blob/main/PRIVACY.md
- 成人内容：否
- 远程代码：否

## 默认商店语言：英语（美国）

### 名称

Codex Reset Radar

### 简短说明

Analyze public Codex reset signals and get local advice about banked reset credits.

### 详细说明

Codex Reset Radar is an unofficial, local-first, read-only browser extension that brings public Codex reset signals, a deterministic time-window forecast for the next 72 hours, and optional ChatGPT quota and reset-credit information into one compact view.

It combines public information from OpenAI Status, Dayclaw, public community reset history, and GitHub community reports. Source weights and cross-source corroboration are used to estimate possible reset windows in six-hour slots. When the user is already signed in to ChatGPT, the extension can optionally display known five-hour and weekly quota windows, available reset-credit count, nearest known expiration, and read-only usage advice.

The extension provides configurable browser notifications, system or manual IANA time zones, quiet hours, and interfaces in English, Simplified Chinese, Japanese, Korean, French, Italian, Spanish, and Arabic. Arabic uses a right-to-left layout.

Codex Reset Radar has no project server, advertising, analytics, telemetry, or crash reporting. ChatGPT sign-in is optional. Quota and reset-credit data is processed only inside the browser, and a short-lived access token may be cached only in browser session storage. The extension does not read prompts, files, or conversations, never redeems reset credits, and never changes the user's account.

Forecast probabilities are deterministic estimates based on public information. They are not OpenAI internal information, plans, or promises. This is an unofficial community project and is not affiliated with or endorsed by OpenAI.

### 搜索词

Codex, quota, reset, credits, OpenAI, developer tools, usage monitor

## 简体中文商店说明

Codex Reset Radar 是一款非官方、本地优先、只读的浏览器扩展。它将公开的 Codex 重置信号、未来 72 小时的确定性时间窗口预测，以及可选的 ChatGPT 配额和重置积分信息集中显示在一个紧凑界面中。

扩展会汇总 OpenAI Status、Dayclaw、公开社区重置历史和 GitHub 社区报告，并根据来源权重与多来源印证，按每六小时一个时段估算可能的重置窗口。当用户已经登录 ChatGPT 时，还可以选择在本地显示已知的五小时和每周配额窗口、可用重置积分数量、最近过期时间以及只读使用建议。

扩展支持可配置的浏览器通知、系统或手动 IANA 时区、勿扰时段，并提供英语、简体中文、日语、韩语、法语、意大利语、西班牙语和阿拉伯语界面，阿拉伯语使用从右到左布局。

Codex Reset Radar 没有项目服务器、广告、分析、遥测或崩溃上报。ChatGPT 登录属于可选增强功能。配额和重置积分数据只在浏览器内处理，短期访问令牌只可能缓存在浏览器会话存储中。扩展不会读取提示词、文件或对话，不会兑换重置积分，也不会修改用户账户。

预测概率是依据公开信息生成的确定性估算，不代表 OpenAI 的内部信息、计划或承诺。本项目是非官方社区项目，与 OpenAI 没有隶属、合作或背书关系。

## 其他语言商店说明

首次打通发布链路时可在 Partner Center 使用 Duplicate 功能，将英语说明、Logo 和全球截图复制到日语、韩语、法语、意大利语、西班牙语和阿拉伯语语言项。后续版本再逐项替换为完整本地化营销文案。扩展自身界面已经支持全部八种语言。

## 隐私页

### 单一用途

监控公开的 Codex 配额重置信号，并在本地以只读方式预测可能的重置时间窗口。用户登录 ChatGPT 后，还可选择查看配额周期和重置积分状态，并接收本地通知及只读使用建议。

### alarms

用于在浏览器运行期间定时刷新公开的重置信号，以及用户主动启用的账户配额数据。该权限不用于用户跟踪、广告或行为分析。

### notifications

用于显示用户可配置的浏览器系统通知，包括公开重置信号、即将过期的重置积分和配额使用建议。用户可以随时在扩展设置中关闭通知。

### storage

用于在浏览器本地保存用户设置、公开信号快照、派生的配额状态、去重标识和通知状态。短期访问令牌仅可能保存在 chrome.storage.session 中，并会在浏览器会话结束后失效。

### tabs

仅在用户主动请求刷新账户数据时查找已经打开的 https://chatgpt.com 标签页，以及打开证据来源或扩展设置页面。扩展不会收集或保存用户的浏览历史。

### 主机权限

https://chatgpt.com/* 仅用于通过用户现有登录状态访问指定的会话、Codex 配额和重置积分接口；扩展不会读取用户的提示词、文件或对话内容。其他主机权限只用于获取公开的重置信号、服务事件、重置历史和公开问题元数据。

### 远程代码

选择“否”。所有可执行 JavaScript 和 CSS 均包含在提交的 ZIP 中。远程接口仅返回 JSON 或公开网页数据，这些内容仅作为数据解析，绝不会被评估或作为代码执行。

### 数据类型

只声明：

- 身份验证信息
- 网站内容

不声明个人身份信息、健康信息、财务信息、个人通讯、位置、浏览记录或用户活动。

## 认证测试说明

Codex Reset Radar is an unofficial, read-only monitoring extension. No test account is required for its core public-radar mode.

1. Install the extension and open its toolbar popup.
2. While signed out of ChatGPT, verify that the public signal radar, 72-hour forecast, evidence links, settings, time-zone controls, and public-signal notifications remain available.
3. Optional account features require the reviewer to already be signed in at https://chatgpt.com/. Open a ChatGPT tab, reopen the extension, and use Refresh. If the account exposes the relevant endpoints, the popup shows five-hour and weekly quota windows plus reset-credit metadata.
4. Open Settings to review source toggles, notification preferences, quiet hours, manual IANA time-zone mode, privacy information, and local-data clearing.
5. The extension is read-only. It does not redeem reset credits, modify an account, read prompts/files/conversations, or execute remote code.
6. Public source availability can vary temporarily. A source error is displayed as a partial-data state and does not prevent the remaining sources from working.

The extension supports English, Simplified Chinese, Japanese, Korean, French, Italian, Spanish, and Arabic. Change the browser UI language and restart the browser to verify localization; Arabic uses a right-to-left layout.

## 素材上传顺序

1. `codex-reset-radar-icon-128.png`：各语言扩展 Logo，可使用 Duplicate 复制。
2. `global-01-radar-quota-1280x800.png`
3. `global-02-privacy-1280x800.png`
4. `global-03-eight-languages-1280x800.png`
5. `global-small-tile-440x280.png`

视频和其他宣传图留空。
