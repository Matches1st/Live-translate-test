// offscreen.js

let recorder = null;
let audioCtx = null;
let mediaStream = null;
let currentConfig = {};
let isProcessing = false;

// 15 seconds chunking
const CHUNK_MS = 15000; 
// 20KB threshold to prevent empty audio calls
const MIN_BLOB_SIZE = 20000; 

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

    // 2. Audio Routing (Preserve Tab Audio)
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
  
  // Silence Check (Save Quota)
  if (blob.size < MIN_BLOB_SIZE) {
    chrome.runtime.sendMessage({ action: 'NO_SPEECH' });
    return;
  }

  // Notify Background we are processing
  chrome.runtime.sendMessage({ action: 'CHUNK_PROCESSED' });

  try {
    const base64Data = await blobToBase64(blob);
    const text = await callGemini(base64Data);
    
    if (text) {
      chrome.runtime.sendMessage({ action: 'TRANSCRIPT_RECEIVED', text });
    } else {
      chrome.runtime.sendMessage({ action: 'NO_SPEECH' });
    }
  } catch (err) {
    console.error("Gemini API Error:", err);
    // Categorize Errors for User
    let msg = err.message;
    if (msg.includes("403") || msg.includes("key")) {
       msg = "Invalid API Key or Permissions (403)";
    } else if (msg.includes("429")) {
       msg = "API Rate Limit Exceeded (429) - Waiting...";
    } else if (msg.includes("404")) {
       msg = "Model Not Found (404) - Check API Support";
    } else if (msg.includes("400")) {
       msg = "Bad Request (400) - Audio Format/Param";
    }
    
    // If it's a hard error, stop. If rate limit, maybe keep going (UI decides)
    if (msg.includes("403") || msg.includes("404")) {
        reportError(msg);
        stopRecording();
    } else {
        reportError(msg);
    }
  }
}

async function callGemini(base64Audio) {
  const { apiKey, sourceLang, targetLang } = currentConfig;
  
  const instruction = `
You are an expert transcriber.
- Task: Transcribe the audio chunk accurately.
- Source Language: ${sourceLang === 'Auto-detect' ? 'Detect automatically' : sourceLang}.
- Target Language: ${targetLang === 'None' ? 'Same as source (transcription only)' : targetLang}.
- Output Requirement: Return ONLY the raw transcript text.
- Formatting: Ensure proper punctuation, capitalization, and grammar. Clean up stuttering.
- Silence/Noise: If no clear speech is heard, return an empty string.
  `.trim();

  // Endpoint: Using gemini-2.5-flash as requested
  const url = `https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
  
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{
        parts: [
          { text: instruction },
          { inline_data: { mime_type: "audio/webm", data: base64Audio } }
        ]
      }]
    })
  });

  if (!response.ok) {
    let errText = await response.text();
    try {
        const errJson = JSON.parse(errText);
        errText = errJson.error?.message || errText;
    } catch(e) {}
    throw new Error(`HTTP ${response.status}: ${errText}`);
  }

  const data = await response.json();
  
  // Extract text
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