// offscreen.js

let recorder = null;
let audioCtx = null;
let mediaStream = null;
let currentConfig = {};
let isProcessing = false;

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.action === 'INIT_RECORDER') {
    startRecording(msg.streamId, msg.config);
  } else if (msg.action === 'STOP_RECORDER') {
    stopRecording();
  } else if (msg.action === 'UPDATE_CONFIG') {
    currentConfig = msg.config;
    console.log("Config updated");
  }
});

async function startRecording(streamId, config) {
  if (isProcessing) return;
  currentConfig = config;
  isProcessing = true;

  try {
    // 1. Capture Stream
    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        mandatory: {
          chromeMediaSource: 'tab',
          chromeMediaSourceId: streamId
        }
      },
      video: false
    });

    // 2. Playback Audio (prevent muting)
    audioCtx = new AudioContext();
    const source = audioCtx.createMediaStreamSource(mediaStream);
    source.connect(audioCtx.destination);

    // 3. Setup Recorder
    recorder = new MediaRecorder(mediaStream, { mimeType: 'audio/webm;codecs=opus' });
    
    recorder.ondataavailable = async (e) => {
      if (e.data.size > 0) processChunk(e.data);
    };

    // Chunk every 15s
    recorder.start(15000); 

  } catch (err) {
    chrome.runtime.sendMessage({ action: 'OFFSCREEN_ERROR', error: "Stream access failed. " + err.message });
    stopRecording();
  }
}

function stopRecording() {
  isProcessing = false;
  if (recorder && recorder.state !== 'inactive') recorder.stop();
  if (mediaStream) mediaStream.getTracks().forEach(t => t.stop());
  if (audioCtx) audioCtx.close();
}

async function processChunk(blob) {
  if (!isProcessing) return;
  
  try {
    const base64Data = await blobToBase64(blob);
    const text = await callGemini(base64Data);
    
    if (text) {
      chrome.runtime.sendMessage({ action: 'TRANSCRIPT_RECEIVED', text });
    }
  } catch (err) {
    console.error("API Error:", err);
    if (err.message.includes("403") || err.message.includes("key")) {
       chrome.runtime.sendMessage({ action: 'OFFSCREEN_ERROR', error: "Invalid API Key." });
       stopRecording();
    }
  }
}

async function callGemini(base64Audio) {
  const { apiKey, sourceLang, targetLang } = currentConfig;
  
  const source = sourceLang === 'Auto-detect' ? "Detect source language." : `Source: ${sourceLang}.`;
  const target = (targetLang === 'None' || targetLang === sourceLang) 
    ? "Transcribe verbatim. No translation." 
    : `Translate to ${targetLang}.`;

  const prompt = `
    Task: Speech-to-text.
    ${source}
    ${target}
    Strict Rules:
    - Output raw text only.
    - No timestamps, no speaker tags.
    - Ignore silence/noise.
    - If empty/music only, return empty string.
  `;

  const url = `https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
  
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{
        parts: [
          { text: prompt },
          { inline_data: { mime_type: "audio/webm", data: base64Audio } }
        ]
      }]
    })
  });

  const data = await response.json();
  if (data.error) throw new Error(data.error.message);
  
  return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
}

function blobToBase64(blob) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result.split(',')[1]);
    reader.readAsDataURL(blob);
  });
}