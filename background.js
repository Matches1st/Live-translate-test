// background.js

const OFFSCREEN_PATH = 'offscreen.html';
let capturingTabId = null;

// 1. Handle Extension Icon Click (Toggle)
chrome.action.onClicked.addListener(async (tab) => {
  if (capturingTabId === tab.id) {
    // If already capturing this tab, stop it
    await stopCapture();
  } else {
    // If capturing another tab, stop that first
    if (capturingTabId) {
      await stopCapture();
    }
    // Start/Show UI on new tab
    await injectAndShowUI(tab.id);
  }
});

async function injectAndShowUI(tabId) {
  try {
    // Ensure content script is ready
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content.js']
    });
    // Send toggle command
    chrome.tabs.sendMessage(tabId, { action: 'TOGGLE_UI' }).catch(() => {});
  } catch (err) {
    console.error("Injection failed:", err);
  }
}

// 2. Offscreen Document Management
async function ensureOffscreen() {
  const offscreenUrl = chrome.runtime.getURL(OFFSCREEN_PATH);
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [offscreenUrl]
  });

  if (existingContexts.length > 0) return;

  await chrome.offscreen.createDocument({
    url: OFFSCREEN_PATH,
    reasons: ['AUDIO_PLAYBACK'],
    justification: 'Real-time tab audio transcription',
  });
}

async function closeOffscreen() {
  await chrome.offscreen.closeDocument().catch(() => {}); // Ignore if not exists
}

// 3. Message Routing
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'REQUEST_START_CAPTURE') {
    handleStartCapture(sender.tab.id, msg.config);
  } else if (msg.action === 'REQUEST_STOP_CAPTURE') {
    stopCapture();
  } else if (msg.action === 'UPDATE_CONFIG') {
    chrome.runtime.sendMessage({ action: 'UPDATE_CONFIG', config: msg.config }).catch(() => {});
  } else if (msg.action === 'TRANSCRIPT_RECEIVED') {
    if (capturingTabId) {
      chrome.tabs.sendMessage(capturingTabId, { action: 'TRANSCRIPT_UPDATE', text: msg.text }).catch(() => {});
    }
  } else if (msg.action === 'OFFSCREEN_ERROR') {
    if (capturingTabId) {
      chrome.tabs.sendMessage(capturingTabId, { action: 'ERROR', error: msg.error }).catch(() => {});
    }
    stopCapture();
  } else if (msg.action === 'DOWNLOAD_PDF') {
    injectPdfGenerator(sender.tab.id, msg.text);
  }
});

// 4. Capture Logic
async function handleStartCapture(tabId, config) {
  try {
    await ensureOffscreen();
    
    const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId });
    capturingTabId = tabId;

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
    chrome.tabs.sendMessage(tabId, { action: 'ERROR', error: "Could not access tab audio. " + err.message });
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
  
  // Close offscreen after short delay to allow final processing
  setTimeout(() => closeOffscreen(), 1000);
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
        const margin = 15;
        const width = doc.internal.pageSize.getWidth() - (margin * 2);
        
        doc.setFontSize(18);
        doc.text("Gemini Transcript", margin, 20);
        doc.setFontSize(12);
        
        const lines = doc.splitTextToSize(text, width);
        let y = 35;
        
        lines.forEach(line => {
          if (y > 280) { doc.addPage(); y = 20; }
          doc.text(line, margin, y);
          y += 7;
        });
        
        doc.save(`transcript_${new Date().toISOString().slice(0,16)}.pdf`);
      } catch (e) {
        alert("PDF Error: " + e.message);
      }
    },
    args: [fullText]
  });
}