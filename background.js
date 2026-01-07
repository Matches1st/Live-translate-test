// background.js

const OFFSCREEN_PATH = 'offscreen.html';
let capturingTabId = null;

// 1. Handle Extension Icon Click
chrome.action.onClicked.addListener(async (tab) => {
  // Inject UI if needed
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['content.js']
    });
  } catch (e) {
    console.log("Injection skipped/restricted:", e.message);
  }

  // Toggle UI visibility
  try {
    await chrome.tabs.sendMessage(tab.id, { action: 'TOGGLE_UI' });
  } catch (err) {
    console.warn("Tab not ready:", err);
  }
});

// 2. Offscreen Management
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
  if (capturingTabId) {
    // Notify offscreen to stop recording logic
    chrome.runtime.sendMessage({ action: 'CLEANUP_OFFSCREEN' }).catch(() => {});
  }
  await chrome.offscreen.closeDocument().catch(() => {});
}

// 3. Message Routing
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (chrome.runtime.lastError) return;

  // --- From Content Script (UI) ---
  if (msg.action === 'REQUEST_START_CAPTURE') {
    handleStartCapture(sender.tab.id, msg.config);
  } 
  else if (msg.action === 'REQUEST_STOP_CAPTURE') {
    handleStopCapture();
  } 
  else if (msg.action === 'UPDATE_CONFIG') {
    chrome.runtime.sendMessage({ action: 'UPDATE_CONFIG', config: msg.config }).catch(() => {});
  }
  
  // --- From Offscreen -> Content Script ---
  else if (capturingTabId) {
    const forwardActions = ['TRANSCRIPT_RECEIVED', 'OFFSCREEN_ERROR', 'NO_SPEECH', 'CHUNK_PROCESSED'];
    if (forwardActions.includes(msg.action)) {
      chrome.tabs.sendMessage(capturingTabId, msg).catch((err) => {
        // If tab is closed, clean up
        if (err.message.includes("closed")) handleStopCapture();
      });
    }
  }
});

// 4. Capture Logic
async function handleStartCapture(tabId, config) {
  try {
    if (capturingTabId && capturingTabId !== tabId) {
      await handleStopCapture();
    }
    
    capturingTabId = tabId;
    await ensureOffscreen();
    
    // Get Stream ID
    const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId });

    // Initialize Recorder (delay slightly for offscreen readiness)
    setTimeout(() => {
        chrome.runtime.sendMessage({
          action: 'INIT_RECORDER',
          streamId: streamId,
          config: config
        }).catch(e => console.error("Init failed:", e));
    }, 100);

    chrome.tabs.sendMessage(tabId, { action: 'CAPTURE_STARTED' });

  } catch (err) {
    console.error("Capture Start Failed:", err);
    chrome.tabs.sendMessage(tabId, { action: 'ERROR', error: "Capture failed: " + err.message }).catch(() => {});
    closeOffscreen();
    capturingTabId = null;
  }
}

async function handleStopCapture() {
  if (!capturingTabId) return;
  
  // 1. Tell offscreen to process the remaining chunk immediately
  chrome.runtime.sendMessage({ action: 'FORCE_CHUNK' }).catch(() => {});
  
  // 2. Notify UI
  chrome.tabs.sendMessage(capturingTabId, { action: 'CAPTURE_STOPPED' }).catch(() => {});
  
  capturingTabId = null;

  // 3. Wait a few seconds for the final network request to finish, then close offscreen
  setTimeout(() => {
    closeOffscreen();
  }, 4000); 
}