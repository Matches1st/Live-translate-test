// offscreen.js
// Handles the audio stream, routing, recording, and API calls.

let recorder = null;
let audioCtx = null;
let mediaStream = null;
let config = {};
let isProcessing = false;

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.action === 'INIT_RECORDER') {
    startRecording(msg);
  } else if (msg.action === 'STOP_RECORDER') {
    stopRecording();
  }
});

async function startRecording(data) {
  if (isProcessing) return;
  config = data;
  isProcessing = true;

  try {
    // 1. Get the stream using the ID provided by background.js
    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        mandatory: {
          chromeMediaSource: 'tab',
          chromeMediaSourceId: data.streamId
        }
      },
      video: false
    });

    // 2. Audio Context Hack (CRITICAL)
    // Connecting the stream to destination ensures the user still hears the audio.
    audioCtx = new AudioContext();
    const source = audioCtx.createMediaStreamSource(mediaStream);
    source.connect(audioCtx.destination);

    // 3. Setup MediaRecorder
    // 15 seconds chunking to balance latency and context
    recorder = new MediaRecorder(mediaStream, {
      mimeType: 'audio/webm;codecs=opus'
    });

    recorder.ondataavailable = async (e) => {
      if (e.data.size > 0) {
        const blob = e.data;
        await processAudioChunk(blob);
      }
    };

    // Collect data every 15 seconds
    recorder.start(15000); 

  } catch (err) {
    chrome.runtime.sendMessage({ action: 'ERROR', error: 'Capture Error: ' + err.message });
    stopRecording();
  }
}

function stopRecording() {
  isProcessing = false;
  if (recorder && recorder.state !== 'inactive') {
    recorder.stop();
  }
  if (mediaStream) {
    mediaStream.getTracks().forEach(t => t.stop());
  }
  if (audioCtx) {
    audioCtx.close();
  }
}

async function processAudioChunk(blob) {
  if (!isProcessing) return;

  try {
    const base64Data = await blobToBase64(blob);

    // Construct Prompt
    const sourceInstr = config.sourceLang === 'Auto-detect' 
      ? "Detect the source language automatically." 
      : `The source language is ${config.sourceLang}.`;
      
    const targetInstr = (config.targetLang === 'None' || config.targetLang === config.sourceLang)
      ? "Transcribe the audio exactly as spoken."
      : `Translate the spoken content into ${config.targetLang}.`;

    const prompt = `
      Task: Professional Speech-to-Text.
      ${sourceInstr}
      ${targetInstr}
      Instructions:
      1. Output ONLY the raw transcript/translation.
      2. Do NOT include timestamps, speaker labels, or descriptions like [music].
      3. If there is no speech, return an empty string.
    `;

    // Gemini 1.5 Flash Endpoint
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${config.apiKey}`;

    const payload = {
      contents: [{
        parts: [
          { text: prompt },
          { inline_data: { mime_type: "audio/webm", data: base64Data } }
        ]
      }]
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const result = await response.json();

    if (result.error) {
      throw new Error(result.error.message);
    }

    const text = result.candidates?.[0]?.content?.parts?.[0]?.text;
    
    if (text && text.trim().length > 0) {
      chrome.runtime.sendMessage({ action: 'TRANSCRIPT_RECEIVED', text: text.trim() });
    }

  } catch (err) {
    console.error("API Error", err);
    // Only notify fatal auth errors to avoid spamming UI on temporary net issues
    if (err.message && (err.message.includes('API key') || err.message.includes('403'))) {
      chrome.runtime.sendMessage({ action: 'ERROR', error: 'API Error: ' + err.message });
      stopRecording();
    }
  }
}

function blobToBase64(blob) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      // Remove "data:audio/webm;base64," prefix
      const base64 = reader.result.split(',')[1];
      resolve(base64);
    };
    reader.readAsDataURL(blob);
  });
}
