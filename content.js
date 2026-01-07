// content.js
// The main UI for the extension.

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

// Listen for messages from Background
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.action === 'TOGGLE_UI') {
    toggleOverlay();
  } else if (msg.action === 'TRANSCRIPT_UPDATE') {
    appendTranscript(msg.text);
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
  }
  
  const container = ui.container;
  if (container.style.display === 'none') {
    container.style.display = 'flex';
    attemptAutoStart();
  } else {
    // If visible, hide and stop
    container.style.display = 'none';
    if (isCapturing) {
      chrome.runtime.sendMessage({ action: 'REQUEST_STOP_CAPTURE' });
    }
  }
}

function attemptAutoStart() {
  chrome.storage.sync.get(['apiKey'], (res) => {
    if (res.apiKey) {
      startCapture();
    } else {
      setStatus("Please enter API Key to start", 'warning');
      ui.settingsPanel.open = true; // Open settings if key missing
    }
  });
}

function createOverlay() {
  overlayHost = document.createElement('div');
  overlayHost.id = 'gemini-translator-host';
  // Reset CSS to prevent page style leak
  overlayHost.style.cssText = 'all: initial; position: fixed; bottom: 20px; right: 20px; z-index: 2147483647;';
  document.body.appendChild(overlayHost);

  shadowRoot = overlayHost.attachShadow({ mode: 'open' });

  // Styles
  const style = document.createElement('style');
  style.textContent = `
    :host { font-family: -apple-system, system-ui, sans-serif; }
    .box {
      width: 360px;
      max-height: 500px;
      background: rgba(15, 23, 42, 0.98);
      border: 1px solid #334155;
      border-radius: 12px;
      color: #f8fafc;
      display: flex;
      flex-direction: column;
      box-shadow: 0 10px 25px rgba(0,0,0,0.5);
      font-size: 14px;
      transition: opacity 0.2s;
    }
    .header {
      padding: 12px;
      background: #1e293b;
      border-bottom: 1px solid #334155;
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-radius: 12px 12px 0 0;
      cursor: default;
    }
    .title { font-weight: 600; color: #38bdf8; display: flex; align-items: center; gap: 8px; }
    .status-dot { width: 8px; height: 8px; background: #64748b; border-radius: 50%; transition: background 0.3s; }
    .status-dot.active { background: #22c55e; box-shadow: 0 0 8px #22c55e; }
    .status-dot.error { background: #ef4444; }
    
    .controls { display: flex; gap: 8px; }
    .btn-icon { background: none; border: none; color: #94a3b8; cursor: pointer; font-size: 16px; padding: 4px; border-radius: 4px; }
    .btn-icon:hover { background: #334155; color: white; }

    .settings {
      background: #0f172a;
      border-bottom: 1px solid #334155;
      padding: 12px;
    }
    .input-group { margin-bottom: 10px; }
    .input-group label { display: block; font-size: 11px; color: #94a3b8; margin-bottom: 4px; }
    input, select {
      width: 100%; box-sizing: border-box; background: #1e293b; border: 1px solid #475569;
      color: white; padding: 8px; border-radius: 6px; font-size: 13px; outline: none;
    }
    input:focus, select:focus { border-color: #38bdf8; }

    .status-bar {
      padding: 8px 12px;
      font-size: 12px;
      color: #94a3b8;
      border-bottom: 1px solid #334155;
      background: #1e293b;
      text-align: center;
    }
    .status-bar.error { color: #ef4444; }
    .status-bar.warning { color: #fbbf24; }

    .transcript {
      flex: 1;
      height: 250px;
      overflow-y: auto;
      padding: 12px;
      line-height: 1.5;
    }
    .msg { margin-bottom: 10px; animation: fade 0.3s; }
    .msg.sys { font-style: italic; color: #64748b; font-size: 12px; text-align: center; border-top: 1px solid #334155; padding-top: 5px; }
    @keyframes fade { from { opacity: 0; transform: translateY(5px); } to { opacity: 1; } }

    .footer {
      padding: 10px;
      border-top: 1px solid #334155;
      display: flex;
      gap: 8px;
    }
    .action-btn {
      flex: 1;
      background: #334155;
      border: none;
      color: #e2e8f0;
      padding: 8px;
      border-radius: 6px;
      cursor: pointer;
      font-size: 12px;
      font-weight: 500;
    }
    .action-btn:hover { background: #475569; color: white; }
    
    ::-webkit-scrollbar { width: 6px; }
    ::-webkit-scrollbar-track { background: transparent; }
    ::-webkit-scrollbar-thumb { background: #475569; border-radius: 3px; }
    
    details > summary { list-style: none; cursor: pointer; outline: none; color: #94a3b8; font-size: 12px; padding: 4px 0; }
    details > summary:hover { color: #38bdf8; }
    details[open] > summary { color: #38bdf8; margin-bottom: 8px; }
  `;
  shadowRoot.appendChild(style);

  // HTML Structure
  const box = document.createElement('div');
  box.className = 'box';
  box.innerHTML = `
    <div class="header">
      <div class="title">
        <div class="status-dot" id="dot"></div> Gemini Live
      </div>
      <div class="controls">
        <button class="btn-icon" id="toggle-settings">⚙️</button>
        <button class="btn-icon" id="close-btn">✕</button>
      </div>
    </div>
    
    <details class="settings" id="settings-panel">
      <summary>Configuration</summary>
      <div class="input-group">
        <label>Gemini API Key</label>
        <input type="password" id="api-key" placeholder="Paste API Key here...">
      </div>
      <div class="input-group">
        <label>Source Language</label>
        <select id="source-lang">
          <option value="Auto-detect">✨ Auto-detect</option>
        </select>
      </div>
      <div class="input-group">
        <label>Target Language</label>
        <select id="target-lang">
          <option value="None">None (Same-language captions)</option>
        </select>
      </div>
    </details>

    <div class="status-bar" id="status-text">Ready</div>

    <div class="transcript" id="output"></div>

    <div class="footer">
      <button class="action-btn" id="copy-btn">Copy</button>
      <button class="action-btn" id="pdf-btn">PDF</button>
    </div>
  `;
  shadowRoot.appendChild(box);

  // Cache UI references
  ui = {
    container: box,
    dot: box.querySelector('#dot'),
    settingsPanel: box.querySelector('#settings-panel'),
    apiKey: box.querySelector('#api-key'),
    source: box.querySelector('#source-lang'),
    target: box.querySelector('#target-lang'),
    status: box.querySelector('#status-text'),
    output: box.querySelector('#output'),
    close: box.querySelector('#close-btn'),
    settingsToggle: box.querySelector('#toggle-settings'),
    copy: box.querySelector('#copy-btn'),
    pdf: box.querySelector('#pdf-btn')
  };

  // Populate Languages
  LANGUAGES.forEach(lang => {
    ui.source.add(new Option(lang, lang));
    ui.target.add(new Option(lang, lang));
  });

  // Load Settings
  chrome.storage.sync.get(['apiKey', 'sourceLang', 'targetLang'], (data) => {
    if (data.apiKey) ui.apiKey.value = data.apiKey;
    if (data.sourceLang) ui.source.value = data.sourceLang;
    if (data.targetLang) ui.target.value = data.targetLang;
  });

  // Event Listeners
  ui.close.onclick = () => {
    ui.container.style.display = 'none';
    if (isCapturing) chrome.runtime.sendMessage({ action: 'REQUEST_STOP_CAPTURE' });
  };

  ui.settingsToggle.onclick = () => {
    ui.settingsPanel.open = !ui.settingsPanel.open;
  };

  // Config Changes (Live Update)
  const updateConfig = () => {
    const config = {
      apiKey: ui.apiKey.value.trim(),
      sourceLang: ui.source.value,
      targetLang: ui.target.value
    };
    
    // Save
    chrome.storage.sync.set(config);
    
    // Update live session if active
    if (isCapturing) {
      chrome.runtime.sendMessage({ action: 'UPDATE_CONFIG', config });
    } else if (config.apiKey && !isCapturing && ui.container.style.display !== 'none') {
      // If user enters key while "waiting", start
      startCapture();
    }
  };

  ui.apiKey.addEventListener('change', updateConfig);
  ui.source.addEventListener('change', updateConfig);
  ui.target.addEventListener('change', updateConfig);

  ui.copy.onclick = (e) => {
    navigator.clipboard.writeText(fullTranscript.join('\n\n'));
    const old = e.target.textContent;
    e.target.textContent = 'Copied!';
    setTimeout(() => e.target.textContent = old, 1500);
  };

  ui.pdf.onclick = () => {
    chrome.runtime.sendMessage({ action: 'DOWNLOAD_PDF', text: fullTranscript.join('\n\n') });
  };
}

function startCapture() {
  const apiKey = ui.apiKey.value.trim();
  if (!apiKey) return;

  setStatus("Initializing capture...", 'warning');
  chrome.runtime.sendMessage({
    action: 'REQUEST_START_CAPTURE',
    config: {
      apiKey,
      sourceLang: ui.source.value,
      targetLang: ui.target.value
    }
  });
}

function setCapturingState(active) {
  isCapturing = active;
  if (active) {
    ui.dot.className = 'status-dot active';
    setStatus("Listening...");
  } else {
    ui.dot.className = 'status-dot';
    // Only reset status text if it's not an error
    if (!ui.status.classList.contains('error')) {
      setStatus("Stopped");
    }
  }
}

function setStatus(text, type = '') {
  ui.status.textContent = text;
  ui.status.className = `status-bar ${type}`;
  if (type === 'error') ui.dot.className = 'status-dot error';
}

function appendTranscript(text, isSystem = false) {
  if (!isSystem) fullTranscript.push(text);
  
  const div = document.createElement('div');
  div.className = isSystem ? 'msg sys' : 'msg';
  div.textContent = text;
  ui.output.appendChild(div);
  ui.output.scrollTop = ui.output.scrollHeight;
}