// content.js
// Persistent Overlay UI for Gemini Live Translator

(function() {
  // GUARD: Prevent duplicate injection
  if (window.hasGeminiTranslateOverlay) return;
  window.hasGeminiTranslateOverlay = true;

  // Constants
  const LANGUAGES = [
    "English", "Spanish", "French", "German", "Chinese (Simplified)", "Japanese", "Korean", "Russian", "Portuguese", "Italian",
    "Arabic", "Hindi", "Dutch", "Turkish", "Polish", "Swedish", "Danish", "Norwegian", "Finnish", "Greek",
    "Hebrew", "Thai", "Vietnamese", "Indonesian", "Malay", "Filipino", "Ukrainian", "Romanian", "Czech", "Hungarian",
    "Bulgarian", "Croatian", "Slovak", "Lithuanian", "Slovenian", "Latvian", "Estonian", "Serbian", "Bengali", "Persian",
    "Urdu", "Tamil", "Telugu", "Marathi", "Swahili", "Afrikaans"
  ].sort();

  // State
  let overlayHost = null;
  let ui = {};
  let fullTranscript = [];
  let isCapturing = false;
  let silenceCount = 0;

  // --- Message Listener ---
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.action === 'TOGGLE_UI') {
      toggleOverlay();
    } 
    else if (msg.action === 'TRANSCRIPT_RECEIVED') {
      appendTranscript(msg.text);
      setStatus("Capturing...", 'active');
      silenceCount = 0;
    } 
    else if (msg.action === 'CHUNK_PROCESSED') {
      if (isCapturing && ui.status && ui.status.textContent !== "Capturing...") {
        setStatus("Capturing...", 'active');
      }
    } 
    else if (msg.action === 'NO_SPEECH') {
      if (isCapturing) {
        silenceCount++;
        if (silenceCount > 1) {
          setStatus("Capturing... (No speech detected)", 'warning');
        }
      }
    } 
    else if (msg.action === 'OFFSCREEN_ERROR') {
      setStatus(msg.error, 'error');
      // If auth/stream error, force stop state in UI
      if (msg.error.includes("Key") || msg.error.includes("Stream") || msg.error.includes("403") || msg.error.includes("404")) {
        setCapturingState(false);
      }
    } 
    else if (msg.action === 'CAPTURE_STARTED') {
      setCapturingState(true);
    } 
    else if (msg.action === 'CAPTURE_STOPPED') {
      setCapturingState(false);
      setStatus("Paused / Ready");
    }
  });

  function toggleOverlay() {
    if (!overlayHost) {
      createOverlay();
    }
    const container = ui.container;
    if (container.style.display === 'none') {
      container.style.display = 'flex';
      // Do not auto-start; let user click start
      if (!isCapturing) setStatus("Ready to Start");
    } else {
      container.style.display = 'none';
      // Optional: Auto-stop on hide? 
      // Current logic: Keep running in background even if hidden, unless user clicks Stop.
    }
  }

  function createOverlay() {
    overlayHost = document.createElement('div');
    overlayHost.id = 'gemini-translator-host';
    overlayHost.style.cssText = 'all: initial; position: fixed; bottom: 20px; right: 20px; z-index: 2147483647; font-family: sans-serif;';
    document.body.appendChild(overlayHost);

    const shadowRoot = overlayHost.attachShadow({ mode: 'open' });

    const style = document.createElement('style');
    style.textContent = `
      .box {
        width: 380px; max-height: 600px; background: rgba(15, 23, 42, 0.98);
        border: 1px solid #334155; border-radius: 12px; color: #f8fafc;
        display: flex; flex-direction: column; box-shadow: 0 10px 30px rgba(0,0,0,0.5);
        font-size: 14px; backdrop-filter: blur(10px);
      }
      .header {
        padding: 12px 16px; background: #1e293b; border-bottom: 1px solid #334155;
        display: flex; justify-content: space-between; align-items: center;
        border-radius: 12px 12px 0 0; cursor: grab; user-select: none;
      }
      .header:active { cursor: grabbing; }
      .title { font-weight: 600; color: #38bdf8; display: flex; align-items: center; gap: 8px; }
      .dot { width: 8px; height: 8px; background: #64748b; border-radius: 50%; transition: background 0.3s; }
      .dot.active { background: #22c55e; box-shadow: 0 0 8px #22c55e; }
      .dot.error { background: #ef4444; }

      .settings { background: #0f172a; padding: 12px; border-bottom: 1px solid #334155; }
      .row { margin-bottom: 10px; }
      label { display: block; font-size: 11px; color: #94a3b8; margin-bottom: 4px; text-transform: uppercase; }
      input, select {
        width: 100%; box-sizing: border-box; background: #1e293b; border: 1px solid #475569;
        color: white; padding: 8px; border-radius: 6px; font-size: 13px; outline: none;
      }

      /* Control Buttons */
      .action-row { display: flex; gap: 10px; margin-top: 10px; }
      .act-btn {
        flex: 1; border: none; padding: 10px; border-radius: 6px; cursor: pointer;
        font-weight: 600; font-size: 13px; color: white; transition: opacity 0.2s;
      }
      .act-btn:hover { opacity: 0.9; }
      .btn-start { background: #22c55e; }
      .btn-stop { background: #ef4444; }
      .btn-stop:disabled { background: #94a3b8; cursor: not-allowed; }

      .status { padding: 8px 12px; font-size: 12px; color: #94a3b8; background: #1e293b; border-bottom: 1px solid #334155; text-align: center; }
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
      .sub-btn {
        flex: 1; background: #334155; border: none; color: #e2e8f0; padding: 8px; border-radius: 6px;
        cursor: pointer; font-size: 12px; font-weight: 500;
      }
      .sub-btn:hover { background: #475569; }
      
      button.icon-btn { background: none; border: none; color: #94a3b8; cursor: pointer; font-size: 16px; }
      button.icon-btn:hover { color: white; }
      
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
          <button class="icon-btn" id="btn-settings" title="Toggle Config">⚙️</button>
          <button class="icon-btn" id="btn-close" title="Close">✕</button>
        </div>
      </div>
      
      <div class="settings" id="settings-panel">
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
        <div class="action-row">
           <button class="act-btn btn-start" id="btn-start">Start Capture</button>
           <button class="act-btn btn-stop" id="btn-stop" disabled>Stop</button>
        </div>
      </div>

      <div class="status" id="status">Ready to Start</div>
      <div class="transcript" id="output"></div>

      <div class="footer">
        <button class="sub-btn" id="btn-copy">Copy All</button>
        <button class="sub-btn" id="btn-txt">Download TXT</button>
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
      startBtn: box.querySelector('#btn-start'),
      stopBtn: box.querySelector('#btn-stop'),
      status: box.querySelector('#status'),
      output: box.querySelector('#output'),
      close: box.querySelector('#btn-close'),
      settingsToggle: box.querySelector('#btn-settings'),
      copy: box.querySelector('#btn-copy'),
      txt: box.querySelector('#btn-txt')
    };

    // Populate Languages
    LANGUAGES.forEach(l => {
      ui.source.add(new Option(l, l));
      ui.target.add(new Option(l, l));
    });

    // Load Saved State
    chrome.storage.sync.get(['apiKey', 'sourceLang', 'targetLang'], (data) => {
      if (data.apiKey) ui.key.value = data.apiKey;
      if (data.sourceLang) ui.source.value = data.sourceLang;
      if (data.targetLang) ui.target.value = data.targetLang;
    });

    // Event Listeners
    const saveConfig = () => {
      const config = {
        apiKey: ui.key.value.trim(),
        sourceLang: ui.source.value,
        targetLang: ui.target.value
      };
      chrome.storage.sync.set(config);
      if (isCapturing) {
        chrome.runtime.sendMessage({ action: 'UPDATE_CONFIG', config });
      }
      return config;
    };

    ui.key.onchange = saveConfig;
    ui.source.onchange = saveConfig;
    ui.target.onchange = saveConfig;

    ui.startBtn.onclick = () => {
      const config = saveConfig();
      if (!config.apiKey) {
        setStatus("API Key Required!", 'error');
        return;
      }
      setStatus("Initializing...", 'warning');
      chrome.runtime.sendMessage({ action: 'REQUEST_START_CAPTURE', config });
    };

    ui.stopBtn.onclick = () => {
      chrome.runtime.sendMessage({ action: 'REQUEST_STOP_CAPTURE' });
      ui.stopBtn.textContent = "Stopping...";
    };

    ui.close.onclick = () => {
      ui.container.style.display = 'none';
      // We do not auto-stop on close to allow background recording
    };
    
    ui.settingsToggle.onclick = () => {
      ui.settingsPanel.style.display = ui.settingsPanel.style.display === 'none' ? 'block' : 'none';
    };

    // --- Drag Logic ---
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

    // --- Export Actions ---
    ui.copy.onclick = (e) => {
      if (fullTranscript.length === 0) return;
      navigator.clipboard.writeText(fullTranscript.join('\n\n')).then(() => {
        const old = e.target.textContent;
        e.target.textContent = 'Copied!';
        setTimeout(() => e.target.textContent = old, 1500);
      });
    };

    ui.txt.onclick = () => {
      if (fullTranscript.length === 0) return;
      const text = fullTranscript.join('\n\n');
      const blob = new Blob([text], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `transcript_${new Date().toISOString().slice(0,16)}.txt`;
      a.click();
      URL.revokeObjectURL(url);
    };
  }

  function setCapturingState(active) {
    isCapturing = active;
    if (ui.startBtn) {
      ui.startBtn.style.display = active ? 'none' : 'block';
      ui.stopBtn.style.display = active ? 'block' : 'none';
      ui.stopBtn.disabled = !active;
      ui.stopBtn.textContent = "Stop Capture";
      ui.dot.className = active ? 'dot active' : 'dot';
      
      // Lock settings while capturing
      ui.key.disabled = active;
      ui.source.disabled = active;
      ui.target.disabled = active;
    }
    if (active) setStatus("Capturing...", 'active');
  }

  function setStatus(text, type = '') {
    if (!ui.status) return;
    ui.status.textContent = text;
    ui.status.className = `status ${type}`;
    if (type === 'error') ui.dot.className = 'dot error';
  }

  function appendTranscript(text, isSystem = false) {
    if (!isSystem) fullTranscript.push(text);
    if (!ui.output) return;
    const div = document.createElement('div');
    div.className = isSystem ? 'msg sys' : 'msg';
    div.textContent = text;
    ui.output.appendChild(div);
    ui.output.scrollTop = ui.output.scrollHeight;
  }
})();