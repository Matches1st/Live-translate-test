// background.js

const OFFSCREEN_PATH = 'offscreen.html';
let capturingTabId = null;

// 1. Handle Extension Icon Click
chrome.action.onClicked.addListener(async (tab) => {
  // If capturing a different tab, stop it first
  if (capturingTabId && capturingTabId !== tab.id) {
    await stopCapture();
  }

  // Inject UI. We attempt injection every time, but content.js has a guard 
  // to prevent re-execution/duplicate variables.
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['content.js']
    });
  } catch (e) {
    console.log("Injection skipped or restricted page:", e.message);
  }

  // Send Toggle Command
  try {
    await chrome.tabs.sendMessage(tab.id, { action: 'TOGGLE_UI' });
  } catch (err) {
    console.warn("Could not toggle UI (tab loading or restricted):", err);
  }
});

// 2. Offscreen Document Management
async function ensureOffscreen() {
  const offscreenUrl = chrome.runtime.getURL(OFFSCREEN_PATH);
  
  // Check existence using full URL
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
  // Check if sender tab is still valid
  if (chrome.runtime.lastError) {
    console.warn("Runtime error:", chrome.runtime.lastError);
    return;
  }

  // Commands from Content Script
  if (msg.action === 'REQUEST_START_CAPTURE') {
    handleStartCapture(sender.tab.id, msg.config);
  } else if (msg.action === 'REQUEST_STOP_CAPTURE') {
    stopCapture();
  } else if (msg.action === 'UPDATE_CONFIG') {
    chrome.runtime.sendMessage({ action: 'UPDATE_CONFIG', config: msg.config }).catch(() => {});
  }
  
  // Messages from Offscreen -> Content Script
  else if (capturingTabId) {
    const forwardActions = ['TRANSCRIPT_RECEIVED', 'OFFSCREEN_ERROR', 'NO_SPEECH', 'CHUNK_PROCESSED'];
    if (forwardActions.includes(msg.action)) {
      chrome.tabs.sendMessage(capturingTabId, msg).catch((err) => {
        // Tab might have been closed
        if (err.message.includes("closed")) {
          stopCapture();
        }
      });
    }
  }
});

// 4. Capture Logic
async function handleStartCapture(tabId, config) {
  try {
    capturingTabId = tabId;
    await ensureOffscreen();
    
    // Get Stream ID
    const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId });

    // Initialize Recorder in Offscreen
    // Wait a brief moment to ensure offscreen is ready to receive
    setTimeout(() => {
        chrome.runtime.sendMessage({
          action: 'INIT_RECORDER',
          streamId: streamId,
          config: config
        }).catch(e => console.error("Failed to init recorder:", e));
    }, 100);

    // Notify Content Script
    chrome.tabs.sendMessage(tabId, { action: 'CAPTURE_STARTED' });

  } catch (err) {
    console.error("Capture failed:", err);
    chrome.tabs.sendMessage(tabId, { action: 'ERROR', error: "Capture failed: " + err.message }).catch(() => {});
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