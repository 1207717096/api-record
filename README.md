# API Recorder · 网页接口抓取工具

通过 Chrome DevTools Protocol 录制浏览器中的所有网络请求，并将抓取到的接口导出为 JSON 文件。  
录制过程通过浏览器内右上角的悬浮面板控制：**开始录制 / 暂停录制**。

---

## ✨ 功能特性

- 🚀 **一行命令启动**：`record <url>` 自动打开 Chrome
- 🎬 **可视化录制面板**：浏览器内悬浮按钮，实时显示已捕获接口数
- 📡 **全量抓取请求**：基于 CDP Network 域，捕获 XHR / Fetch / 静态资源
- 📦 **请求/响应完整信息**：请求头、请求体、响应头、响应体（含 base64）
- 🔍 **实时预览**：录制中可随时点击「查看已捕获接口」预览列表
- 🚫 **忽略规则**：支持忽略静态资源、监控上报等噪音请求
- 💾 **自动导出**：暂停即在工具目录下生成 `api-records/apis_<时间戳>.json`
- 🔐 **保留登录态**：通过 `--user-data-dir` 复用浏览器数据目录

---

## 📦 安装

```bash
cd api-recorder
npm install
```

> 首次安装会自动下载 Chromium（约 170 MB），请耐心等待。

如果希望把 `record` 命令安装到全局：

```bash
npm link
```

之后即可在任意目录执行 `record <url>`。

---

## 🚀 快速开始

```bash
# 进入工具目录
cd api-recorder

# 录制指定页面（自动打开 Chrome）
./bin/record.js https://example.com
# 或者
node bin/record.js https://example.com

# 全局安装后可直接使用
record https://example.com
```

启动后：
1. Chrome 自动打开目标页面
2. 页面右上角出现 **API Recorder** 悬浮面板
3. 点击「**▶ 开始录制**」
4. 在页面里自由操作（点击、滚动、表单提交等），所有网络请求都会被捕获
5. 录制完成后点击「**⏸ 暂停录制**」
6. 工具目录下的 `api-records/` 子目录里会生成 `apis_<时间戳>.json`

---

## 📋 命令参数

```text
用法:  record <url> [options]

参数:
  url                              要打开并录制接口的目标网址

选项:
  -o, --output <path>              接口文件输出路径
  --width <number>                 浏览器宽度（默认 1440）
  --height <number>                浏览器高度（默认 900）
  --user-data-dir <path>           Chrome 用户数据目录，用于保留登录态
  --ignore <patterns>              忽略的 URL 模式，逗号分隔，例如 "*.png,*.css,*.js"
  -h, --help                       查看帮助
  -V, --version                    查看版本
```

### 使用示例

```bash
# 基本用法
record https://www.baidu.com

# 指定输出路径
record https://example.com -o ./my-apis.json

# 保留登录态（用于录制需要登录的页面）
record https://example.com --user-data-dir ./chrome-profile

# 忽略静态资源（只保留 API 请求）
record https://example.com --ignore "*.png,*.jpg,*.jpeg,*.gif,*.css,*.woff,*.woff2"

# 自定义窗口尺寸
record https://example.com --width 1920 --height 1080
```

---

## 📄 输出 JSON 文件结构

```json
{
  "meta": {
    "targetUrl": "https://example.com",
    "recordedAt": "2024-09-15T08:30:00.000Z",
    "total": 42,
    "successCount": 38,
    "failedCount": 4
  },
  "apis": [
    {
      "method": "POST",
      "url": "https://example.com/api/v1/login",
      "status": 200,
      "resourceType": "Fetch",
      "request": {
        "headers": { "Content-Type": "application/json" },
        "body": "{\"username\":\"admin\",\"password\":\"***\"}"
      },
      "response": {
        "headers": { "Content-Type": "application/json" },
        "body": "{\"code\":0,\"data\":{...}}",
        "bodyBase64": false,
        "size": 1024
      },
      "fromCache": false,
      "error": null,
      "startAt": "2024-09-15T08:30:12.345Z"
    }
  ]
}
```

> **提示**：响应体过大（> 2 MB）不会抓取；binary 响应会自动以 base64 编码保存。

---

## 🧩 工作原理

```
┌────────────────┐    CDP Network    ┌────────────────────┐
│  Chrome 浏览器  │ ◀──────────────▶ │  Node 主进程 (Puppeteer) │
│                │                   │                    │
│  ┌──────────┐  │  exposeFunction   │  - 维护 records    │
│  │ Overlay  │  │ ◀──────────────▶  │  - 暂停时导出 JSON │
│  │  面板    │  │                   │                    │
│  └──────────┘  │                   └────────────────────┘
│   用户点击      │
│  开始/暂停按钮  │
└────────────────┘
```

1. **Node 进程** 启动 Puppeteer 打开 Chrome，连接到页面的 CDP 会话
2. **CDP `Network.enable`** 开始抓取所有网络请求
3. **Node 进程** 通过 `page.evaluate` 注入 `overlay.js` 到页面（每次跨页面跳转都会重新注入）
4. 用户在页面右上角的悬浮面板点击「开始/暂停」 → 通过 `exposeFunction` 通知 Node 端
5. 用户点击暂停时，Node 端把所有 `records` 序列化为 JSON 写入文件

---

## ❓ 常见问题

**Q: 提示 `puppeteer` 下载失败？**
A: 设置环境变量使用镜像：
```bash
export PUPPETEER_DOWNLOAD_BASE_URL=https://npmmirror.com/mirrors/chrome-for-testing
npm install
```

**Q: 录制时只抓到 HTML，没抓到接口？**
A: 一定要先点击面板里的「开始录制」按钮，再触发业务请求；面板显示「录制中」红点闪烁才算成功。

**Q: 想录制 SPA 路由切换？**
A: SPA 切换通常不会触发完整页面跳转，但浏览器内的 XHR/Fetch 仍会被 CDP 拦截，无需特殊配置。

**Q: 如何只录制 JSON / XHR 类请求？**
A: 使用 `--ignore` 选项过滤掉其他资源，例如：
```bash
record https://example.com --ignore "*.png,*.jpg,*.gif,*.css,*.woff*,*.ttf,*.svg"
```

**Q: 重新进入页面后悬浮面板消失了？**
A: 工具会自动监听 `framenavigated` 事件并在每个主 frame 中重新注入面板。若发现丢失，请反馈 bug。

---

## 📁 目录结构

```
api-recorder/
├── bin/
│   └── record.js          # CLI 入口（#!/usr/bin/env node）
├── src/
│   ├── recorder.js        # 录制核心（CDP 抓包 + 导出）
│   └── overlay.js         # 浏览器内悬浮控制面板
├── api-records/           # 录制结果输出目录（自动创建）
├── package.json
└── README.md
```

---

## 📝 License

MIT
