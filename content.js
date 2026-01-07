// content.js
// Injected into the page to display transcriptions

let shadowHost = null;
let shadowRoot = null;
let transcriptContainer = null;
let statusEl = null;
let fullTranscript = [];

// Load jsPDF dynamically
const script = document.createElement('script');
script.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
document.head.appendChild(script);

// Listen for messages
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'SHOW_OVERLAY') {
    createOverlay();
  } else if (message.action === 'TRANSCRIPT_RECEIVED') {
    createOverlay(); // Ensure it exists
    appendTranscript(message.text);
  } else if (message.action === 'STATUS_UPDATE') {
    if(statusEl) statusEl.textContent = message.status;
  } else if (message.action === 'ERROR') {
    if(statusEl) statusEl.textContent = `Error: ${message.error}`;
    if(statusEl) statusEl.style.color = '#ef4444';
  }
});

function createOverlay() {
  if (shadowHost) return;

  shadowHost = document.createElement('div');
  shadowHost.id = 'gemini-translator-host';
  shadowHost.style.position = 'fixed';
  shadowHost.style.bottom = '20px';
  shadowHost.style.left = '50%';
  shadowHost.style.transform = 'translateX(-50%)';
  shadowHost.style.width = '600px';
  shadowHost.style.maxWidth = '90vw';
  shadowHost.style.zIndex = '2147483647'; // Max z-index
  document.body.appendChild(shadowHost);

  shadowRoot = shadowHost.attachShadow({ mode: 'open' });

  // CSS Styles (Dark Theme)
  const style = document.createElement('style');
  style.textContent = `
    :host {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      font-size: 16px;
      line-height: 1.5;
      color: #e2e8f0;
    }
    .container {
      background-color: rgba(15, 23, 42, 0.95);
      border: 1px solid #334155;
      border-radius: 12px;
      box-shadow: 0 10px 25px rgba(0,0,0,0.5);
      display: flex;
      flex-direction: column;
      overflow: hidden;
      backdrop-filter: blur(8px);
    }
    .header {
      padding: 12px 16px;
      background-color: #1e293b;
      border-bottom: 1px solid #334155;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .title {
      font-weight: 600;
      font-size: 14px;
      color: #94a3b8;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .status {
      font-size: 12px;
      color: #10b981;
    }
    .controls {
      display: flex;
      gap: 8px;
    }
    button {
      background: #334155;
      border: none;
      color: white;
      padding: 4px 10px;
      border-radius: 4px;
      font-size: 12px;
      cursor: pointer;
      transition: background 0.2s;
    }
    button:hover {
      background: #475569;
    }
    .content {
      height: 200px;
      overflow-y: auto;
      padding: 16px;
      scroll-behavior: smooth;
    }
    .text-chunk {
      margin-bottom: 12px;
      animation: fadeIn 0.3s ease;
    }
    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(5px); }
      to { opacity: 1; transform: translateY(0); }
    }
    ::-webkit-scrollbar {
      width: 8px;
    }
    ::-webkit-scrollbar-track {
      background: #1e293b;
    }
    ::-webkit-scrollbar-thumb {
      background: #475569;
      border-radius: 4px;
    }
    .close-btn {
      background: transparent;
      color: #94a3b8;
    }
    .close-btn:hover {
      background: #334155;
      color: white;
    }
  `;

  shadowRoot.appendChild(style);

  const container = document.createElement('div');
  container.className = 'container';

  container.innerHTML = `
    <div class="header">
      <div class="title">
        <span>✨ Gemini Translator</span>
        <span class="status">Ready</span>
      </div>
      <div class="controls">
        <button id="copyBtn">Copy</button>
        <button id="pdfBtn">PDF</button>
        <button class="close-btn" id="closeBtn">✕</button>
      </div>
    </div>
    <div class="content" id="transcriptOutput"></div>
  `;

  shadowRoot.appendChild(container);

  transcriptContainer = container.querySelector('#transcriptOutput');
  statusEl = container.querySelector('.status');

  // Event Listeners
  container.querySelector('#closeBtn').addEventListener('click', () => {
    shadowHost.remove();
    shadowHost = null;
  });

  container.querySelector('#copyBtn').addEventListener('click', () => {
    const text = fullTranscript.join('\n\n');
    navigator.clipboard.writeText(text);
    const originalText = container.querySelector('#copyBtn').textContent;
    container.querySelector('#copyBtn').textContent = 'Copied!';
    setTimeout(() => container.querySelector('#copyBtn').textContent = originalText, 2000);
  });

  container.querySelector('#pdfBtn').addEventListener('click', generatePDF);
}

function appendTranscript(text) {
  if (!text) return;
  fullTranscript.push(text);

  const p = document.createElement('div');
  p.className = 'text-chunk';
  p.textContent = text;
  transcriptContainer.appendChild(p);
  
  // Auto scroll
  transcriptContainer.scrollTop = transcriptContainer.scrollHeight;
}

async function generatePDF() {
  const { jsPDF } = window.jspdf;
  if (!jsPDF) {
    alert('PDF library not loaded yet. Please wait a moment.');
    return;
  }

  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 10;
  const maxLineWidth = pageWidth - (margin * 2);
  
  let yPosition = 20;

  doc.setFontSize(16);
  doc.text("Gemini Transcription", margin, yPosition);
  yPosition += 10;
  
  doc.setFontSize(12);
  const text = fullTranscript.join('\n\n');
  
  const lines = doc.splitTextToSize(text, maxLineWidth);
  
  lines.forEach(line => {
    if (yPosition > 280) {
      doc.addPage();
      yPosition = 20;
    }
    doc.text(line, margin, yPosition);
    yPosition += 7;
  });

  doc.save("transcript.pdf");
}
