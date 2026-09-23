/**
 * 浏览器内悬浮控制面板（开始 / 暂停录制）
 * 通过 initFloatingPanel(window) 注入到任意页面
 */
(function initFloatingPanel(window) {
  if (window.__apiRecorderInjected) return;
  window.__apiRecorderInjected = true;

  const PANEL_ID = '__api_recorder_panel__';
  if (document.getElementById(PANEL_ID)) return;

  // ---------- 样式 ----------
  const style = document.createElement('style');
  style.textContent = `
    #${PANEL_ID} {
      position: fixed;
      top: 16px;
      right: 16px;
      z-index: 2147483647;
      background: rgba(20, 22, 30, 0.92);
      backdrop-filter: blur(10px);
      border: 1px solid rgba(255,255,255,0.12);
      border-radius: 12px;
      padding: 12px 14px;
      color: #fff;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
      font-size: 13px;
      box-shadow: 0 10px 30px rgba(0,0,0,0.35);
      min-width: 220px;
      user-select: none;
      cursor: move;
    }
    #${PANEL_ID} .ar-title {
      font-weight: 600;
      font-size: 12px;
      letter-spacing: 0.5px;
      color: #9aa3b2;
      margin-bottom: 8px;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    #${PANEL_ID} .ar-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #6b7280;
      transition: background 0.2s;
    }
    #${PANEL_ID} .ar-dot.recording { background: #ef4444; box-shadow: 0 0 0 0 rgba(239,68,68,0.7); animation: ar-pulse 1.5s infinite; }
    @keyframes ar-pulse {
      0%   { box-shadow: 0 0 0 0 rgba(239,68,68,0.7); }
      70%  { box-shadow: 0 0 0 8px rgba(239,68,68,0); }
      100% { box-shadow: 0 0 0 0 rgba(239,68,68,0); }
    }
    #${PANEL_ID} .ar-count {
      font-size: 22px;
      font-weight: 700;
      margin: 4px 0 10px;
      line-height: 1;
    }
    #${PANEL_ID} .ar-btns { display: flex; gap: 8px; }
    #${PANEL_ID} .ar-btn {
      flex: 1;
      border: none;
      border-radius: 8px;
      padding: 8px 10px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      transition: transform 0.05s, opacity 0.2s, background 0.2s;
      font-family: inherit;
    }
    #${PANEL_ID} .ar-btn:active { transform: scale(0.97); }
    #${PANEL_ID} .ar-btn:disabled { opacity: 0.4; cursor: not-allowed; }
    #${PANEL_ID} .ar-btn.primary { background: #ef4444; color: #fff; }
    #${PANEL_ID} .ar-btn.primary:hover:not(:disabled) { background: #dc2626; }
    #${PANEL_ID} .ar-btn.secondary { background: #374151; color: #fff; }
    #${PANEL_ID} .ar-btn.secondary:hover:not(:disabled) { background: #4b5563; }
    #${PANEL_ID} .ar-status {
      margin-top: 8px;
      font-size: 11px;
      color: #9aa3b2;
      text-align: center;
    }
    #${PANEL_ID} .ar-list-btn {
      margin-top: 8px;
      width: 100%;
      background: transparent;
      color: #60a5fa;
      border: 1px solid rgba(96,165,250,0.3);
      border-radius: 6px;
      padding: 6px;
      font-size: 12px;
      cursor: pointer;
      font-family: inherit;
    }
    #${PANEL_ID} .ar-list-btn:hover { background: rgba(96,165,250,0.1); }

    #${PANEL_ID} .ar-modal-mask {
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.6);
      z-index: 2147483647;
      display: none;
      align-items: center;
      justify-content: center;
    }
    #${PANEL_ID} .ar-modal-mask.show { display: flex; }
    #${PANEL_ID} .ar-modal {
      background: #1f2937;
      border-radius: 12px;
      width: min(900px, 92vw);
      max-height: 80vh;
      display: flex;
      flex-direction: column;
      color: #e5e7eb;
      font-size: 13px;
    }
    #${PANEL_ID} .ar-modal-head {
      padding: 12px 16px;
      border-bottom: 1px solid rgba(255,255,255,0.08);
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-weight: 600;
    }
    #${PANEL_ID} .ar-modal-close { background: none; border: none; color: #9aa3b2; font-size: 18px; cursor: pointer; }
    #${PANEL_ID} .ar-modal-body { overflow: auto; padding: 8px 0; }
    #${PANEL_ID} .ar-row {
      padding: 8px 16px;
      border-bottom: 1px solid rgba(255,255,255,0.05);
      display: flex;
      gap: 10px;
      align-items: center;
      font-family: ui-monospace, "SF Mono", Menlo, monospace;
      font-size: 12px;
    }
    #${PANEL_ID} .ar-row:hover { background: rgba(255,255,255,0.03); }
    #${PANEL_ID} .ar-method { font-weight: 700; min-width: 50px; }
    #${PANEL_ID} .ar-method.GET    { color: #60a5fa; }
    #${PANEL_ID} .ar-method.POST   { color: #34d399; }
    #${PANEL_ID} .ar-method.PUT    { color: #fbbf24; }
    #${PANEL_ID} .ar-method.DELETE { color: #f87171; }
    #${PANEL_ID} .ar-method.PATCH  { color: #c084fc; }
    #${PANEL_ID} .ar-status-code {
      min-width: 36px;
      text-align: center;
      padding: 2px 6px;
      border-radius: 4px;
      font-weight: 600;
    }
    #${PANEL_ID} .ar-status-code.s2 { background: #064e3b; color: #6ee7b7; }
    #${PANEL_ID} .ar-status-code.s3 { background: #1e3a8a; color: #93c5fd; }
    #${PANEL_ID} .ar-status-code.s4 { background: #7c2d12; color: #fdba74; }
    #${PANEL_ID} .ar-status-code.s5 { background: #7f1d1d; color: #fca5a5; }
    #${PANEL_ID} .ar-url { flex: 1; word-break: break-all; color: #d1d5db; }
  `;
  document.documentElement.appendChild(style);

  // ---------- DOM ----------
  const root = document.createElement('div');
  root.id = PANEL_ID;
  root.innerHTML = `
    <div class="ar-title"><span class="ar-dot"></span><span class="ar-title-text">API Recorder · 就绪</span></div>
    <div class="ar-count">0</div>
    <div class="ar-btns">
      <button class="ar-btn primary" data-action="start">▶ 开始录制</button>
      <button class="ar-btn secondary" data-action="pause" disabled>⏸ 暂停录制</button>
    </div>
    <button class="ar-list-btn" data-action="toggle-list">查看已捕获接口</button>
    <div class="ar-status">提示：先点击「开始录制」，操作完页面后再点「暂停录制」即可导出 JSON</div>

    <div class="ar-modal-mask" data-modal="list">
      <div class="ar-modal" onclick="event.stopPropagation()">
        <div class="ar-modal-head">
          <span>已捕获接口 (<span data-modal-count>0</span>)</span>
          <button class="ar-modal-close" data-action="close-list">✕</button>
        </div>
        <div class="ar-modal-body" data-modal-body></div>
      </div>
    </div>
  `;
  document.documentElement.appendChild(root);

  // ---------- 拖拽 ----------
  (function makeDraggable() {
    const handle = root;
    let dragging = false, sx = 0, sy = 0, ox = 0, oy = 0;
    handle.addEventListener('mousedown', (e) => {
      if (e.target.closest('button')) return;
      dragging = true;
      const rect = handle.getBoundingClientRect();
      sx = e.clientX; sy = e.clientY;
      ox = rect.left; oy = rect.top;
      handle.style.right = 'auto';
      handle.style.bottom = 'auto';
      handle.style.left = ox + 'px';
      handle.style.top = oy + 'px';
      e.preventDefault();
    });
    document.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      handle.style.left = (ox + e.clientX - sx) + 'px';
      handle.style.top = (oy + e.clientY - sy) + 'px';
    });
    document.addEventListener('mouseup', () => { dragging = false; });
  })();

  // ---------- 状态 ----------
  const state = {
    recording: false,
    count: 0,
    records: [],
  };

  const dot    = root.querySelector('.ar-dot');
  const title  = root.querySelector('.ar-title-text');
  const countEl= root.querySelector('.ar-count');
  const btnStart  = root.querySelector('[data-action="start"]');
  const btnPause  = root.querySelector('[data-action="pause"]');
  const btnList   = root.querySelector('[data-action="toggle-list"]');
  const status    = root.querySelector('.ar-status');
  const modal     = root.querySelector('[data-modal="list"]');
  const modalBody = root.querySelector('[data-modal-body]');
  const modalCount= root.querySelector('[data-modal-count]');

  function setRecording(flag) {
    state.recording = flag;
    btnStart.disabled = flag;
    btnPause.disabled = !flag;
    dot.classList.toggle('recording', flag);
    title.textContent = flag ? 'API Recorder · 录制中' : 'API Recorder · 已暂停';
    status.textContent = flag
      ? '正在捕获网络请求… 操作完目标页面后点击「暂停录制」'
      : `已暂停，共捕获 ${state.count} 个接口。可继续录制或关闭窗口结束`;
  }

  function updateCount() {
    countEl.textContent = state.count;
    modalCount.textContent = state.count;
    btnList.textContent = state.count > 0
      ? `查看已捕获接口（${state.count}）`
      : '查看已捕获接口';
  }

  function renderList() {
    modalBody.innerHTML = '';
    if (state.records.length === 0) {
      modalBody.innerHTML = '<div style="padding:24px;text-align:center;color:#9aa3b2;">暂无数据</div>';
      return;
    }
    state.records.forEach((r, i) => {
      const row = document.createElement('div');
      row.className = 'ar-row';
      const method = (r.method || 'GET').toUpperCase();
      const statusClass = r.status >= 200 && r.status < 300 ? 's2'
                        : r.status >= 300 && r.status < 400 ? 's3'
                        : r.status >= 400 && r.status < 500 ? 's4' : 's5';
      row.innerHTML = `
        <span class="ar-method ${method}">${method}</span>
        <span class="ar-status-code ${statusClass}">${r.status || '-'}</span>
        <span class="ar-url" title="${r.url}">${r.url}</span>
      `;
      modalBody.appendChild(row);
    });
  }

  // ---------- 暴露接口给 Node 端 ----------
  window.__apiRecorder = {
    start() {
      state.records = [];
      state.count = 0;
      updateCount();
      setRecording(true);
    },
    pause() {
      setRecording(false);
    },
    addRecord(record) {
      if (!state.recording) return;
      state.records.push(record);
      state.count = state.records.length;
      updateCount();
    },
    getRecords() {
      return state.records.slice();
    },
    isRecording() {
      return state.recording;
    },
    showList() {
      renderList();
      modal.classList.add('show');
    },
    hideList() {
      modal.classList.remove('show');
    },
  };

  // ---------- 事件绑定 ----------
  btnStart.addEventListener('click', () => {
    if (!state.recording) window.__apiRecorder.start();
  });
  btnPause.addEventListener('click', () => {
    if (state.recording) {
      if (typeof window.__arOnPause === 'function') {
        window.__arOnPause();
      } else {
        window.__apiRecorder.pause();
      }
    }
  });
  btnList.addEventListener('click', () => window.__apiRecorder.showList());
  root.querySelector('[data-action="close-list"]').addEventListener('click', () => {
    window.__apiRecorder.hideList();
  });
  modal.addEventListener('click', () => window.__apiRecorder.hideList());

  // 拦截 __ar_pause 信号
  window.addEventListener('message', (e) => {
    if (e.data && e.data.__ar_pause__) window.__apiRecorder.pause();
  });

  updateCount();
})(window);
