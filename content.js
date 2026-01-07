// content.js

let host = null;
let root = null;
let outputDiv = null;
let fullText = [];

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'SHOW_OVERLAY') {
    initOverlay();
  } else if (msg.action === 'APPEND_TRANSCRIPT') {
    if (!host) initOverlay();
    addText(msg.text);
  }
});

function initOverlay() {
  if (document.getElementById('gemini-overlay-host')) return;

  host = document.createElement('div');
  host.id = 'gemini-overlay-host';
  host.style.cssText = 'position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%); z-index: 2147483647; width: 600px; max-width: 90vw;';
  document.body.appendChild(host);

  root = host.attachShadow({ mode: 'open' });
  
  const style = document.createElement('style');
  style.textContent = `
    * { box-sizing: border-box; }
    .box {
      background: rgba(15, 23, 42, 0.95);
      backdrop-filter: blur(10px);
      border: 1px solid #334155;
      border-radius: 12px;
      color: #e2e8f0;
      font-family: system-ui, sans-serif;
      box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5);
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    .header {
      padding: 12px 16px;
      background: #1e293b;
      border-bottom: 1px solid #334155;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .title { font-weight: 600; font-size: 14px; color: #38bdf8; }
    .actions { display: flex; gap: 8px; }
    button {
      background: #334155;
      border: none;
      color: #cbd5e1;
      padding: 4px 8px;
      border-radius: 4px;
      font-size: 12px;
      cursor: pointer;
    }
    button:hover { background: #475569; color: white; }
    .close { color: #94a3b8; font-size: 16px; line-height: 1; padding: 4px; background: transparent; }
    .scroll-area {
      height: 200px;
      overflow-y: auto;
      padding: 16px;
      font-size: 16px;
      line-height: 1.5;
    }
    .msg { margin-bottom: 12px; animation: slideUp 0.3s ease; }
    @keyframes slideUp { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
  `;
  root.appendChild(style);

  const box = document.createElement('div');
  box.className = 'box';
  box.innerHTML = `
    <div class="header">
      <div class="title">Gemini Live</div>
      <div class="actions">
        <button id="copy">Copy</button>
        <button id="pdf">PDF</button>
        <button class="close" id="close">&times;</button>
      </div>
    </div>
    <div class="scroll-area" id="output"></div>
  `;
  root.appendChild(box);

  outputDiv = box.querySelector('#output');

  // Actions
  box.querySelector('#close').onclick = () => {
    host.remove();
    host = null;
  };

  box.querySelector('#copy').onclick = (e) => {
    navigator.clipboard.writeText(fullText.join('\n\n'));
    const btn = e.target;
    const old = btn.textContent;
    btn.textContent = 'Copied!';
    setTimeout(() => btn.textContent = old, 1500);
  };

  box.querySelector('#pdf').onclick = () => {
    // Send message to background to handle PDF via Main World injection
    chrome.runtime.sendMessage({
      action: 'DOWNLOAD_PDF',
      text: fullText.join('\n\n')
    });
  };
}

function addText(text) {
  fullText.push(text);
  const p = document.createElement('div');
  p.className = 'msg';
  p.textContent = text;
  outputDiv.appendChild(p);
  outputDiv.scrollTop = outputDiv.scrollHeight;
}