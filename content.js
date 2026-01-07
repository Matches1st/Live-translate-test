// content.js
// Floating overlay implementation.

let overlayHost = null;
let shadowRoot = null;
let outputDiv = null;
let fullTranscript = [];

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.action === 'SHOW_OVERLAY') {
    createOverlay();
  } else if (msg.action === 'UPDATE_TRANSCRIPT') {
    if (!overlayHost) createOverlay();
    appendMessage(msg.text);
  } else if (msg.action === 'SHOW_ERROR') {
    if (!overlayHost) createOverlay();
    appendMessage(`⚠️ Error: ${msg.error}`, true);
  } else if (msg.action === 'CAPTURE_STOPPED') {
    appendMessage("--- Session Ended ---", true);
  }
});

function createOverlay() {
  if (document.getElementById('gemini-translate-overlay')) return;

  overlayHost = document.createElement('div');
  overlayHost.id = 'gemini-translate-overlay';
  overlayHost.style.cssText = `
    position: fixed;
    bottom: 30px;
    left: 50%;
    transform: translateX(-50%);
    width: 650px;
    max-width: 90vw;
    z-index: 99999999;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  `;
  
  document.body.appendChild(overlayHost);
  shadowRoot = overlayHost.attachShadow({ mode: 'open' });

  const style = document.createElement('style');
  style.textContent = `
    .container {
      background: rgba(15, 23, 42, 0.95);
      backdrop-filter: blur(12px);
      border: 1px solid #334155;
      border-radius: 12px;
      box-shadow: 0 10px 30px rgba(0,0,0,0.5);
      color: #f1f5f9;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      transition: height 0.3s;
    }
    .header {
      padding: 12px 16px;
      background: #1e293b;
      border-bottom: 1px solid #334155;
      display: flex;
      justify-content: space-between;
      align-items: center;
      cursor: grab;
    }
    .title { font-weight: 600; font-size: 14px; color: #38bdf8; display: flex; align-items: center; gap: 6px; }
    .dot { width: 8px; height: 8px; background: #22c55e; border-radius: 50%; box-shadow: 0 0 8px #22c55e; }
    .actions { display: flex; gap: 8px; }
    button {
      background: #334155;
      border: none;
      color: #cbd5e1;
      padding: 5px 10px;
      border-radius: 4px;
      font-size: 12px;
      cursor: pointer;
      transition: all 0.2s;
    }
    button:hover { background: #475569; color: white; }
    button:active { transform: translateY(1px); }
    .close-btn { font-size: 16px; padding: 0 6px; line-height: 1; background: transparent; }
    .close-btn:hover { background: #ef4444; }
    .content {
      height: 250px;
      overflow-y: auto;
      padding: 16px;
      font-size: 16px;
      line-height: 1.6;
      scroll-behavior: smooth;
    }
    .msg { margin-bottom: 12px; animation: fadeIn 0.3s ease; }
    .system { color: #fbbf24; font-size: 13px; font-style: italic; border-top: 1px solid #334155; padding-top: 8px; }
    @keyframes fadeIn { from { opacity: 0; transform: translateY(5px); } to { opacity: 1; transform: translateY(0); } }
    /* Scrollbar */
    ::-webkit-scrollbar { width: 8px; }
    ::-webkit-scrollbar-track { background: #0f172a; }
    ::-webkit-scrollbar-thumb { background: #475569; border-radius: 4px; }
  `;
  shadowRoot.appendChild(style);

  const container = document.createElement('div');
  container.className = 'container';
  container.innerHTML = `
    <div class="header">
      <div class="title"><div class="dot"></div>Gemini Live</div>
      <div class="actions">
        <button id="btn-copy">Copy All</button>
        <button id="btn-pdf">Download PDF</button>
        <button class="close-btn" id="btn-close">&times;</button>
      </div>
    </div>
    <div class="content" id="output"></div>
  `;
  shadowRoot.appendChild(container);

  outputDiv = container.querySelector('#output');

  // Handlers
  container.querySelector('#btn-close').onclick = () => {
    overlayHost.remove();
    overlayHost = null;
    chrome.runtime.sendMessage({ action: 'STOP_CAPTURE' });
  };

  container.querySelector('#btn-copy').onclick = (e) => {
    navigator.clipboard.writeText(fullTranscript.join('\n\n'));
    const btn = e.target;
    const originalText = btn.textContent;
    btn.textContent = "Copied!";
    setTimeout(() => btn.textContent = originalText, 2000);
  };

  container.querySelector('#btn-pdf').onclick = () => {
    // Request background to inject PDF generator
    chrome.runtime.sendMessage({ 
      action: 'DOWNLOAD_PDF', 
      text: fullTranscript.join('\n\n') 
    });
  };
}

function appendMessage(text, isSystem = false) {
  if (!isSystem) fullTranscript.push(text);
  
  const div = document.createElement('div');
  div.className = isSystem ? 'msg system' : 'msg';
  div.textContent = text;
  outputDiv.appendChild(div);
  outputDiv.scrollTop = outputDiv.scrollHeight;
}
