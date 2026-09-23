/**
 * MV3 offscreen document. It owns only MediaStream/MediaRecorder work; all
 * business decisions remain in the service worker and VideoActivation module.
 */

const BACKEND_URL = 'http://localhost:5000';
const CHUNK_MS = 30_000;

type ConsumeRequest = {
  type: 'STUDYLENS_AUDIO_STREAM_CONSUME';
  streamId: string;
  tabId: number;
  youtubeVideoId: string;
  captureAttemptId: string;
};

type BindRequest = {
  type: 'STUDYLENS_AUDIO_CAPTURE_BIND' | 'STUDYLENS_AUDIO_CAPTURE_SWITCH';
  tabId: number;
  captureId: string;
  youtubeVideoId: string;
};

type CaptureState = {
  tabId: number;
  captureId: string | null;
  youtubeVideoId: string;
};

type RuntimeRequest = {
  type?: string;
  streamId?: string;
  tabId?: number;
  captureId?: string;
  youtubeVideoId?: string;
  captureAttemptId?: string;
};

let recorder: MediaRecorder | null = null;
let stream: MediaStream | null = null;
let audioOutput: AudioContext | null = null;
let state: CaptureState | null = null;
let chunkIndex = 0;
let processing = Promise.resolve();

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  const request = message as RuntimeRequest;
  if (request?.type === 'STUDYLENS_AUDIO_CAPTURE_STOP') {
    void stop().then(() => sendResponse({ ok: true }));
    return true;
  }
  if (isConsumeRequest(request)) {
    void consumeLearnerApprovedStream(request).then(
      () => sendResponse({ ok: true }),
      (error: unknown) => sendResponse({ ok: false, code: captureErrorCode(error), message: safeMessage(error) }),
    );
    return true;
  }
  if (isBindRequest(request)) {
    void bindCapture(request).then(
      () => sendResponse({ ok: true }),
      (error: unknown) => sendResponse({ ok: false, code: captureErrorCode(error), message: safeMessage(error) }),
    );
    return true;
  }
});

/** Consume the short-lived stream ID before the worker does Backend I/O. */
async function consumeLearnerApprovedStream(request: ConsumeRequest): Promise<void> {
  await flushCurrentChunk();
  await disposeStream();
  stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      mandatory: {
        chromeMediaSource: 'tab',
        chromeMediaSourceId: request.streamId,
      },
    } as MediaTrackConstraints,
    video: false,
  });
  // tabCapture mutes captured audio unless the stream is routed back.
  audioOutput = new AudioContext();
  audioOutput.createMediaStreamSource(stream).connect(audioOutput.destination);
  // The tab stream itself was created from the learner's toolbar action, but
  // an offscreen document does not always inherit that gesture for autoplay.
  // A failed resume must not discard a valid capture stream or be reported as
  // a tab-capture permission denial. MediaRecorder can still record the stream.
  if (audioOutput.state === 'suspended') {
    void audioOutput.resume().catch(() => undefined);
  }
  state = { tabId: request.tabId, captureId: null, youtubeVideoId: request.youtubeVideoId };
  chunkIndex = 0;
  await publishStatus('pending', 'Đã nhận âm thanh tab. Đang chuẩn bị transcript.', false);
}

/** Bind a persisted Backend capture only after the media stream is alive. */
async function bindCapture(request: BindRequest): Promise<void> {
  if (!stream || !state || state.tabId !== request.tabId) throw new Error('Tab audio stream is unavailable.');
  if (request.type === 'STUDYLENS_AUDIO_CAPTURE_SWITCH') await flushCurrentChunk();
  state = { tabId: request.tabId, captureId: request.captureId, youtubeVideoId: request.youtubeVideoId };
  chunkIndex = 0;
  await startRecorder();
  await publishStatus('pending', 'Đang thu âm thanh của tab YouTube.', false);
}

async function startRecorder(): Promise<void> {
  if (!stream) throw new Error('Tab audio stream is unavailable.');
  recorder = new MediaRecorder(stream, { mimeType: preferredMimeType() });
  recorder.addEventListener('dataavailable', (event) => {
    if (event.data.size > 0) processing = processing.then(() => uploadChunk(event.data));
  });
  recorder.start(CHUNK_MS);
}

