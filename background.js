// background.js
// Handles offscreen document creation and message routing between popup, offscreen, and content.

let creatingOffscreen = false;

// Ensure the offscreen document exists
async function setupOffscreenDocument(path) {
  // Check if offscreen document already exists
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [path]
  });

  if (existingContexts.length > 0) {
    return;
  }

  // Create offscreen document if not exists
  if (creatingOffscreen) {
    await creatingOffscreen;
  } else {
    creatingOffscreen = chrome.offscreen.createDocument({
      url: path,
      reasons: ['USER_MEDIA'],
      justification: 'Recording tab audio for transcription',
    });
    await creatingOffscreen;
    creatingOffscreen = null;
  }
}

// Listen for messages from Popup
chrome.runtime.onMessage.addListener(async (message, sender, sendResponse) => {
  if (message.action === 'START_CAPTURE') {
    await setupOffscreenDocument('offscreen.html');
    
    // Get the active tab to capture
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    if (!activeTab) {
      chrome.runtime.sendMessage({ action: 'ERROR', error: 'No active tab found.' });
      return;
    }

    // Forward start command to offscreen document with tab ID
    chrome.runtime.sendMessage({
      action: 'INIT_RECORDING',
      targetTabId: activeTab.id,
      apiKey: message.apiKey,
      sourceLang: message.sourceLang,
      targetLang: message.targetLang
    });

    // Inject content script overlay if not present (handled by content script existence, 
    // but we send a message to ensure it's visible)
    try {
      await chrome.tabs.sendMessage(activeTab.id, { action: 'SHOW_OVERLAY' });
    } catch (e) {
      console.log('Content script might not be ready, injecting now...');
      await chrome.scripting.executeScript({
        target: { tabId: activeTab.id },
        files: ['content.js']
      });
    }

  } else if (message.action === 'STOP_CAPTURE') {
    chrome.runtime.sendMessage({ action: 'STOP_RECORDING' });
    // Also notify content script to stop showing "Listening..." status
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if(activeTab) {
      chrome.tabs.sendMessage(activeTab.id, { action: 'STATUS_UPDATE', status: 'Stopped' }).catch(() => {});
    }
  }
});
