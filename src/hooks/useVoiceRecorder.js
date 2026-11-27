import { useEffect, useRef, useState } from 'react';

const MAX_RECORDING_SECONDS = 60;
const PREFERRED_AUDIO_MIMES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4',
  'audio/ogg;codecs=opus',
  'audio/ogg'
];

function pickSupportedAudioMime() {
  if (typeof window === 'undefined' || typeof window.MediaRecorder === 'undefined') {
    return '';
  }
  if (typeof window.MediaRecorder.isTypeSupported !== 'function') {
    return '';
  }
  return PREFERRED_AUDIO_MIMES.find(type => window.MediaRecorder.isTypeSupported(type)) || '';
}

function friendlyMicError(err) {
  const name = err?.name || '';
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
    return 'Microphone permission denied. Allow mic access in your browser settings and try again.';
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
    return 'No microphone found on this device.';
  }
  if (name === 'NotReadableError') {
    return 'Your microphone is busy in another app. Close it and try again.';
  }
  return err?.message || 'Could not start voice recording.';
}

/**
 * Tap-to-start, tap-to-stop voice recorder compatible with iOS Safari/PWA and Android Chrome.
 * Calls `onAudioReady(blob)` when stopped normally; cancels cleanly without sending on cancel/unmount.
 */
export function useVoiceRecorder({ onAudioReady, onError, maxSeconds = MAX_RECORDING_SECONDS } = {}) {
  const [isRecording, setIsRecording] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  const recorderRef = useRef(null);
  const streamRef = useRef(null);
  const chunksRef = useRef([]);
  const timerRef = useRef(null);
  const cancelledRef = useRef(false);
  const onAudioReadyRef = useRef(onAudioReady);
  const onErrorRef = useRef(onError);

  onAudioReadyRef.current = onAudioReady;
  onErrorRef.current = onError;

  const isSupported = typeof navigator !== 'undefined'
    && Boolean(navigator.mediaDevices?.getUserMedia)
    && typeof window !== 'undefined'
    && typeof window.MediaRecorder !== 'undefined';

  const cleanupMedia = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => {
        try {
          track.stop();
        } catch {
          // Ignore track stop errors
        }
      });
      streamRef.current = null;
    }
    recorderRef.current = null;
    setIsRecording(false);
    setElapsedSeconds(0);
  };

  useEffect(() => {
    return () => {
      cancelledRef.current = true;
      if (recorderRef.current && recorderRef.current.state !== 'inactive') {
        try {
          recorderRef.current.stop();
        } catch {
          // Ignore stop errors during unmount
        }
      }
      cleanupMedia();
    };
  }, []);

  const startRecording = async () => {
    if (!isSupported) {
      onErrorRef.current?.('Voice recording is not supported in this browser.');
      return;
    }
    if (isRecording) return;

    onErrorRef.current?.(null);
    cancelledRef.current = false;
    chunksRef.current = [];

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });
      streamRef.current = stream;

      const mimeType = pickSupportedAudioMime();
      const options = { audioBitsPerSecond: 32000 };
      if (mimeType) options.mimeType = mimeType;

      const recorder = new window.MediaRecorder(stream, options);
      recorderRef.current = recorder;

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      recorder.onerror = () => {
        cleanupMedia();
        onErrorRef.current?.('Voice recording stopped unexpectedly. Please try again.');
      };

      recorder.onstop = () => {
        const wasCancelled = cancelledRef.current;
        const recordedType = recorder.mimeType || mimeType || 'audio/mp4';
        const parts = chunksRef.current;
        chunksRef.current = [];
        cleanupMedia();

        if (wasCancelled) return;
        const blob = new Blob(parts, { type: recordedType });
        if (blob.size < 400) {
          onErrorRef.current?.('Recording was too short. Tap the mic, speak clearly, then tap Stop.');
          return;
        }
        onAudioReadyRef.current?.(blob);
      };

      recorder.start(250);
      setIsRecording(true);
      setElapsedSeconds(0);

      const startedAt = Date.now();
      timerRef.current = setInterval(() => {
        const secs = Math.floor((Date.now() - startedAt) / 1000);
        setElapsedSeconds(secs);
        if (secs >= maxSeconds && recorderRef.current && recorderRef.current.state === 'recording') {
          recorderRef.current.stop();
        }
      }, 250);
    } catch (err) {
      cleanupMedia();
      onErrorRef.current?.(friendlyMicError(err));
    }
  };

  const stopRecording = () => {
    if (!recorderRef.current || recorderRef.current.state === 'inactive') {
      cleanupMedia();
      return;
    }
    cancelledRef.current = false;
    try {
      recorderRef.current.stop();
    } catch {
      cleanupMedia();
    }
  };

  const cancelRecording = () => {
    cancelledRef.current = true;
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      try {
        recorderRef.current.stop();
      } catch {
        // Ignore
      }
    }
    chunksRef.current = [];
    cleanupMedia();
  };

  const toggleRecording = () => {
    if (isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  };

  return {
    isSupported,
    isRecording,
    elapsedSeconds,
    startRecording,
    stopRecording,
    cancelRecording,
    toggleRecording
  };
}