async function flushCurrentChunk(): Promise<void> {
  if (!recorder) return;
  const recorderToFlush = recorder;
  if (recorderToFlush.state !== 'inactive') {
    await new Promise<void>((resolve) => {
      recorderToFlush.addEventListener('stop', () => resolve(), { once: true });
      recorderToFlush.stop();
    });
  }
  recorder = null;
  await processing;
}

async function stop(): Promise<void> {
  await flushCurrentChunk();
  await disposeStream();
  state = null;
}

async function disposeStream(): Promise<void> {
  stream?.getTracks().forEach((track) => track.stop());
  stream = null;
  await audioOutput?.close();
  audioOutput = null;
}

async function uploadChunk(audio: Blob): Promise<void> {
  const current = state;
  if (!current?.captureId) return;
  const timing = await chrome.runtime.sendMessage({
    type: 'STUDYLENS_AUDIO_CHUNK_TIMING', tabId: current.tabId, captureId: current.captureId, chunkIndex,
  }) as { ok?: boolean; startMs?: number; endMs?: number };
  const currentIndex = chunkIndex++;
  const startMs = timing?.startMs;
  const endMs = timing?.endMs;
  if (!timing?.ok || typeof startMs !== 'number' || typeof endMs !== 'number' || !Number.isInteger(startMs) || !Number.isInteger(endMs) || endMs <= startMs) return;
  await publishStatus('pending', 'Đang chuyển âm thanh thành transcript.', false);
  const body = new FormData();
  body.set('idempotencyKey', `audio:${current.captureId}:${currentIndex}`);
  body.set('chunkIndex', String(currentIndex));
  body.set('startMs', String(startMs));
  body.set('endMs', String(endMs));
  body.set('mimeType', audio.type || 'audio/webm');
  body.set('audio', audio, `studylens-${currentIndex}.webm`);
  try {
    const response = await fetch(`${BACKEND_URL}/api/video-activation/transcript-captures/${encodeURIComponent(current.captureId)}/audio-chunks`, { method: 'POST', body });
    if (!response.ok) throw await response.json();
    const progress = await response.json();
    if (state?.captureId !== current.captureId) return;
    await chrome.runtime.sendMessage({ type: 'STUDYLENS_AUDIO_TRANSCRIPTION_PROGRESS', tabId: current.tabId, youtubeVideoId: current.youtubeVideoId, progress });
    await publishStatus('succeeded', 'Transcript âm thanh đã được cập nhật.', false);
  } catch {
    await publishStatus('failed', 'Không thể chuyển audio thành transcript. Có thể thử lại ở chunk tiếp theo.', true, 'audioChunkUploadFailed');
  }
}

async function publishStatus(stateValue: 'pending' | 'succeeded' | 'failed', message: string, retryable: boolean, code?: string): Promise<void> {
  if (!state) return;
  await chrome.runtime.sendMessage({
    type: 'STUDYLENS_AUDIO_TRANSCRIPTION_STATUS', tabId: state.tabId, youtubeVideoId: state.youtubeVideoId,
    payload: { operation: 'audioTranscription', state: stateValue, message, retryable, ...(code ? { code } : {}) },
  });
}

function preferredMimeType(): string {
  return MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm';
}

function safeMessage(value: unknown): string {
  return value instanceof Error ? value.message : 'Tab audio capture failed.';
}

function captureErrorCode(value: unknown): 'tabCapturePermissionDenied' | 'tabCaptureUnavailable' {
  const message = safeMessage(value).toLowerCase();
  return message.includes('permission') || message.includes('notallowed') || message.includes('denied')
    ? 'tabCapturePermissionDenied'
    : 'tabCaptureUnavailable';
}

function isConsumeRequest(value: RuntimeRequest): value is ConsumeRequest {
  return value.type === 'STUDYLENS_AUDIO_STREAM_CONSUME' && typeof value.streamId === 'string' &&
    typeof value.tabId === 'number' && typeof value.youtubeVideoId === 'string' && typeof value.captureAttemptId === 'string';
}

function isBindRequest(value: RuntimeRequest): value is BindRequest {
  return (value.type === 'STUDYLENS_AUDIO_CAPTURE_BIND' || value.type === 'STUDYLENS_AUDIO_CAPTURE_SWITCH') &&
    typeof value.tabId === 'number' && typeof value.captureId === 'string' && typeof value.youtubeVideoId === 'string';
}
