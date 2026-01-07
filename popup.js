// popup.js

const LANGUAGES = [
  "English", "Spanish", "French", "German", "Chinese (Simplified)", "Japanese", "Korean", "Russian", "Portuguese", "Italian",
  "Arabic", "Hindi", "Dutch", "Turkish", "Polish", "Swedish", "Danish", "Norwegian", "Finnish", "Greek",
  "Hebrew", "Thai", "Vietnamese", "Indonesian", "Malay", "Filipino", "Ukrainian", "Romanian", "Czech", "Hungarian",
  "Bulgarian", "Croatian", "Slovak", "Lithuanian", "Slovenian", "Latvian", "Estonian", "Serbian", "Bengali", "Persian",
  "Urdu", "Tamil", "Telugu", "Marathi", "Swahili", "Afrikaans"
];

const els = {
  apiKey: document.getElementById('apiKey'),
  source: document.getElementById('sourceLang'),
  target: document.getElementById('targetLang'),
  start: document.getElementById('start'),
  stop: document.getElementById('stop'),
  status: document.getElementById('status')
};

// 1. Initialize UI
LANGUAGES.sort().forEach(lang => {
  els.source.add(new Option(lang, lang));
  els.target.add(new Option(lang, lang));
});

chrome.storage.sync.get(['apiKey', 'sourceLang', 'targetLang'], (data) => {
  if (data.apiKey) els.apiKey.value = data.apiKey;
  if (data.sourceLang) els.source.value = data.sourceLang;
  if (data.targetLang) els.target.value = data.targetLang;
});

// 2. Save Helper
function saveSettings() {
  chrome.storage.sync.set({
    apiKey: els.apiKey.value.trim(),
    sourceLang: els.source.value,
    targetLang: els.target.value
  });
}

// 3. Button Actions
els.start.addEventListener('click', () => {
  const key = els.apiKey.value.trim();
  if (!key) {
    setStatus("API Key missing!", true);
    return;
  }
  
  saveSettings();
  
  chrome.runtime.sendMessage({
    action: 'START_CAPTURE',
    apiKey: key,
    sourceLang: els.source.value,
    targetLang: els.target.value
  });

  setStatus("Initializing capture...");
  toggleButtons(true);
});

els.stop.addEventListener('click', () => {
  chrome.runtime.sendMessage({ action: 'STOP_CAPTURE' });
  setStatus("Stopping...");
  toggleButtons(false);
});

// 4. Listeners
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.action === 'SHOW_ERROR') {
    setStatus(msg.error, true);
    toggleButtons(false);
  } else if (msg.action === 'CAPTURE_STOPPED') {
    setStatus("Stopped");
    toggleButtons(false);
  }
});

function toggleButtons(isCapturing) {
  els.start.disabled = isCapturing;
  els.stop.disabled = !isCapturing;
}

function setStatus(text, isError = false) {
  els.status.textContent = text;
  els.status.classList.toggle('error', isError);
}
