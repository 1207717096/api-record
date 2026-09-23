/**
 * Recorder 核心
 * 1) 启动 Puppeteer/Chrome
 * 2) 注入 overlay 控制面板
 * 3) 通过 CDP Network 域抓取请求
 * 4) 与 overlay 通信：开始 → 抓取，暂停 → 导出 JSON
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const puppeteer = require('puppeteer-core');
const chalk = require('chalk');

const OVERLAY_SOURCE = fs.readFileSync(
  path.join(__dirname, 'overlay.js'),
  'utf8'
);

/**
 * 自动探测系统 Chrome 路径（macOS / Windows / Linux）
 */
function detectChromePath() {
  const candidates = [];
  if (process.platform === 'darwin') {
    candidates.push(
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Google Chrome Beta.app/Contents/MacOS/Google Chrome Beta',
      '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      `${os.homedir()}/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`,
    );
  } else if (process.platform === 'win32') {
    candidates.push(
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
      `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
    );
  } else {
    candidates.push(
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable',
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser',
      '/snap/bin/chromium',
      '/usr/bin/microsoft-edge',
    );
  }
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return p;
    } catch {}
  }
  // 兜底：交给 puppeteer-core（后续会报错提示）
  return undefined;
}

class Recorder {
  constructor(options) {
    this.url = options.url;
    this.outputPath = options.outputPath;
    this.width = options.width || 1440;
    this.height = options.height || 900;
    this.userDataDir = options.userDataDir;
    this.chromePath = options.chromePath || detectChromePath();
    this.ignorePatterns = options.ignorePatterns || [];

    this.browser = null;
    this.page = null;
    this.cdp = null;
    this.records = [];
    this.requestBodies = new Map(); // requestId -> { postData, headers }
    this.injected = false;
  }

  async start() {
    console.log(chalk.cyan('🚀 启动 Chrome ...'));
    if (this.chromePath) {
      console.log(chalk.gray(`   可执行路径：${this.chromePath}`));
    } else {
      console.log(chalk.yellow('⚠ 未自动探测到 Chrome，可通过 --chrome-path 指定'));
    }

    const launchOpts = {
      headless: false,
      defaultViewport: { width: this.width, height: this.height },
      executablePath: this.chromePath,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-blink-features=AutomationControlled',
        `--window-size=${this.width},${this.height}`,
      ],
    };
    if (this.userDataDir) launchOpts.userDataDir = this.userDataDir;

    try {
      this.browser = await puppeteer.launch(launchOpts);
    } catch (err) {
      throw new Error(
        `启动 Chrome 失败：${err.message}\n` +
          `请确认已安装 Chrome，或通过 --chrome-path 指定可执行文件路径\n` +
          `macOS 默认查找：/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`
      );
    }
    this.page = await this.browser.newPage();

    // 注入 CDP，启用 Network 域抓包
    this.cdp = await this.page.target().createCDPSession();
    await this.cdp.send('Network.enable');
    await this.cdp.send('Page.enable');

    this._bindNetworkHandlers();

    // 监听帧导航，每个新 frame 也注入 overlay
    this.page.on('framenavigated', async (frame) => {
      if (frame === this.page.mainFrame()) {
        await this._injectOverlayToFrame(frame);
      }
    });

    // 监听 console 错误
    this.page.on('console', (msg) => {
      if (msg.type() === 'error') {
        console.log(chalk.gray(`  [console.error] ${msg.text()}`));
      }
    });

    // 首次导航到目标 URL
    console.log(chalk.cyan(`🌐 打开页面：${this.url}`));
    await this.page.goto(this.url, { waitUntil: 'domcontentloaded', timeout: 60000 });

    // 设定 overlay 回调：从浏览器拿记录 / 收暂停信号
    await this._bindOverlayBridge();

    // 等待用户操作（窗口关闭或 Ctrl+C）
    console.log(chalk.green.bold('\n✔ Chrome 已打开，请在右上角点击「开始录制」开始抓取接口\n'));
    console.log(chalk.gray('  · 录制中再次点击「暂停录制」即可导出 JSON 文件'));
    console.log(chalk.gray('  · 直接关闭浏览器窗口可退出程序\n'));

    await this._waitForExit();
  }

  // ---------- CDP 网络监听 ----------
  _bindNetworkHandlers() {
    this.cdp.on('Network.requestWillBeSent', (params) => {
      const { requestId, request, type, initiator } = params;
      // 跳过 data: 等内联资源
      if (!request.url || request.url.startsWith('data:')) return;
      if (this._shouldIgnore(request.url)) return;

      // 保存请求体等
      this.requestBodies.set(requestId, {
        postData: request.postData,
        headers: request.headers,
      });

      this.records.push({
        requestId,
        method: request.method,
        url: request.url,
        resourceType: type,
        initiator: initiator ? initiator.type : undefined,
        startAt: new Date().toISOString(),
        requestHeaders: request.headers,
        requestBody: request.postData || null,
        status: null,
        responseHeaders: null,
        responseBody: null,
        finished: false,
        error: null,
      });
    });

    this.cdp.on('Network.responseReceived', (params) => {
      const rec = this.records.find((r) => r.requestId === params.requestId);
      if (!rec) return;
      rec.status = params.response.status;
      rec.responseHeaders = params.response.headers;
      rec.fromCache = params.response.fromDiskCache || params.response.fromServiceWorker || false;
    });

    this.cdp.on('Network.loadingFinished', async (params) => {
      const rec = this.records.find((r) => r.requestId === params.requestId);
      if (!rec) return;
      rec.finished = true;
      rec.encodedDataLength = params.encodedDataLength;
      // 抓取响应体（仅对 XHR/Fetch 类型，且大小适中）
      if (this._shouldCaptureBody(rec)) {
        try {
          const res = await this.cdp.send('Network.getResponseBody', {
            requestId: params.requestId,
          });
          rec.responseBody = res.body;
          rec.responseBodyBase64 = res.base64Encoded;
        } catch (e) {
          rec.responseBodyError = e.message;
        }
      }
      this._notifyOverlay(rec);
    });

    this.cdp.on('Network.loadingFailed', (params) => {
      const rec = this.records.find((r) => r.requestId === params.requestId);
      if (!rec) return;
      rec.finished = true;
      rec.error = params.errorText || 'failed';
      this._notifyOverlay(rec);
    });
  }

  _shouldIgnore(url) {
    return this.ignorePatterns.some((pat) => {
      const re = new RegExp(
        '^' +
          pat
            .replace(/[.+^${}()|[\]\\]/g, '\\$&')
            .replace(/\*/g, '.*') +
          '$'
      );
      return re.test(url);
    });
  }

  _shouldCaptureBody(rec) {
    if (!rec.url) return false;
    // 仅 XHR / Fetch
    if (!['XHR', 'Fetch'].includes(rec.resourceType)) return false;
    // 过大不抓（> 2MB）
    if (rec.encodedDataLength && rec.encodedDataLength > 2 * 1024 * 1024) return false;
    return true;
  }

  // ---------- Overlay 注入 ----------
  async _injectOverlayToFrame(frame) {
    if (!frame || frame.isDetached()) return;
    try {
      await frame.evaluate(OVERLAY_SOURCE);
      // 重新绑定当前帧的 bridge
      await this._bindOverlayBridge();
    } catch (e) {
      // 某些受限页面（chrome:// 等）注入失败，忽略
    }
  }

  async _bindOverlayBridge() {
    try {
      // 监听 overlay 新增记录 → 同步到 Node 端计数
      await this.page.exposeFunction('__arOnRecord', (rec) => {
        // 由 cdp 直接维护 records，此处仅用于通知浏览器 UI 更新
        if (this.page && !this.page.isClosed()) {
          this.page.evaluate((r) => window.__apiRecorder?.addRecord(r), rec).catch(() => {});
        }
      });

      await this.page.exposeFunction('__arOnPause', () => {
        this._handlePause().catch((e) =>
          console.error(chalk.red('导出失败：'), e.message)
        );
      });

      await this.page.evaluate(() => {
        if (!window.__arBridged) {
          window.__arBridged = true;
        }
      });
    } catch (e) {
      // exposeFunction 在已经暴露过同名函数时会抛错，忽略
    }
  }

  _notifyOverlay(rec) {
    if (!this.page || this.page.isClosed()) return;
    this.page
      .evaluate(
        (r) => {
          if (window.__apiRecorder?.isRecording()) {
            window.__apiRecorder.addRecord(r);
          }
        },
        rec
      )
      .catch(() => {});
  }

  // ---------- 暂停 / 导出 ----------
  async _handlePause() {
    console.log(chalk.yellow('\n⏸  暂停录制，准备导出 JSON ...'));

    // 给最后一波响应体抓取一点时间
    await new Promise((r) => setTimeout(r, 500));

    const filePath = await this._exportToFile();
    const apiCount = this.records.filter(
      (r) => ['XHR', 'Fetch'].includes(r.resourceType)
    ).length;

    console.log(chalk.green.bold(`\n✔ 已导出 ${apiCount} 条 API 接口到 (Postman Collection v2.1)：`));
    console.log(chalk.white(`  ${filePath}\n`));

    try {
      await this.page.evaluate((info) => {
        if (window.__apiRecorder) {
          window.__apiRecorder.pause();
          const status = document.querySelector('#__api_recorder_panel__ .ar-status');
          if (status) {
            status.innerHTML = `✅ 已导出 <b style="color:#34d399">${info.count}</b> 条 API 接口 (Postman格式) 到 <code style="color:#60a5fa">${info.path}</code>`;
          }
        }
      }, { count: apiCount, path: filePath });
    } catch (e) {}
  }

  async _exportToFile() {
    const apiRecords = this.records.filter(
      (r) => ['XHR', 'Fetch'].includes(r.resourceType)
    );

    const items = apiRecords.map((r) => {
      const urlObj = new URL(r.url);
      const item = {
        name: `${r.method} ${urlObj.pathname}`,
        request: {
          method: r.method,
          header: Object.entries(r.requestHeaders || {}).map(([key, value]) => ({
            key,
            value,
          })),
          url: {
            raw: r.url,
            protocol: urlObj.protocol.replace(':', ''),
            host: urlObj.hostname.split('.'),
            port: urlObj.port || '',
            path: urlObj.pathname.split('/').filter(Boolean),
            query: Array.from(urlObj.searchParams.entries()).map(([key, value]) => ({
              key,
              value,
            })),
          },
        },
        response: [],
      };

      if (r.requestBody) {
        item.request.body = { mode: 'raw', raw: r.requestBody };
        const ct = (r.requestHeaders || {})['Content-Type'] || (r.requestHeaders || {})['content-type'] || '';
        if (ct.includes('application/json')) {
          item.request.body.options = { raw: { language: 'json' } };
        }
      }

      if (r.status != null) {
        const resp = {
          name: `${r.status} Response`,
          originalRequest: item.request,
          status: r.status < 400 ? 'OK' : 'Error',
          code: r.status,
          header: Object.entries(r.responseHeaders || {}).map(([key, value]) => ({
            key,
            value,
          })),
          body: r.responseBody || '',
        };
        item.response.push(resp);
      }

      return item;
    });

    const collection = {
      info: {
        name: `API Record - ${new URL(this.url).hostname}`,
        description: `Recorded from ${this.url} at ${new Date().toISOString()}`,
        schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
      },
      item: items,
    };

    fs.writeFileSync(this.outputPath, JSON.stringify(collection, null, 2), 'utf8');
    return this.outputPath;
  }

  // ---------- 退出 ----------
  async _waitForExit() {
    return new Promise((resolve) => {
      const cleanup = async () => {
        console.log(chalk.gray('\n👋 正在关闭浏览器...'));
        try { await this.browser.close(); } catch {}
        resolve();
        process.exit(0);
      };

      // 浏览器关闭
      this.browser.on('disconnected', cleanup);

      // Ctrl+C
      process.on('SIGINT', cleanup);
      process.on('SIGTERM', cleanup);

      // Node 主线程保持活动
      setInterval(() => {}, 1 << 30);
    });
  }
}

module.exports = Recorder;
