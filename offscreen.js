// offscreen.js

let recorder = null;
let audioContext = null;
let mediaStream = null;
let isRecording = false;

// Config
const CHUNK_DURATION_MS = 15000; // 15 seconds
const MODEL = 'gemini-1.5-flash';

chrome.runtime.onMessage.addListener(async (msg) => {
  if (msg.action === 'INIT_RECORDING') {
    startRecording(msg);
  } else if (msg.action === 'STOP_RECORDING') {
    stopRecording();
  }
});

async function startRecording({ targetTabId, apiKey, sourceLang, targetLang }) {
  if (isRecording) stopRecording();

  try {
    // 1. Get Stream ID
    const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId });

    // 2. Get Media Stream
    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        mandatory: {
          chromeMediaSource: 'tab',
          chromeMediaSourceId: streamId
        }
      }
    });

    // 3. Audio Context Hack (CRITICAL: Routes audio to speakers so user can hear it)
    audioContext = new AudioContext();
    const source = audioContext.createMediaStreamSource(mediaStream);
    source.connect(audioContext.destination);

    // 4. Setup Recorder
    recorder = new MediaRecorder(mediaStream, {
      mimeType: 'audio/webm;codecs=opus'
    });

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) {
        processChunk(e.data, apiKey, sourceLang, targetLang);
      }
    };

    recorder.start(CHUNK_DURATION_MS);
    isRecording = true;
    chrome.runtime.sendMessage({ action: 'STATUS_UPDATE', status: 'Listening...' });

  } catch (err) {
    console.error(err);
    chrome.runtime.sendMessage({ action: 'UI_ERROR', error: 'Capture failed: ' + err.message });
  }
}

function stopRecording() {
  isRecording = false;
  if (recorder && recorder.state !== 'inactive') recorder.stop();
  if (mediaStream) mediaStream.getTracks().forEach(t => t.stop());
  if (audioContext) audioContext.close();
  
  chrome.runtime.sendMessage({ action: 'STATUS_UPDATE', status: 'Stopped' });
}

async function processChunk(blob, apiKey, sourceLang, targetLang) {
  if (!isRecording) return; // Ignore chunks after stop

  try {
    const base64Data = await blobToBase64(blob);

    // Build Prompt
    const src = sourceLang === 'Auto-detect' ? "Detect the language." : `Source language: ${sourceLang}.`;
    const tgt = targetLang === 'None' ? "Transcribe exactly what is said." : `Translate to ${targetLang}. Output ONLY the translated text.`;
    
    const prompt = `
      Task: Speech-to-text.
      ${src}
      ${tgt}
      Rules:
      1. Output ONLY the raw text.
      2. No timestamps, no speaker labels, no introductory phrases.
      3. If no speech is detected, output nothing.
      4. Do not describe background noise (e.g. [music], [applause]).
    `;

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${apiKey}`;
    
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: prompt },
            { inline_data: { mime_type: "audio/webm", data: base64Data } }
          ]
        }]
      })
    });

    const data = await response.json();
    
    if (data.error) {
      throw new Error(data.error.message);
    }

    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    
    if (text && text.trim().length > 0) {
      chrome.runtime.sendMessage({ action: 'TRANSCRIPT_RECEIVED', text: text.trim() });
    }

  } catch (err) {
    console.error('API Error', err);
    // Don't spam errors for every chunk, maybe just log or subtle notify
    if (err.message.includes('API key')) {
      stopRecording();
      chrome.runtime.sendMessage({ action: 'UI_ERROR', error: 'Invalid API Key' });
    }
  }
}

function blobToBase64(blob) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result.split(',')[1]);
    reader.readAsDataURL(blob);
  });
}