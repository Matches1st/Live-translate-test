// popup.js

const LANGUAGES = [
  "English", "Spanish", "French", "German", "Chinese (Simplified)", "Japanese", "Korean", "Russian", "Portuguese", "Italian",
  "Arabic", "Hindi", "Dutch", "Turkish", "Polish", "Swedish", "Danish", "Norwegian", "Finnish", "Greek",
  "Hebrew", "Thai", "Vietnamese", "Indonesian", "Malay", "Filipino", "Ukrainian", "Romanian", "Czech", "Hungarian",
  "Bulgarian", "Croatian", "Slovak", "Lithuanian", "Slovenian", "Latvian", "Estonian", "Serbian", "Bengali", "Persian",
  "Urdu", "Tamil", "Telugu", "Marathi", "Swahili", "Afrikaans", "Catalan", "Galician", "Basque", "Icelandic", "Irish"
];

const els = {
  apiKey: document.getElementById('apiKey'),
  source: document.getElementById('sourceLang'),
  target: document.getElementById('targetLang'),
  start: document.getElementById('startBtn'),
  stop: document.getElementById('stopBtn'),
  status: document.getElementById('status')
};

// Populate Lists
LANGUAGES.sort().forEach(lang => {
  const opt1 = new Option(lang, lang);
  const opt2 = new Option(lang, lang);
  els.source.add(opt1);
  els.target.add(opt2);
});

// Load Settings
chrome.storage.local.get(['apiKey', 'sourceLang', 'targetLang'], (res) => {
  if (res.apiKey) els.apiKey.value = res.apiKey;
  if (res.sourceLang) els.source.value = res.sourceLang;
  if (res.targetLang) els.target.value = res.targetLang;
});

// Save Settings Helper
const save = () => {
  chrome.storage.local.set({
    apiKey: els.apiKey.value.trim(),
    sourceLang: els.source.value,
    targetLang: els.target.value
  });
};

els.apiKey.addEventListener('input', save);
els.source.addEventListener('change', save);
els.target.addEventListener('change', save);

// Buttons
els.start.addEventListener('click', () => {
  const key = els.apiKey.value.trim();
  if (!key) {
    setStatus('API Key Required', true);
    return;
  }
  save();
  
  chrome.runtime.sendMessage({
    action: 'START_CAPTURE',
    apiKey: key,
    sourceLang: els.source.value,
    targetLang: els.target.value
  });

  els.start.disabled = true;
  els.stop.disabled = false;
  setStatus('Starting...');
});

els.stop.addEventListener('click', () => {
  chrome.runtime.sendMessage({ action: 'STOP_CAPTURE' });
  els.start.disabled = false;
  els.stop.disabled = true;
  setStatus('Stopped');
});

// Listen for Status Updates
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.action === 'STATUS_UPDATE') {
    setStatus(msg.status);
    if (msg.status === 'Stopped') {
      els.start.disabled = false;
      els.stop.disabled = true;
    } else if (msg.status === 'Listening...') {
      els.start.disabled = true;
      els.stop.disabled = false;
    }
  } else if (msg.action === 'UI_ERROR') {
    setStatus(msg.error, true);
    els.start.disabled = false;
    els.stop.disabled = true;
  }
});

function setStatus(text, isError = false) {
  els.status.textContent = text;
  els.status.classList.toggle('error', isError);
}