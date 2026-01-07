// background.js

// 1. Manage Offscreen Document
async function ensureOffscreenDocument() {
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: ['offscreen.html']
  });

  if (existingContexts.length > 0) return;

  await chrome.offscreen.createDocument({
    url: 'offscreen.html',
    reasons: ['USER_MEDIA'],
    justification: 'Recording tab audio for AI transcription'
  });
}

// 2. Message Listener
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'START_CAPTURE') {
    handleStartCapture(message);
  } else if (message.action === 'STOP_CAPTURE') {
    chrome.runtime.sendMessage({ action: 'STOP_RECORDING' }); // Send to offscreen
  } else if (message.action === 'TRANSCRIPT_RECEIVED') {
    // Forward transcript from Offscreen -> Active Tab Content Script
    forwardTranscriptToActiveTab(message.text);
  } else if (message.action === 'DOWNLOAD_PDF') {
    // Inject PDF generation into the Main World of the tab
    if (sender.tab?.id) {
      chrome.scripting.executeScript({
        target: { tabId: sender.tab.id },
        world: 'MAIN',
        func: generatePdfInMainWorld,
        args: [message.text]
      });
    }
  } else if (message.action === 'ERROR') {
    console.error("Extension Error:", message.error);
  }
});

async function handleStartCapture(data) {
  try {
    await ensureOffscreenDocument();
    
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!activeTab) {
      chrome.runtime.sendMessage({ action: 'UI_ERROR', error: 'No active tab found.' });
      return;
    }

    // Initialize content script overlay
    await chrome.scripting.executeScript({
      target: { tabId: activeTab.id },
      files: ['content.js']
    });
    
    // Slight delay to ensure content script is ready
    setTimeout(() => {
      chrome.tabs.sendMessage(activeTab.id, { action: 'SHOW_OVERLAY' }).catch(() => {});
    }, 500);

    // Tell Offscreen to start recording this specific tab
    chrome.runtime.sendMessage({
      action: 'INIT_RECORDING',
      targetTabId: activeTab.id,
      apiKey: data.apiKey,
      sourceLang: data.sourceLang,
      targetLang: data.targetLang
    });

  } catch (err) {
    chrome.runtime.sendMessage({ action: 'UI_ERROR', error: err.message });
  }
}

async function forwardTranscriptToActiveTab(text) {
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (activeTab) {
    chrome.tabs.sendMessage(activeTab.id, { 
      action: 'APPEND_TRANSCRIPT', 
      text: text 
    }).catch(err => console.log('Tab closed or content script missing'));
  }
}

// 3. PDF Generator (Runs in Main World to access CDN)
async function generatePdfInMainWorld(fullText) {
  try {
    // Dynamically import jsPDF from CDN
    // Note: We use the UMD build which sets window.jspdf
    const { jsPDF } = await import('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js');
    
    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();
    const margin = 15;
    const maxLineWidth = pageWidth - (margin * 2);

    doc.setFontSize(18);
    doc.text("Gemini Live Transcript", margin, 20);
    
    doc.setFontSize(12);
    
    // Split text into lines that fit the page
    const lines = doc.splitTextToSize(fullText, maxLineWidth);
    let y = 35;

    lines.forEach(line => {
      if (y > 280) {
        doc.addPage();
        y = 20;
      }
      doc.text(line, margin, y);
      y += 7;
    });

    doc.save(`transcript_${new Date().toISOString().slice(0,19).replace(/:/g,'-')}.pdf`);
  } catch (e) {
    alert("Failed to generate PDF. Ensure internet connection for CDN load.");
    console.error(e);
  }
}