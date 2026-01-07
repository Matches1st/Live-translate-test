// content.js
// Persistent Overlay UI for Gemini Live Translator

const LANGUAGES = [
  "English", "Spanish", "French", "German", "Chinese (Simplified)", "Japanese", "Korean", "Russian", "Portuguese", "Italian",
  "Arabic", "Hindi", "Dutch", "Turkish", "Polish", "Swedish", "Danish", "Norwegian", "Finnish", "Greek",
  "Hebrew", "Thai", "Vietnamese", "Indonesian", "Malay", "Filipino", "Ukrainian", "Romanian", "Czech", "Hungarian",
  "Bulgarian", "Croatian", "Slovak", "Lithuanian", "Slovenian", "Latvian", "Estonian", "Serbian", "Bengali", "Persian",
  "Urdu", "Tamil", "Telugu", "Marathi", "Swahili", "Afrikaans"
].sort();

let overlayHost = null;
let shadowRoot = null;
let ui = {};
let fullTranscript = [];
let isCapturing = false;
let silenceCount = 0;

// --- Message Listener ---
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.action === 'TOGGLE_UI') {
    toggleOverlay();
  } else if (msg.action === 'TRANSCRIPT_RECEIVED') {
    appendTranscript(msg.text);
    setStatus("Listening...", 'active');
    silenceCount = 0;
  } else if (msg.action === 'CHUNK_PROCESSED') {
    // Only show "Processing" briefly if we haven't just received text
    if (ui.status.textContent !== "Listening...") {
      setStatus("Listening...", 'active');
    }
  } else if (msg.action === 'NO_SPEECH') {
    silenceCount++;
    if (silenceCount > 1) {
      setStatus("Listening... (no speech detected yet)", 'warning');
    } else {
      setStatus("Listening...", 'active');
    }
  } else if (msg.action === 'OFFSCREEN_ERROR') {
    setStatus(msg.error, 'error');
    if (msg.error.includes("Key") || msg.error.includes("Stream")) {
      setCapturingState(false);
    }
  } else if (msg.action === 'ERROR') {
    setStatus(msg.error, 'error');
    setCapturingState(false);
  } else if (msg.action === 'CAPTURE_STARTED') {
    setCapturingState(true);
  } else if (msg.action === 'CAPTURE_STOPPED') {
    setCapturingState(false);
    appendTranscript("--- Session Ended ---", true);
  }
});

function toggleOverlay() {
  if (!overlayHost) {
    createOverlay();
    chrome.storage.sync.get(['apiKey'], (res) => {
      if (res.apiKey) startCapture();
      else {
        ui.settingsPanel.open = true;
        setStatus("Enter API Key to start", 'warning');
      }
    });
    return;
  }
  
  const container = ui.container;
  if (container.style.display === 'none') {
    container.style.display = 'flex';
    chrome.storage.sync.get(['apiKey'], (res) => {
      if (res.apiKey) startCapture();
    });
  } else {
    container.style.display = 'none';
    if (isCapturing) {
      chrome.runtime.sendMessage({ action: 'REQUEST_STOP_CAPTURE' });
    }
  }
}

