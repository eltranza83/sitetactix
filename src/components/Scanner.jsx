import React, { useRef, useState, useEffect } from 'react';
import { Camera, Image as ImageIcon, Sparkles } from 'lucide-react';
import { extractDocumentData } from '../services/gemini';

/**
 * Resizes and compresses an image client-side in a memory-efficient manner.
 */
function compressImage(file, maxWidth = 1200, maxHeight = 1200) {
  return new Promise((resolve) => {
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      // Clean up reference immediately
      URL.revokeObjectURL(objectUrl);
      
      const canvas = document.createElement('canvas');
      let width = img.width;
      let height = img.height;

      if (width > height) {
        if (width > maxWidth) {
          height = Math.round((height * maxWidth) / width);
          width = maxWidth;
        }
      } else {
        if (height > maxHeight) {
          width = Math.round((width * maxHeight) / height);
          height = maxHeight;
        }
      }

      canvas.width = width;
      canvas.height = height;

      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);

      canvas.toBlob((blob) => {
        if (blob) {
          const compressedFile = new File([blob], file.name.replace(/\.[^/.]+$/, "") + "_compressed.jpg", {
            type: 'image/jpeg',
            lastModified: Date.now()
          });
          resolve(compressedFile);
        } else {
          resolve(file);
        }
      }, 'image/jpeg', 0.8);
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(file);
    };
    img.src = objectUrl;
  });
}

/**
 * Performs a perspective projection warp on a source image
 * using 4 arbitrary coordinates and scales to a rectangular destination canvas.
 */
function warpPerspective(srcImgData, srcWidth, srcHeight, corners) {
  const [p0, p1, p2, p3] = corners;
  
  const w1 = Math.hypot(p1.x - p0.x, p1.y - p0.y);
  const w2 = Math.hypot(p2.x - p3.x, p2.y - p3.y);
  const W = Math.round(Math.max(w1, w2));

  const h1 = Math.hypot(p3.x - p0.x, p3.y - p0.y);
  const h2 = Math.hypot(p2.x - p1.x, p2.y - p1.y);
  const H = Math.round(Math.max(h1, h2));

  if (W < 50 || H < 50) return null; // Avoid empty or tiny crops

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  const dstImgData = ctx.createImageData(W, H);

  const x0 = p0.x, y0 = p0.y;
  const x1 = p1.x, y1 = p1.y;
  const x2 = p2.x, y2 = p2.y;
  const x3 = p3.x, y3 = p3.y;

  const dx1 = x1 - x2;
  const dx2 = x3 - x2;
  const sx = x0 - x1 + x2 - x3;

  const dy1 = y1 - y2;
  const dy2 = y3 - y2;
  const sy = y0 - y1 + y2 - y3;

  let a, b, c, d, e, f, g, h;

  if (sx === 0 && sy === 0) {
    // Affine
    a = x1 - x0;
    b = x3 - x0;
    c = x0;
    d = y1 - y0;
    e = y3 - y0;
    f = y0;
    g = 0;
    h = 0;
  } else {
    // Projective
    const det = dx1 * dy2 - dy1 * dx2;
    if (Math.abs(det) < 1e-6) {
      return null;
    }
    g = (sx * dy2 - sy * dx2) / det;
    h = (dx1 * sy - dy1 * sx) / det;
    a = x1 - x0 + g * x1;
    b = x3 - x0 + h * x3;
    c = x0;
    d = y1 - y0 + g * y1;
    e = y3 - y0 + h * y3;
    f = y0;
  }

  const srcData = srcImgData.data;
  const dstData = dstImgData.data;

  for (let r = 0; r < H; r++) {
    const v = r / H;
    const offsetDstRow = r * W * 4;
    for (let c_idx = 0; c_idx < W; c_idx++) {
      const u = c_idx / W;
      const den = g * u + h * v + 1;
      
      const x = Math.round((a * u + b * v + c) / den);
      const y = Math.round((d * u + e * v + f) / den);

      const clampedX = Math.max(0, Math.min(srcWidth - 1, x));
      const clampedY = Math.max(0, Math.min(srcHeight - 1, y));

      const srcIdx = (clampedY * srcWidth + clampedX) * 4;
      const dstIdx = offsetDstRow + c_idx * 4;

      dstData[dstIdx] = srcData[srcIdx];         // R
      dstData[dstIdx + 1] = srcData[srcIdx + 1]; // G
      dstData[dstIdx + 2] = srcData[srcIdx + 2]; // B
      dstData[dstIdx + 3] = srcData[srcIdx + 3]; // A
    }
  }

  // Apply a simple high-contrast filter to clarify document scans
  const factor = 1.15; // 15% increase in contrast
  for (let i = 0; i < dstData.length; i += 4) {
    dstData[i]     = Math.max(0, Math.min(255, (dstData[i] - 128) * factor + 128));     // R
    dstData[i + 1] = Math.max(0, Math.min(255, (dstData[i + 1] - 128) * factor + 128)); // G
    dstData[i + 2] = Math.max(0, Math.min(255, (dstData[i + 2] - 128) * factor + 128)); // B
  }

  ctx.putImageData(dstImgData, 0, 0);
  return canvas;
}

