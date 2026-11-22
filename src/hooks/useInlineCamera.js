import { useEffect, useRef, useState } from 'react';

/**
 * Shared inline WebRTC camera with hardware zoom (when supported by the phone's rear camera)
 * and JPEG frame capture. Used by both the main Scanner and the Edit screen's receipt attachment camera.
 */
export function useInlineCamera({
  onPhotoCaptured,
  onError,
  accessErrorMessage = 'Could not access camera. Verify browser permissions.'
} = {}) {
  const [showCamera, setShowCamera] = useState(false);
  const [cameraStream, setCameraStream] = useState(null);
  const [cameraError, setCameraError] = useState(null);
  const [zoomInfo, setZoomInfo] = useState(null);
  const [zoomValue, setZoomValue] = useState(1);
  const videoRef = useRef(null);

  const reportError = (msg) => {
    setCameraError(msg);
    if (onError) onError(msg);
  };

  useEffect(() => {
    return () => {
      if (cameraStream) {
        cameraStream.getTracks().forEach(track => track.stop());
      }
    };
  }, [cameraStream]);

  const stopCamera = () => {
    if (cameraStream) {
      cameraStream.getTracks().forEach(track => track.stop());
      setCameraStream(null);
    }
    setZoomInfo(null);
    setShowCamera(false);
  };

  const handleZoomChange = (e) => {
    const value = Number(e.target.value);
    setZoomValue(value);
    const track = cameraStream && cameraStream.getVideoTracks()[0];
    if (track) {
      track.applyConstraints({ advanced: [{ zoom: value }] }).catch(() => {});
    }
  };

  const startCamera = async () => {
    reportError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 3840 },
          height: { ideal: 2160 }
        },
        audio: false
      });
      // Zoom is only offered when the phone's camera supports it
      const track = stream.getVideoTracks()[0];
      const caps = track && track.getCapabilities ? track.getCapabilities() : null;
      if (caps && caps.zoom && caps.zoom.max > caps.zoom.min) {
        setZoomInfo({ min: caps.zoom.min, max: caps.zoom.max, step: caps.zoom.step || 0.1 });
        setZoomValue(caps.zoom.min);
      } else {
        setZoomInfo(null);
      }
      setCameraStream(stream);
      setShowCamera(true);

      setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
      }, 100);
    } catch (err) {
      console.error('Failed to access camera:', err);
      reportError(accessErrorMessage);
    }
  };

  const capturePhoto = () => {
    if (!videoRef.current) return;

    try {
      const video = videoRef.current;
      const canvas = document.createElement('canvas');

      canvas.width = video.videoWidth || 1280;
      canvas.height = video.videoHeight || 720;

      const ctx = canvas.getContext('2d');
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      canvas.toBlob(async (blob) => {
        if (blob) {
          const file = new File([blob], `capture_${Date.now()}.jpg`, { type: 'image/jpeg' });
          stopCamera();
          await onPhotoCaptured?.(file);
        } else {
          reportError('Failed to capture canvas frame.');
        }
      }, 'image/jpeg', 0.85);
    } catch (err) {
      console.error('Capture failed:', err);
      reportError(`Capture failed: ${err.message}`);
    }
  };

  return {
    showCamera,
    cameraError,
    videoRef,
    zoomInfo,
    zoomValue,
    startCamera,
    stopCamera,
    handleZoomChange,
    capturePhoto
  };
}