function createOverlay() {
  overlayHost = document.createElement('div');
  overlayHost.id = 'gemini-translator-host';
  overlayHost.style.cssText = 'all: initial; position: fixed; bottom: 20px; right: 20px; z-index: 2147483647; font-family: sans-serif;';
  document.body.appendChild(overlayHost);

  shadowRoot = overlayHost.attachShadow({ mode: 'open' });

  const style = document.createElement('style');
  style.textContent = `
    .box {
      width: 380px;
      max-height: 600px;
      background: rgba(15, 23, 42, 0.98);
      border: 1px solid #334155;
      border-radius: 12px;
      color: #f8fafc;
      display: flex;
      flex-direction: column;
      box-shadow: 0 10px 30px rgba(0,0,0,0.5);
      font-size: 14px;
      backdrop-filter: blur(10px);
    }
    .header {
      padding: 12px 16px;
      background: #1e293b;
      border-bottom: 1px solid #334155;
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-radius: 12px 12px 0 0;
      cursor: grab;
      user-select: none;
    }
    .header:active { cursor: grabbing; }
    .title { font-weight: 600; color: #38bdf8; display: flex; align-items: center; gap: 8px; }
    .dot { width: 8px; height: 8px; background: #64748b; border-radius: 50%; transition: background 0.3s; }
    .dot.active { background: #22c55e; box-shadow: 0 0 8px #22c55e; }
    .dot.error { background: #ef4444; }

    .controls button {
      background: none; border: none; color: #94a3b8; cursor: pointer; font-size: 16px; padding: 4px 8px; border-radius: 4px;
    }
    .controls button:hover { background: #334155; color: white; }

    .settings { background: #0f172a; border-bottom: 1px solid #334155; padding: 12px; }
    .row { margin-bottom: 10px; }
    label { display: block; font-size: 11px; color: #94a3b8; margin-bottom: 4px; text-transform: uppercase; }
    input, select {
      width: 100%; box-sizing: border-box; background: #1e293b; border: 1px solid #475569;
      color: white; padding: 8px; border-radius: 6px; font-size: 13px; outline: none;
    }
    input:focus, select:focus { border-color: #38bdf8; }

    .status { padding: 8px 12px; font-size: 12px; color: #94a3b8; background: #1e293b; border-bottom: 1px solid #334155; text-align: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .status.active { color: #22c55e; }
    .status.warning { color: #fbbf24; }
    .status.error { color: #ef4444; }

    .transcript {
      flex: 1; min-height: 150px; max-height: 300px; overflow-y: auto; padding: 12px;
      font-family: system-ui, -apple-system, sans-serif; line-height: 1.5;
    }
    .msg { margin-bottom: 10px; animation: slideIn 0.2s; }
    .sys { font-style: italic; color: #64748b; font-size: 12px; text-align: center; margin: 15px 0; border-top: 1px solid #334155; padding-top: 5px; }
    @keyframes slideIn { from { opacity: 0; transform: translateY(5px); } to { opacity: 1; } }

    .footer { padding: 10px; border-top: 1px solid #334155; display: flex; gap: 8px; }
    .btn {
      flex: 1; background: #334155; border: none; color: #e2e8f0; padding: 8px; border-radius: 6px;
      cursor: pointer; font-size: 12px; font-weight: 500; transition: background 0.2s;
    }
    .btn:hover { background: #475569; color: white; }

    details > summary { cursor: pointer; outline: none; color: #94a3b8; font-size: 12px; list-style: none; }
    details > summary:hover { color: #38bdf8; }
    details[open] > summary { margin-bottom: 8px; color: #38bdf8; }
    
    ::-webkit-scrollbar { width: 6px; }
    ::-webkit-scrollbar-track { background: transparent; }
    ::-webkit-scrollbar-thumb { background: #475569; border-radius: 3px; }
  `;
  shadowRoot.appendChild(style);

  const box = document.createElement('div');
  box.className = 'box';
  box.innerHTML = `
    <div class="header" id="header">
      <div class="title"><div class="dot" id="dot"></div> Gemini Live</div>
      <div class="controls">
        <button id="btn-settings" title="Settings">⚙️</button>
        <button id="btn-close" title="Close">✕</button>
      </div>
    </div>
    
    <details class="settings" id="settings-panel">
      <summary>Configuration</summary>
      <div class="row">
        <label>Gemini API Key</label>
        <input type="password" id="inp-key" placeholder="Paste API Key here...">
      </div>
      <div class="row">
        <label>Source Language</label>
        <select id="sel-source">
          <option value="Auto-detect">✨ Auto-detect</option>
        </select>
      </div>
      <div class="row">
        <label>Target Language</label>
        <select id="sel-target">
          <option value="None">None (Captions Only)</option>
        </select>
      </div>
    </details>

    <div class="status" id="status">Ready</div>
    <div class="transcript" id="output"></div>

    <div class="footer">
      <button class="btn" id="btn-copy">Copy All</button>
      <button class="btn" id="btn-pdf">Download PDF</button>
    </div>
  `;
  shadowRoot.appendChild(box);

  ui = {
    container: box,
    header: box.querySelector('#header'),
    dot: box.querySelector('#dot'),
    settingsPanel: box.querySelector('#settings-panel'),
    key: box.querySelector('#inp-key'),
    source: box.querySelector('#sel-source'),
    target: box.querySelector('#sel-target'),
    status: box.querySelector('#status'),
    output: box.querySelector('#output'),
    close: box.querySelector('#btn-close'),
    settingsToggle: box.querySelector('#btn-settings'),
    copy: box.querySelector('#btn-copy'),
    pdf: box.querySelector('#btn-pdf')
  };

  LANGUAGES.forEach(l => {
    ui.source.add(new Option(l, l));
    ui.target.add(new Option(l, l));
  });

  chrome.storage.sync.get(['apiKey', 'sourceLang', 'targetLang'], (data) => {
    if (data.apiKey) ui.key.value = data.apiKey;
    if (data.sourceLang) ui.source.value = data.sourceLang;
    if (data.targetLang) ui.target.value = data.targetLang;
  });

  const updateConfig = () => {
    const config = {
      apiKey: ui.key.value.trim(),
      sourceLang: ui.source.value,
      targetLang: ui.target.value
    };
    chrome.storage.sync.set(config);
    if (isCapturing) {
      chrome.runtime.sendMessage({ action: 'UPDATE_CONFIG', config });
    } else if (config.apiKey && ui.container.style.display !== 'none') {
      startCapture();
    }
  };
  ui.key.onchange = updateConfig;
  ui.source.onchange = updateConfig;
  ui.target.onchange = updateConfig;

  ui.close.onclick = () => {
    ui.container.style.display = 'none';
    if (isCapturing) chrome.runtime.sendMessage({ action: 'REQUEST_STOP_CAPTURE' });
  };
  ui.settingsToggle.onclick = () => {
    ui.settingsPanel.open = !ui.settingsPanel.open;
  };

  let isDragging = false, startX, startY, initLeft, initBottom;
  ui.header.onmousedown = (e) => {
    isDragging = true;
    startX = e.clientX;
    startY = e.clientY;
    const rect = overlayHost.getBoundingClientRect();
    initLeft = rect.left;
    initBottom = window.innerHeight - rect.bottom;
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  };
  const onMouseMove = (e) => {
    if (!isDragging) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    overlayHost.style.right = 'auto';
    overlayHost.style.bottom = 'auto';
    overlayHost.style.left = (initLeft + dx) + 'px';
    overlayHost.style.top = (window.innerHeight - initBottom - overlayHost.offsetHeight + dy) + 'px';
  };
  const onMouseUp = () => {
    isDragging = false;
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
  };

  ui.copy.onclick = (e) => {
    if (fullTranscript.length === 0) return;
    navigator.clipboard.writeText(fullTranscript.join('\n\n')).then(() => {
      const old = e.target.textContent;
      e.target.textContent = 'Copied!';
      setTimeout(() => e.target.textContent = old, 1500);
    });
  };

  ui.pdf.onclick = () => {
    if (fullTranscript.length === 0) return;
    chrome.runtime.sendMessage({ action: 'DOWNLOAD_PDF', text: fullTranscript.join('\n\n') });
  };
}

function startCapture() {
  const apiKey = ui.key.value.trim();
  if (!apiKey) return;
  
  setStatus("Initializing... (play audio in tab)", 'warning');
  silenceCount = 0;
  chrome.runtime.sendMessage({
    action: 'REQUEST_START_CAPTURE',
    config: { apiKey, sourceLang: ui.source.value, targetLang: ui.target.value }
  });
}

function setCapturingState(active) {
  isCapturing = active;
  if (active) {
    ui.dot.className = 'dot active';
    setStatus("Listening... (play clear speech)", 'active');
  } else {
    ui.dot.className = 'dot';
    if (!ui.status.classList.contains('error')) setStatus("Stopped");
  }
}

function setStatus(text, type = '') {
  ui.status.textContent = text;
  ui.status.className = `status ${type}`;
  if (type === 'error') ui.dot.className = 'dot error';
}

function appendTranscript(text, isSystem = false) {
  if (!isSystem) fullTranscript.push(text);
  const div = document.createElement('div');
  div.className = isSystem ? 'msg sys' : 'msg';
  div.textContent = text;
  ui.output.appendChild(div);
  ui.output.scrollTop = ui.output.scrollHeight;
}