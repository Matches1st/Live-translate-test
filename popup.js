// popup.js

const apiKeyInput = document.getElementById('apiKey');
const sourceLangSelect = document.getElementById('sourceLang');
const targetLangSelect = document.getElementById('targetLang');
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const statusDiv = document.getElementById('status');

// Load saved settings
chrome.storage.local.get(['apiKey', 'sourceLang', 'targetLang'], (result) => {
  if (result.apiKey) apiKeyInput.value = result.apiKey;
  if (result.sourceLang) sourceLangSelect.value = result.sourceLang;
  if (result.targetLang) targetLangSelect.value = result.targetLang;
});

// Save settings on change
const saveSettings = () => {
  chrome.storage.local.set({
    apiKey: apiKeyInput.value,
    sourceLang: sourceLangSelect.value,
    targetLang: targetLangSelect.value
  });
};

apiKeyInput.addEventListener('change', saveSettings);
sourceLangSelect.addEventListener('change', saveSettings);
targetLangSelect.addEventListener('change', saveSettings);

// Listen for runtime messages to update status
chrome.runtime.onMessage.addListener((message) => {
  if (message.action === 'STATUS_UPDATE') {
    statusDiv.textContent = message.status;
  } else if (message.action === 'ERROR') {
    statusDiv.textContent = message.error;
    statusDiv.style.color = '#f87171';
  }
});

startBtn.addEventListener('click', () => {
  const apiKey = apiKeyInput.value.trim();
  if (!apiKey) {
    statusDiv.textContent = "Please enter an API Key.";
    statusDiv.style.color = '#f87171';
    return;
  }
  
  saveSettings();
  
  chrome.runtime.sendMessage({
    action: 'START_CAPTURE',
    apiKey: apiKey,
    sourceLang: sourceLangSelect.value,
    targetLang: targetLangSelect.value
  });

  startBtn.disabled = true;
  stopBtn.disabled = false;
  statusDiv.textContent = "Starting capture...";
  statusDiv.style.color = '#94a3b8';
});

stopBtn.addEventListener('click', () => {
  chrome.runtime.sendMessage({ action: 'STOP_CAPTURE' });
  startBtn.disabled = false;
  stopBtn.disabled = true;
  statusDiv.textContent = "Stopping...";
});
