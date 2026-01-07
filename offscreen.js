// offscreen.js

let recorder = null;
let audioCtx = null;
let mediaStream = null;
let currentConfig = {};
let isProcessing = false;
let lastTranscript = ""; // Context buffer

// 30 Seconds per chunk
const CHUNK_MS = 30000; 

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.action === 'INIT_RECORDER') {
    startRecording(msg.streamId, msg.config);
  } 
  else if (msg.action === 'STOP_RECORDER') {
    // Standard stop
    stopRecording();
  } 
  else if (msg.action === 'FORCE_CHUNK') {
    // Immediately stop recorder to flush buffer, then stop session
    if (recorder && recorder.state === 'recording') {
      recorder.stop();
    }
    isProcessing = false; // Prevent further auto-chunks
  }
  else if (msg.action === 'UPDATE_CONFIG') {
    currentConfig = msg.config;
  }
  else if (msg.action === 'CLEANUP_OFFSCREEN') {
     // Clean up context when session totally ends
     lastTranscript = "";
     stopRecording();
  }
});

async function startRecording(streamId, config) {
  if (isProcessing) return;
  currentConfig = config;
  isProcessing = true;
  lastTranscript = "";

  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        mandatory: {
          chromeMediaSource: 'tab',
          chromeMediaSourceId: streamId
        }
      },
      video: false
    });

    audioCtx = new AudioContext();
    const source = audioCtx.createMediaStreamSource(mediaStream);
    source.connect(audioCtx.destination); // Play audio to speakers

    recorder = new MediaRecorder(mediaStream, { mimeType: 'audio/webm;codecs=opus' });
    
    recorder.ondataavailable = async (e) => {
      if (e.data.size > 0) {
        await processChunk(e.data);
      }
    };

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
  // If tiny blob (silence usually), skip to save API calls
  if (blob.size < 10000) return;

  chrome.runtime.sendMessage({ action: 'CHUNK_PROCESSED' });

  try {
    const base64Data = await blobToBase64(blob);
    const text = await callGemini(base64Data);
    
    if (text) {
      // Append to context
      lastTranscript += " " + text;
      // Keep only last 500 chars for context to avoid huge prompts
      if (lastTranscript.length > 500) lastTranscript = lastTranscript.slice(-500);
      
      chrome.runtime.sendMessage({ action: 'TRANSCRIPT_RECEIVED', text });
    } else {
      chrome.runtime.sendMessage({ action: 'NO_SPEECH' });
    }
  } catch (err) {
    console.error("API Error:", err);
    // Categorize errors for UI
    let msg = err.message;
    if (msg.includes("403") || msg.includes("key")) msg = "Invalid API Key (403)";
    else if (msg.includes("429")) msg = "Rate Limit (429) - Waiting...";
    else if (msg.includes("404")) msg = "Model Not Found (404)";
    
    reportError(msg);
    // If fatal, stop
    if (msg.includes("403") || msg.includes("404")) stopRecording();
  }
}

async function callGemini(base64Audio) {
  const { apiKey, sourceLang, targetLang } = currentConfig;
  
  // Use JSON Mode to force strict output and reduce hallucinations
  const prompt = `
  {
    "text": "..."
  }
  Instructions:
  1. Transcribe the audio chunk strictly.
  2. If silence, noise, music, or no clear speech: output {"text": ""}.
  3. Source Language: ${sourceLang}.
  4. Target Language: ${targetLang === 'None' ? 'Same as Source' : targetLang}.
  5. Context (previous sentence end): "...${lastTranscript.replace(/"/g, '')}"
  6. IMPORTANT: Continue the sentence naturally if needed. Add punctuation.
  7. DO NOT invent text. DO NOT output "Copyright", "Audio", "Subtitle", or "Thanks".
  `.trim();

  const url = `https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
  
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{
        parts: [
          { text: prompt },
          { inline_data: { mime_type: "audio/webm", data: base64Audio } }
        ]
      }],
      generationConfig: {
        response_mime_type: "application/json"
      }
    })
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`HTTP ${response.status} ${errText}`);
  }

  const data = await response.json();
  const rawJson = data.candidates?.[0]?.content?.parts?.[0]?.text;
  
  if (!rawJson) return null;

  try {
    const parsed = JSON.parse(rawJson);
    let cleanText = parsed.text ? parsed.text.trim() : "";

    // Client-side hallucination filter
    if (cleanText.length < 2) return null;
    
    const lower = cleanText.toLowerCase();
    const hallucinations = [
      "subtitles by", "copyright", "all rights reserved", 
      "thank you for watching", "visit our website", 
      "audio", "transcribed by", "captioned by"
    ];

    if (hallucinations.some(h => lower.includes(h))) return null;

    return cleanText;

  } catch (e) {
    console.log("JSON Parse Error (non-fatal):", e);
    return null;
  }
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