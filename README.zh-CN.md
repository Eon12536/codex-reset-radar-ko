# Codex Reset Radar

[English](README.md)

Codex Reset Radar 是一个本地优先的 Chrome/Edge 扩展，把以下能力放进同一个插件：

- 监控公开动态中的官方 Codex 额度重置信号
- 显示当前 5 小时和每周额度
- 显示已存重置券数量与过期时间
- 给出“使用还是保留重置券”的只读建议
- 通过浏览器原生系统通知提醒

![已确认的 UI 设计稿](docs/design/codex-reset-radar-ui.png)

## 已实现界面

![420×600 扩展弹窗](docs/screenshots/popup.png)

![响应式设置页](docs/screenshots/settings.png)

> [!IMPORTANT]
> 这是非官方社区项目，与 OpenAI 无隶属或背书关系。插件不会自动兑换
> 重置券，也不会修改账户。

## 为什么做这个项目

官方可能临时重置额度，以及用户是否应该使用已存重置券，是两个不同问题：

1. **OpenAI 是否可能很快重置额度？**
2. **我现在是否应该使用一张重置券？**

这个插件把两类信息合并成一个可执行建议。

## 主要功能

- **多源公开信号雷达**：加权检查 Codex 负责人动态、OpenAI Status、社区重置历史和 OpenAI/Codex GitHub 额度反馈。
- **日期与时段预测**：把有效公开信号换算成未来 72 小时、每 6 小时一档的启发式概率。
- **额度监控**：显示可信的 5 小时和每周窗口；后端未提供窗口长度时不会猜测。
- **重置券监控**：以服务端的 `available_count` 为准，并显示最近的已知过期时间。
- **建议引擎**：按受限状态、重置券过期、官方信号、短期窗口恢复、每周容量等优先级判断。
- **用户时区换算**：内部保存 UTC/Unix 时间戳，展示时按系统 IANA 时区或手动时区换算。
- **原生通知**：支持官方重置信号、重置券过期、额度建议、通知按钮和勿扰时段。
- **本地优先**：没有项目服务器、分析埋点、遥测或 API Key。
- **八种界面语言**：自动跟随 Chrome，支持英语、简体中文、日语、韩语、法语、
  意大利语、西班牙语和阿拉伯语，并为阿拉伯语提供从右到左布局。

## 从源码安装

1. 下载或克隆本仓库。
2. 执行：

   ```bash
   npm install
   npm run verify
   ```

3. 打开 `chrome://extensions` 或 `edge://extensions`。
4. 开启“开发者模式”。
5. 点击“加载已解压的扩展程序”。
6. 选择本仓库目录。

此时无需登录即可使用公开信号雷达、时间预测和信号通知。如果还需要显示个人
额度、重置券状态与个性化建议，再在同一个浏览器中登录 ChatGPT。

`npm run build` 会同时在 `dist/` 目录生成可分发 ZIP。

## 权限说明

| 权限 | 用途 |
| --- | --- |
| `storage` | 保存设置、脱敏额度快照、信号去重 ID 和通知记录 |
| `alarms` | 在 Manifest V3 后台可靠地定时检查 |
| `notifications` | 显示系统通知 |
| `tabs` | 打开证据/设置页，并请求已有 ChatGPT 标签页即时刷新 |
| `https://chatgpt.com/*` | 通过现有登录读取 Codex 额度和重置券元数据 |
| `https://api.dayclaw.com/*` | 读取公开重置信号源 |
| `https://status.openai.com/*` | 读取 OpenAI 官方故障与恢复动态 |
| `https://codex-resets.com/*` | 读取公开的历史重置与用户里程碑记录 |
| `https://api.github.com/*` | 读取 OpenAI/Codex 仓库中公开的额度问题 |

完整隐私边界参见 [PRIVACY.md](PRIVACY.md)。

## 时区处理

后端时间始终保存为 UTC/Unix 值。弹窗、设置页、勿扰时段和通知文案在展示时通过
`Intl.DateTimeFormat` 换算。

默认跟随浏览器/系统 IANA 时区，也可以手动指定，例如：

- `Asia/Shanghai`
- `America/Los_Angeles`
- `Europe/London`
- `UTC`

无效的手动时区会被拒绝，不会静默使用错误时间。

## 概率预测边界

弹窗展示未来 72 小时的分时段重置概率。预测由公开动态的分类得分、来源权重、
交叉印证数量、历史里程碑节奏和推测事件时间确定，并按用户时区切分为 6 小时时段。
Codex 负责人动态、OpenAI Status、社区重置历史、GitHub 社区反馈的默认权重分别为
`1.00`、`0.70`、`0.58`、`0.35`。连续且近期的百万用户里程碑可形成中可信预测，
但界面会明确标记为社区经验，不会当作官方公告。
没有有效公开信号时只显示低基线。该数值是确定性规则估算，不是统计模型、
OpenAI 内部信息或官方承诺，不能用于保证某个时段一定发生重置。

## 建议优先级

建议引擎按照以下顺序判断：

1. 当前账户是否已经受限
2. 是否有重置券在 24 小时内过期
3. 是否存在高可信的未来官方重置信号
4. 账户数据是否缺失或不完整
5. 5 小时额度是否很低、距离恢复多久
6. 每周额度是否很低、距离恢复多久
7. 当前容量是否健康、是否应该保留重置券

插件只提供建议。兑换操作必须由用户在官方 Codex 界面完成。

## 开发与验证

```bash
npm test
npm run lint
npm run build
npm run verify
```

项目使用原生 Manifest V3 JavaScript、HTML 和 CSS，不包含远程托管代码。

## 致谢与版权

项目直接移植和改进了以下 MIT 项目的部分思路与代码：

- `jordan-edai/codex-reset-watcher`
- `codexquotamonitor/codex-quota-monitor`

项目也受到 `thinkingjimmy/codex-reset-watchdog` 启发；由于参考版本没有通过
GitHub 暴露许可证，本仓库没有复制其源代码。详见
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

## 协议

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