export default function Scanner({ onDataExtracted, onError }) {
  const [loading, setLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');

  // WebRTC inline camera states
  const [showCamera, setShowCamera] = useState(false);
  const [cameraStream, setCameraStream] = useState(null);
  const videoRef = useRef(null);

  // Crop & Perspective Correction states
  const [croppingImageSrc, setCroppingImageSrc] = useState(null);
  const [originalFile, setOriginalFile] = useState(null);
  const [corners, setCorners] = useState([
    { x: 0.1, y: 0.1 }, // top-left
    { x: 0.9, y: 0.1 }, // top-right
    { x: 0.9, y: 0.9 }, // bottom-right
    { x: 0.1, y: 0.9 }  // bottom-left
  ]);
  const [activeHandle, setActiveHandle] = useState(null);
  const containerRef = useRef(null);

  // Drag handlers
  const startDrag = (idx, e) => {
    e.preventDefault();
    setActiveHandle(idx);
  };

  const handleMove = (clientX, clientY) => {
    if (activeHandle === null || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    
    let x = (clientX - rect.left) / rect.width;
    let y = (clientY - rect.top) / rect.height;
    
    x = Math.max(0, Math.min(1, x));
    y = Math.max(0, Math.min(1, y));

    setCorners(prev => {
      const next = [...prev];
      next[activeHandle] = { x, y };
      return next;
    });
  };

  const handleMouseMove = (e) => {
    if (activeHandle === null) return;
    handleMove(e.clientX, e.clientY);
  };

  const handleTouchMove = (e) => {
    if (activeHandle === null || e.touches.length === 0) return;
    handleMove(e.touches[0].clientX, e.touches[0].clientY);
  };

  const handleMouseUp = () => {
    setActiveHandle(null);
  };

  const handleTouchEnd = () => {
    setActiveHandle(null);
  };

  const handleRotateImage = () => {
    if (!croppingImageSrc) return;
    
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.height;
      canvas.height = img.width;
      
      const ctx = canvas.getContext('2d');
      ctx.translate(canvas.width / 2, canvas.height / 2);
      ctx.rotate(Math.PI / 2);
      ctx.drawImage(img, -img.width / 2, -img.height / 2);
      
      canvas.toBlob((blob) => {
        if (blob) {
          const rotatedFile = new File([blob], `rotated_${Date.now()}.jpg`, { type: 'image/jpeg' });
          setOriginalFile(rotatedFile);
          
          const newUrl = URL.createObjectURL(rotatedFile);
          if (croppingImageSrc.startsWith('blob:')) {
            URL.revokeObjectURL(croppingImageSrc);
          }
          setCroppingImageSrc(newUrl);
          
          // Reset handles
          setCorners([
            { x: 0.1, y: 0.1 },
            { x: 0.9, y: 0.1 },
            { x: 0.9, y: 0.9 },
            { x: 0.1, y: 0.9 }
          ]);
        }
      }, 'image/jpeg', 0.85);
    };
    img.src = croppingImageSrc;
  };

  const handleCropAndScan = () => {
    if (!originalFile || !croppingImageSrc) return;
    
    setLoading(true);
    setStatusMessage('Warping perspective...');
    
    const img = new Image();
    img.onload = () => {
      const srcCanvas = document.createElement('canvas');
      srcCanvas.width = img.width;
      srcCanvas.height = img.height;
      const srcCtx = srcCanvas.getContext('2d');
      srcCtx.drawImage(img, 0, 0);
      const srcImgData = srcCtx.getImageData(0, 0, img.width, img.height);
      
      const rawCorners = corners.map(c => ({
        x: c.x * img.width,
        y: c.y * img.height
      }));
      
      const warpedCanvas = warpPerspective(srcImgData, img.width, img.height, rawCorners);
      
      if (!warpedCanvas) {
        setLoading(false);
        const cropErr = 'Failed to crop the document. Try adjusting the corners.';
        if (onError) onError(cropErr);
        return;
      }
      
      if (croppingImageSrc.startsWith('blob:')) {
        URL.revokeObjectURL(croppingImageSrc);
      }
      setCroppingImageSrc(null);
      setOriginalFile(null);
      
      setStatusMessage('Analyzing document with Gemini AI...');
      
      warpedCanvas.toBlob(async (blob) => {
        if (blob) {
          const croppedFile = new File([blob], `cropped_${Date.now()}.jpg`, { type: 'image/jpeg' });
          await analyzeCroppedFile(croppedFile);
        } else {
          setLoading(false);
          const captureErr = 'Failed to capture cropped canvas.';
          if (onError) onError(captureErr);
        }
      }, 'image/jpeg', 0.85);
    };
    img.src = croppingImageSrc;
  };

  const analyzeCroppedFile = async (file) => {
    try {
      const extractedData = await extractDocumentData(file);
      onDataExtracted({
        metadata: extractedData,
        mainImage: file,
      });
    } catch (err) {
      console.error('Scan process failed:', err);
      const errMsg = err.message || 'AI parsing failed. Please check your API key or connection.';
      if (onError) onError(errMsg);
    } finally {
      setLoading(false);
      setStatusMessage('');
    }
  };

  // Cleanup camera stream and blob URLs on unmount
  useEffect(() => {
    return () => {
      if (cameraStream) {
        cameraStream.getTracks().forEach(track => track.stop());
      }
    };
  }, [cameraStream]);

  useEffect(() => {
    return () => {
      if (croppingImageSrc && croppingImageSrc.startsWith('blob:')) {
        URL.revokeObjectURL(croppingImageSrc);
      }
    };
  }, [croppingImageSrc]);

  const startCamera = async () => {
    if (onError) onError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1920 },
          height: { ideal: 1080 }
        },
        audio: false
      });
      setCameraStream(stream);
      setShowCamera(true);
      
      // Delay slightly to ensure video element is rendered
      setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
      }, 100);
    } catch (err) {
      console.error('Failed to access camera:', err);
      if (onError) onError('Could not access camera. Verify browser permissions.');
    }
  };

  const stopCamera = () => {
    if (cameraStream) {
      cameraStream.getTracks().forEach(track => track.stop());
      setCameraStream(null);
    }
    setShowCamera(false);
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
          await processFile(file);
        } else {
          const frameErr = 'Failed to capture canvas frame.';
          if (onError) onError(frameErr);
        }
      }, 'image/jpeg', 0.85);
      
    } catch (err) {
      console.error('Capture failed:', err);
      const capErr = `Capture failed: ${err.message}`;
      if (onError) onError(capErr);
    }
  };

  const handleFileChange = async (e) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const file = files[0];
    await processFile(file);
    
    // Clear value so same file can be re-captured/selected again
    e.target.value = '';
  };

  const processFile = async (file) => {
    setLoading(true);
    if (onError) onError(null);

    // If PDF, bypass compression and crop editor
    if (file.type === 'application/pdf') {
      setStatusMessage('Analyzing PDF document with Gemini AI...');
      try {
        if (file.size === 0) {
          throw new Error('Selected PDF is empty.');
        }
        await analyzeCroppedFile(file);
      } catch (err) {
        console.error('PDF preparation failed:', err);
        const prepErr = err.message || 'Failed to load PDF.';
        if (onError) onError(prepErr);
      } finally {
        setLoading(false);
        setStatusMessage('');
      }
      return;
    }

    setStatusMessage('Preparing photo...');

    try {
      if (file.size === 0) {
        throw new Error('Captured image is empty. Please try choosing a photo from your gallery instead.');
      }

      // Compress client-side first
      const compressedFile = await compressImage(file);
      
      // Load image into crop editor
      const url = URL.createObjectURL(compressedFile);
      setOriginalFile(compressedFile);
      setCroppingImageSrc(url);
      
      // Reset handles
      setCorners([
        { x: 0.1, y: 0.1 },
        { x: 0.9, y: 0.1 },
        { x: 0.9, y: 0.9 },
        { x: 0.1, y: 0.9 }
      ]);
    } catch (err) {
      console.error('File preparation failed:', err);
      const prepErr = err.message || 'Failed to load file.';
      if (onError) onError(prepErr);
    } finally {
      setLoading(false);
      setStatusMessage('');
    }
  };

  if (croppingImageSrc) {
    const c0 = corners[0];
    const c1 = corners[1];
    const c2 = corners[2];
    const c3 = corners[3];

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ fontSize: '1.2rem', fontWeight: 700, fontFamily: 'var(--font-serif)' }}>Adjust Corners & Crop</h2>
          <button 
            type="button" 
            onClick={() => {
              if (croppingImageSrc.startsWith('blob:')) {
                URL.revokeObjectURL(croppingImageSrc);
              }
              setCroppingImageSrc(null);
              setOriginalFile(null);
            }} 
            className="btn btn-secondary" 
            style={{ width: 'auto', padding: '6px 12px', fontSize: '0.8rem' }}
          >
            Cancel
          </button>
        </div>

        <p style={{ fontSize: '0.8rem', color: 'var(--color-zinc-400)', margin: 0, lineHeight: 1.4 }}>
          Drag the gold corners to match the boundaries of the receipt or invoice. Use "Rotate 90°" if needed.
        </p>

        <div style={{ display: 'flex', justifyContent: 'center', backgroundColor: '#000', borderRadius: '12px', overflow: 'hidden', padding: '10px' }}>
          <div 
            ref={containerRef}
            style={{ 
              position: 'relative', 
              display: 'inline-block', 
              userSelect: 'none', 
              touchAction: 'none',
              maxWidth: '100%'
            }}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
          >
            <img 
              src={croppingImageSrc} 
              alt="Crop area" 
              style={{ display: 'block', maxWidth: '100%', maxHeight: '400px', objectFit: 'contain', pointerEvents: 'none' }} 
            />

            <svg 
              viewBox="0 0 100 100" 
              preserveAspectRatio="none"
              style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 10 }}
            >
              <path 
                d={`M 0 0 H 100 V 100 H 0 Z M ${c0.x*100} ${c0.y*100} L ${c1.x*100} ${c1.y*100} L ${c2.x*100} ${c2.y*100} L ${c3.x*100} ${c3.y*100} Z`} 
                fill="rgba(0, 0, 0, 0.6)" 
                fillRule="evenodd" 
              />
              <line x1={c0.x*100} y1={c0.y*100} x2={c1.x*100} y2={c1.y*100} stroke="#F1D7A7" strokeWidth="0.8" />
              <line x1={c1.x*100} y1={c1.y*100} x2={c2.x*100} y2={c2.y*100} stroke="#F1D7A7" strokeWidth="0.8" />
              <line x1={c2.x*100} y1={c2.y*100} x2={c3.x*100} y2={c3.y*100} stroke="#F1D7A7" strokeWidth="0.8" />
              <line x1={c3.x*100} y1={c3.y*100} x2={c0.x*100} y2={c0.y*100} stroke="#F1D7A7" strokeWidth="0.8" />
            </svg>

            {corners.map((c, idx) => (
              <div
                key={idx}
                style={{
                  position: 'absolute',
                  left: `${c.x * 100}%`,
                  top: `${c.y * 100}%`,
                  width: '28px',
                  height: '28px',
                  marginLeft: '-14px',
                  marginTop: '-14px',
                  backgroundColor: '#F1D7A7',
                  border: '2px solid #fff',
                  borderRadius: '50%',
                  cursor: 'grab',
                  zIndex: 20,
                  touchAction: 'none',
                  boxShadow: '0 2px 6px rgba(0,0,0,0.5)'
                }}
                onMouseDown={(e) => startDrag(idx, e)}
                onTouchStart={(e) => startDrag(idx, e)}
              />
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', gap: '10px' }}>
          <button 
            type="button" 
            onClick={handleRotateImage} 
            className="btn btn-secondary" 
            style={{ flex: 1, padding: '12px' }}
          >
            Rotate 90°
          </button>
          <button 
            type="button" 
            onClick={handleCropAndScan} 
            className="btn btn-primary" 
            style={{ flex: 1.5, padding: '12px' }}
          >
            Crop & Scan
          </button>
        </div>
      </div>
    );
  }

  if (showCamera) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ fontSize: '1.2rem', fontWeight: 700 }}>Inline Camera</h2>
          <button 
            type="button" 
            onClick={stopCamera} 
            className="btn btn-secondary" 
            style={{ width: 'auto', padding: '6px 12px', fontSize: '0.8rem' }}
          >
            Cancel
          </button>
        </div>

        <div className="camera-container">
          <video 
            ref={videoRef} 
            className="camera-video" 
            autoPlay 
            playsInline
            muted
          />
          <div className="camera-overlay">
            <div className="camera-target-box"></div>
          </div>
        </div>

        <div className="camera-controls">
          <button 
            type="button" 
            onClick={capturePhoto} 
            className="shutter-btn"
            title="Capture photo"
          />
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <h2 style={{ fontSize: '1.5rem', fontWeight: 700 }}>Scan Invoice or Check</h2>

      {/* Errors are handled globally and displayed in App.jsx toast */}

      {loading ? (
        <div className="settings-card" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '40px 20px', gap: '16px' }}>
          <div className="spinner"></div>
          <div style={{ fontWeight: 600, color: 'var(--color-zinc-100)', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Sparkles size={18} className="logo-icon" style={{ animation: 'pulse 1.5s infinite ease-in-out' }} style={{ color: 'var(--color-amber-500)' }} />
            {statusMessage}
          </div>
          <p style={{ fontSize: '0.8rem', color: 'var(--color-zinc-500)', textAlign: 'center', maxWidth: '280px' }}>
            Processing image and running OCR layout analysis.
          </p>
        </div>
      ) : (
        <div 
          className="scan-area" 
          style={{ height: '320px', cursor: 'default', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: '24px' }}
          onClick={(e) => e.stopPropagation()} // prevent clicking background
        >
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px' }}>
            <div className="scan-title">Capture Invoice or Check</div>
            <div className="scan-subtitle">Choose how to scan your document:</div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', width: '100%', maxWidth: '280px', margin: '0 auto' }}>
            {/* Take Photo Button - triggers WebRTC camera */}
            <button 
              type="button" 
              onClick={startCamera}
              className="btn btn-primary"
              style={{ padding: '14px', width: '100%' }}
            >
              <Camera size={18} />
              Take Photo (Use Camera)
            </button>

            {/* Choose from Gallery Overlay Button */}
            <div style={{ position: 'relative', width: '100%' }}>
              <button 
                type="button" 
                className="btn btn-secondary"
                style={{ padding: '14px', width: '100%' }}
              >
                <ImageIcon size={18} />
                Choose from Gallery / Photos
              </button>
              <input 
                type="file" 
                onChange={handleFileChange}
                accept="image/*,application/pdf"
                style={{ 
                  position: 'absolute', 
                  top: 0, 
                  left: 0, 
                  width: '100%', 
                  height: '100%', 
                  opacity: 0, 
                  cursor: 'pointer',
                  zIndex: 10
                }}
              />
            </div>
          </div>

          <div style={{ display: 'flex', alignSelf: 'center', alignItems: 'center', gap: '6px', fontSize: '0.75rem', color: 'var(--color-zinc-400)', backgroundColor: 'var(--color-zinc-900)', padding: '6px 12px', borderRadius: '20px', border: '1px solid var(--color-zinc-800)' }}>
            <Sparkles size={12} style={{ color: 'var(--color-amber-500)' }} />
            Gemini AI Auto-OCR Processing Active
          </div>
        </div>
      )}
    </div>
  );
}
