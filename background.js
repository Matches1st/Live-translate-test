// background.js
// Orchestrates the offscreen document and message passing.

let isCapturing = false;

// 1. Lifecycle Management for Offscreen Document
async function setupOffscreenDocument(path) {
  // Check if it already exists
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [path]
  });

  if (existingContexts.length > 0) {
    return;
  }

  // Create hidden document
  await chrome.offscreen.createDocument({
    url: path,
    reasons: ['AUDIO_PLAYBACK'], // Critical for keeping tab audio alive
    justification: 'Recording tab audio for transcription',
  });
}

async function closeOffscreenDocument() {
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT']
  });
  
  if (existingContexts.length > 0) {
    await chrome.offscreen.closeDocument();
  }
}

// 2. Message Listener
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'START_CAPTURE') {
    startCapture(message);
    return true; // Keep channel open
  } else if (message.action === 'STOP_CAPTURE') {
    stopCapture();
    return true;
  } else if (message.action === 'TRANSCRIPT_RECEIVED') {
    // Forward from Offscreen to Content Script (Active Tab)
    broadcastToActiveTab({ action: 'UPDATE_TRANSCRIPT', text: message.text });
  } else if (message.action === 'ERROR') {
    broadcastToActiveTab({ action: 'SHOW_ERROR', error: message.error });
  } else if (message.action === 'DOWNLOAD_PDF') {
    injectPdfGenerator(sender.tab.id, message.text);
  }
});

async function startCapture(data) {
  if (isCapturing) return;
  
  try {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!activeTab) {
      throw new Error("No active tab found.");
    }

    // A. Ensure offscreen exists
    await setupOffscreenDocument('offscreen.html');
    isCapturing = true;

    // B. Get Stream ID (Must be done in background)
    const streamId = await chrome.tabCapture.getMediaStreamId({
      targetTabId: activeTab.id
    });

    // C. Inject Content Script Overlay
    await chrome.scripting.executeScript({
      target: { tabId: activeTab.id },
      files: ['content.js']
    });
    
    // Slight delay to ensure script loads
    setTimeout(() => {
      chrome.tabs.sendMessage(activeTab.id, { action: 'SHOW_OVERLAY' }).catch(() => {});
    }, 200);

    // D. Send configuration to Offscreen to start recording
    chrome.runtime.sendMessage({
      action: 'INIT_RECORDER',
      streamId: streamId,
      apiKey: data.apiKey,
      sourceLang: data.sourceLang,
      targetLang: data.targetLang
    });

  } catch (err) {
    console.error("Start failed:", err);
    broadcastToActiveTab({ action: 'SHOW_ERROR', error: err.message });
    isCapturing = false;
    closeOffscreenDocument();
  }
}

async function stopCapture() {
  isCapturing = false;
  // Notify offscreen to stop media tracks first
  chrome.runtime.sendMessage({ action: 'STOP_RECORDER' });
  
  // Give it a moment to cleanup, then close doc
  setTimeout(async () => {
    await closeOffscreenDocument();
    broadcastToActiveTab({ action: 'CAPTURE_STOPPED' });
  }, 500);
}

async function broadcastToActiveTab(msg) {
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (activeTab) {
    chrome.tabs.sendMessage(activeTab.id, msg).catch(() => {
      // Content script might not be injected yet or tab changed
    });
  }
}

// Inject PDF generation logic into Main World (to access CDN)
function injectPdfGenerator(tabId, fullText) {
  chrome.scripting.executeScript({
    target: { tabId: tabId },
    world: 'MAIN', // Allows fetching external CDNs more easily
    func: async (text) => {
      try {
        const { jsPDF } = await import('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js');
        const doc = new jsPDF();
        
        const pageWidth = doc.internal.pageSize.getWidth();
        const margin = 15;
        const maxLineWidth = pageWidth - (margin * 2);

        doc.setFontSize(18);
        doc.text("Gemini Live Transcript", margin, 20);
        doc.setFontSize(12);

        const lines = doc.splitTextToSize(text, maxLineWidth);
        let y = 35;

        lines.forEach(line => {
          if (y > 280) {
            doc.addPage();
            y = 20;
          }
          doc.text(line, margin, y);
          y += 7;
        });

        doc.save(`transcript_${Date.now()}.pdf`);
      } catch (e) {
        alert("Error generating PDF: " + e.message);
      }
    },
    args: [fullText]
  });
}
