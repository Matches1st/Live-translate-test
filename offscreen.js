// offscreen.js
// Handles Audio Capture, Recorder, and Gemini API calls

let recorder = null;
let data = [];
let recordingInterval = null;
let currentStream = null;
let audioContext = null;
let source = null;
let destination = null;

// Configuration
const CHUNK_INTERVAL = 15000; // 15 seconds
const MODEL_NAME = 'gemini-1.5-flash';

// Listen for commands
chrome.runtime.onMessage.addListener(async (message) => {
  if (message.action === 'INIT_RECORDING') {
    startRecording(message);
  } else if (message.action === 'STOP_RECORDING') {
    stopRecording();
  }
});

async function startRecording({ targetTabId, apiKey, sourceLang, targetLang }) {
  try {
    if (recorder) stopRecording();

    // 1. Get Media Stream ID for the target tab
    const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId });
    
    // 2. Get the stream using getUserMedia
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        mandatory: {
          chromeMediaSource: 'tab',
          chromeMediaSourceId: streamId,
        },
      },
      video: false 
    });

    currentStream = stream;

    // 3. Audio Context Hack to keep audio playing in the user's speakers
    // When capturing tab audio, Chrome mutes the original tab. We must route it back to destination.
    audioContext = new AudioContext();
    source = audioContext.createMediaStreamSource(stream);
    destination = audioContext.destination;
    source.connect(destination);

    // 4. Initialize MediaRecorder
    recorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });

    recorder.ondataavailable = async (e) => {
      if (e.data.size > 0) {
        const blob = e.data;
        await processAudioChunk(blob, apiKey, sourceLang, targetLang);
      }
    };

    // 5. Start Recording in chunks
    recorder.start(); 
    
    // We use a manual interval to stop/start the recorder to force distinct file chunks
    // or we can rely on `recorder.requestData()` but full restart is sometimes cleaner for headers.
    // For simplicity with Gemini, we'll just use `requestData` logic or restart.
    // Actually, `recorder.start(timeslice)` emits data every X ms.
    recorder.stop(); // Stop the initial start, restart with timeslice
    recorder.start(CHUNK_INTERVAL);

    notifyStatus('Listening...');

  } catch (err) {
    console.error('Capture Error:', err);
    notifyError('Failed to capture audio: ' + err.message);
  }
}

function stopRecording() {
  if (recorder && recorder.state !== 'inactive') {
    recorder.stop();
  }
  if (currentStream) {
    currentStream.getTracks().forEach(track => track.stop());
  }
  if (audioContext) {
    audioContext.close();
  }
  recorder = null;
  currentStream = null;
  notifyStatus('Stopped');
}

// Convert Blob to Base64
function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64String = reader.result.split(',')[1];
      resolve(base64String);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

// Send to Gemini
async function processAudioChunk(blob, apiKey, sourceLang, targetLang) {
  try {
    notifyStatus('Processing chunk...');
    const base64Audio = await blobToBase64(blob);

    // Construct Prompt
    const languageInstruction = sourceLang === 'Auto-detect' 
      ? "Detect the source language automatically." 
      : `The source language is ${sourceLang}.`;
    
    const translationInstruction = targetLang === 'None'
      ? "Transcribe the audio exactly as spoken."
      : `Translate the transcription into ${targetLang}. Return ONLY the translated text.`;

    const promptText = `
      ${languageInstruction}
      ${translationInstruction}
      Do not include timestamps, speaker labels, or descriptions like [music]. 
      Just output the raw text content.
    `.trim();

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL_NAME}:generateContent?key=${apiKey}`;

    const payload = {
      contents: [{
        parts: [
          { text: promptText },
          {
            inline_data: {
              mime_type: "audio/webm",
              data: base64Audio
            }
          }
        ]
      }]
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error?.message || 'API Request Failed');
    }

    const result = await response.json();
    const text = result.candidates?.[0]?.content?.parts?.[0]?.text;

    if (text) {
      sendTranscript(text);
      notifyStatus('Listening...');
    } else {
      console.log('No text generated for this chunk.');
    }

  } catch (err) {
    console.error('Gemini API Error:', err);
    notifyError(`API Error: ${err.message}`);
  }
}

// Helpers to send data back to Content Script (via Active Tab)
async function sendTranscript(text) {
  const [activeTab] = await chrome.tabs.query({ active: true }); // Note: This queries background context, might need routing
  // Better: Broadcast to runtime, let background forward or content listen?
  // Offscreen -> Background -> Content is the standard path.
  // But chrome.runtime.sendMessage from offscreen goes to background.
  
  // We can't query tabs easily in offscreen without permission, but we have it.
  // Let's send to all tabs or just the captured one. We know targetTabId from startRecording.
  // Actually, we can use messaging to send to specific tab.
}

// Re-implementing send logic to be robust
function notifyStatus(status) {
  chrome.runtime.sendMessage({ action: 'STATUS_UPDATE', status });
}

function notifyError(error) {
  chrome.runtime.sendMessage({ action: 'ERROR', error });
}

// Override sendTranscript to route correctly
async function sendTranscript(text) {
   chrome.runtime.sendMessage({ action: 'TRANSCRIPT_RECEIVED', text });
}
