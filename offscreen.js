// offscreen.js

let recorder = null;
let audioCtx = null;
let mediaStream = null;
let currentConfig = {};
let isProcessing = false;
let lastTranscript = ""; // Context buffer

// 30 Seconds per chunk (approx natural pause length)
const CHUNK_MS = 30000; 

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.action === 'INIT_RECORDER') {
    startRecording(msg.streamId, msg.config);
  } 
  else if (msg.action === 'STOP_RECORDER') {
    stopRecording();
  } 
  else if (msg.action === 'FORCE_CHUNK') {
    // Stop recorder immediately to flush buffer
    if (recorder && recorder.state === 'recording') {
      recorder.stop();
    }
    isProcessing = false; 
  }
  else if (msg.action === 'UPDATE_CONFIG') {
    currentConfig = msg.config;
  }
  else if (msg.action === 'CLEANUP_OFFSCREEN') {
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
    source.connect(audioCtx.destination);

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
  // Silence threshold: <10KB is likely silence
  if (blob.size < 10000) return;

  chrome.runtime.sendMessage({ action: 'CHUNK_PROCESSED' });

  try {
    const base64Data = await blobToBase64(blob);
    const text = await callGemini(base64Data);
    
    if (text) {
      // Append to context buffer
      lastTranscript += " " + text;
      // Keep only last 800 chars for context to avoid huge prompts
      if (lastTranscript.length > 800) lastTranscript = lastTranscript.slice(-800);
      
      chrome.runtime.sendMessage({ action: 'TRANSCRIPT_RECEIVED', text });
    } else {
      chrome.runtime.sendMessage({ action: 'NO_SPEECH' });
    }
  } catch (err) {
    console.error("API Error:", err);
    let msg = err.message;
    if (msg.includes("403") || msg.includes("key")) msg = "Invalid API Key (403)";
    else if (msg.includes("429")) msg = "Rate Limit (429) - Waiting...";
    else if (msg.includes("404")) msg = "Model Not Found (404)";
    
    reportError(msg);
    
    // Stop on fatal auth errors
    if (msg.includes("403") || msg.includes("404")) stopRecording();
  }
}

async function callGemini(base64Audio) {
  const { apiKey, sourceLang, targetLang } = currentConfig;
  
  // Use v1beta endpoint for better audio support
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

  // Robust Plain Text Prompt
  const prompt = `
  Transcribe the audio precisely.
  Previous text to continue: ...${lastTranscript.replace(/\n/g, ' ')}

  Rules:
  - ONLY output clear, audible speech. If silent, noisy, music-only, or unclear: output NOTHING (empty string).
  - NEVER hallucinate, invent, repeat, or add words not heard.
  - Continue sentences naturally from previous context.
  - Source language: ${sourceLang === 'Auto-detect' ? 'auto-detect' : sourceLang}
  - ${targetLang === 'None' ? 'Keep original language.' : `Translate to ${targetLang}.`}
  - Add proper punctuation, capitalization, grammar for natural reading.
  - Output ONLY the clean text. No extras, labels, or notes.
  `.trim();
  
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

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`HTTP ${response.status} ${errText}`);
  }

  const data = await response.json();
  let cleanText = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
  cleanText = cleanText.trim();

  // Client-side anti-hallucination filter
  if (cleanText.length < 2) return null;
  
  const lower = cleanText.toLowerCase();
  const hallucinations = [
    "subtitles by", "copyright", "all rights reserved", 
    "thank you for watching", "visit our website", 
    "audio", "transcribed by", "captioned by",
    "music", "applause", "inaudible"
  ];

  if (hallucinations.some(h => lower.includes(h))) return null;

  // Filter out "lazy dog" or "quick brown fox" test patterns often hallucinated
  if (/quick brown fox/i.test(cleanText) || /lazy dog/i.test(cleanText)) return null;

  return cleanText;
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