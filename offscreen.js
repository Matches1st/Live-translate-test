// offscreen.js

let recorder = null;
let audioCtx = null;
let mediaStream = null;
let currentConfig = {};
let isProcessing = false;

// Config constants
const CHUNK_MS = 15000; // 15 seconds
const MIN_BLOB_SIZE = 10000; // 10KB threshold for silence detection

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.action === 'INIT_RECORDER') {
    startRecording(msg.streamId, msg.config);
  } else if (msg.action === 'STOP_RECORDER') {
    stopRecording();
  } else if (msg.action === 'UPDATE_CONFIG') {
    currentConfig = msg.config;
  }
});

async function startRecording(streamId, config) {
  if (isProcessing) return;
  currentConfig = config;
  isProcessing = true;

  try {
    // 1. Get Stream
    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        mandatory: {
          chromeMediaSource: 'tab',
          chromeMediaSourceId: streamId
        }
      },
      video: false
    });

    // 2. Audio Routing (CRITICAL: Preserves Tab Audio)
    audioCtx = new AudioContext();
    const source = audioCtx.createMediaStreamSource(mediaStream);
    source.connect(audioCtx.destination);

    // 3. Recorder
    recorder = new MediaRecorder(mediaStream, { mimeType: 'audio/webm;codecs=opus' });
    
    recorder.ondataavailable = async (e) => {
      if (e.data.size > 0) {
        await processChunk(e.data);
      }
    };

    // Start chunking
    recorder.start(CHUNK_MS);

  } catch (err) {
    reportError("Audio capture failed: " + err.message);
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
  
  // Silence Detection (Simple size check)
  if (blob.size < MIN_BLOB_SIZE) {
    // Too quiet, likely silence. Skip API call.
    return;
  }

  try {
    const base64Data = await blobToBase64(blob);
    const text = await callGemini(base64Data);
    
    if (text) {
      chrome.runtime.sendMessage({ action: 'TRANSCRIPT_RECEIVED', text });
    }
  } catch (err) {
    console.error("Gemini API Error:", err);
    if (err.message.includes("403") || err.message.includes("key")) {
       reportError("Invalid API Key.");
       stopRecording();
    } else if (err.message.includes("429")) {
       reportError("Rate limit exceeded. Waiting...");
    } else {
       // Non-fatal error, maybe just logging
       console.log("Transient error:", err.message);
    }
  }
}

async function callGemini(base64Audio) {
  const { apiKey, sourceLang, targetLang } = currentConfig;
  
  // Prompt Construction
  const sourcePart = sourceLang === 'Auto-detect' 
    ? "Detect the source language automatically." 
    : `The audio is in ${sourceLang}.`;
    
  const targetPart = (targetLang === 'None' || targetLang === sourceLang)
    ? "Transcribe the audio verbatim. Do not translate."
    : `Translate the content into ${targetLang}.`;

  const prompt = `
    Task: Accurate Speech-to-Text.
    ${sourcePart}
    ${targetPart}
    Instructions:
    - Output ONLY the transcript/translation.
    - Do NOT include timestamps, speaker names, or descriptions like [music].
    - If the audio is silence or music only, return empty string.
  `;

  // Using v1beta as it is commonly available for free keys
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
  
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
  
  if (data.error) {
    throw new Error(data.error.message);
  }

  return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
}

function blobToBase64(blob) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64 = reader.result.split(',')[1];
      resolve(base64);
    };
    reader.readAsDataURL(blob);
  });
}

function reportError(msg) {
  chrome.runtime.sendMessage({ action: 'OFFSCREEN_ERROR', error: msg });
}