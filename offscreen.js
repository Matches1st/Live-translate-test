// offscreen.js

let recorder = null;
let audioCtx = null;
let mediaStream = null;
let currentConfig = {};
let isProcessing = false;

// 15 seconds chunking
const CHUNK_MS = 15000; 
// 10KB threshold. If blob is smaller, it's silence/quiet noise.
const MIN_BLOB_SIZE = 10000; 

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
  
  console.log(`Processing chunk: ${blob.size} bytes`);

  // Silence Check
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
    if (err.message.includes("403") || err.message.includes("key")) {
       reportError("Invalid API Key (Check Settings)");
       stopRecording();
    } else if (err.message.includes("429")) {
       reportError("Rate Limit (Wait a moment)");
    } else {
       reportError("API Error: " + err.message);
    }
  }
}

async function callGemini(base64Audio) {
  const { apiKey, sourceLang, targetLang } = currentConfig;
  
  const instruction = `
You are an expert transcriber and translator.
- Transcribe the audio accurately.
- ${sourceLang === 'Auto-detect' ? 'Auto-detect the spoken language.' : `Spoken language is ${sourceLang}.`}
- ${targetLang === 'None' ? 'Output clean English text only (or detected language).' : `Translate to ${targetLang}.`}
- Always: Add proper punctuation, capitalization, and grammar. Make it read naturally like written text. Fix any repetition or errors.
- Output ONLY the clean text. No labels, timestamps, or extras.
- If no clear speech (silence, noise, music only), output nothing.
  `.trim();

  // Endpoint: Using flash-latest as requested
  const url = `https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash-latest:generateContent?key=${apiKey}`;
  
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
    const errText = await response.text();
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