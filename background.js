// background.js

const OFFSCREEN_PATH = 'offscreen.html';
let capturingTabId = null;

// 1. Handle Extension Icon Click
chrome.action.onClicked.addListener(async (tab) => {
  if (capturingTabId && capturingTabId !== tab.id) {
    await stopCapture();
  }

  // Inject UI if needed
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['content.js']
    });
  } catch (e) {
    // Script likely already injected
  }

  // Send Toggle Command
  chrome.tabs.sendMessage(tab.id, { action: 'TOGGLE_UI' }).catch((err) => {
    console.error("Could not send message to tab:", err);
  });
});

// 2. Offscreen Document Management
async function ensureOffscreen() {
  const offscreenUrl = chrome.runtime.getURL(OFFSCREEN_PATH);
  
  // Check existence using full URL to avoid duplicates
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [offscreenUrl]
  });

  if (existingContexts.length > 0) return;

  // Create if missing
  await chrome.offscreen.createDocument({
    url: OFFSCREEN_PATH,
    reasons: ['AUDIO_PLAYBACK'],
    justification: 'Real-time tab audio transcription',
  });
}

async function closeOffscreen() {
  await chrome.offscreen.closeDocument().catch(() => {});
}

// 3. Message Routing
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // Commands from Content Script
  if (msg.action === 'REQUEST_START_CAPTURE') {
    handleStartCapture(sender.tab.id, msg.config);
  } else if (msg.action === 'REQUEST_STOP_CAPTURE') {
    stopCapture();
  } else if (msg.action === 'UPDATE_CONFIG') {
    chrome.runtime.sendMessage({ action: 'UPDATE_CONFIG', config: msg.config }).catch(() => {});
  } else if (msg.action === 'DOWNLOAD_PDF') {
    if (sender.tab) injectPdfGenerator(sender.tab.id, msg.text);
  }
  
  // Messages from Offscreen -> Content Script
  else if (capturingTabId) {
    // Forward these specific messages to the UI for status updates
    const forwardActions = ['TRANSCRIPT_RECEIVED', 'OFFSCREEN_ERROR', 'NO_SPEECH', 'CHUNK_PROCESSED'];
    if (forwardActions.includes(msg.action)) {
      chrome.tabs.sendMessage(capturingTabId, msg).catch(() => {});
    }
  }
});

// 4. Capture Logic
async function handleStartCapture(tabId, config) {
  try {
    capturingTabId = tabId;
    await ensureOffscreen();
    
    // Get Stream ID (must be done in background)
    const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId });

    // Initialize Recorder in Offscreen
    chrome.runtime.sendMessage({
      action: 'INIT_RECORDER',
      streamId: streamId,
      config: config
    });

    // Notify Content Script
    chrome.tabs.sendMessage(tabId, { action: 'CAPTURE_STARTED' });

  } catch (err) {
    console.error("Capture failed:", err);
    chrome.tabs.sendMessage(tabId, { action: 'ERROR', error: "Capture failed: " + err.message });
    closeOffscreen();
    capturingTabId = null;
  }
}

async function stopCapture() {
  if (!capturingTabId) return;
  
  // Notify offscreen to stop
  chrome.runtime.sendMessage({ action: 'STOP_RECORDER' }).catch(() => {});
  
  // Notify content script UI
  chrome.tabs.sendMessage(capturingTabId, { action: 'CAPTURE_STOPPED' }).catch(() => {});
  
  // Cleanup
  capturingTabId = null;
  
  // Wait a bit before killing offscreen to allow last chunk processing
  setTimeout(() => closeOffscreen(), 2000);
}

// 5. PDF Generator Injection
function injectPdfGenerator(tabId, fullText) {
  chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
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

        doc.save(`transcript_${new Date().toISOString().slice(0,16)}.pdf`);
      } catch (e) {
        alert("PDF Generation Error: " + e.message + "\n(Check internet connection)");
      }
    },
    args: [fullText]
  });
}