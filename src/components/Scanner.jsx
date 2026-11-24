import React, { useRef, useState, useEffect } from 'react';
import { Camera, Image as ImageIcon, Sparkles } from 'lucide-react';
import EditFormCamera from './EditFormCamera';
import { useInlineCamera } from '../hooks/useInlineCamera';
import { extractDocumentData } from '../services/gemini';
import { detectDocumentCorners, rotationForTextDirection } from '../services/documentCorners';
import { compressImage } from '../services/imageFiles';

const MAX_UPLOAD_BYTES = 3.5 * 1024 * 1024; // the scan upload limit is 4 MB

/** Returns the canvas turned clockwise by 0, 90, 180 or 270 degrees. */
function rotateCanvas(canvas, degrees) {
  if (!degrees) return canvas;
  const turned = document.createElement('canvas');
  const sideways = degrees === 90 || degrees === 270;
  turned.width = sideways ? canvas.height : canvas.width;
  turned.height = sideways ? canvas.width : canvas.height;
  const ctx = turned.getContext('2d');
  ctx.translate(turned.width / 2, turned.height / 2);
  ctx.rotate((degrees * Math.PI) / 180);
  ctx.drawImage(canvas, -canvas.width / 2, -canvas.height / 2);
  return turned;
}

function canvasToBlob(canvas, quality) {
  return new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', quality));
}

/**
 * Saves a canvas as JPEG, shrinking it a little at a time until it fits the upload limit.
 */
async function canvasToJpegUnderLimit(canvas) {
  let current = canvas;
  for (let attempt = 0; attempt < 5; attempt++) {
    const blob = await canvasToBlob(current, 0.85);
    if (!blob || blob.size <= MAX_UPLOAD_BYTES) return blob;
    const smaller = document.createElement('canvas');
    smaller.width = Math.round(current.width * 0.8);
    smaller.height = Math.round(current.height * 0.8);
    smaller.getContext('2d').drawImage(current, 0, 0, smaller.width, smaller.height);
    current = smaller;
  }
  return canvasToBlob(current, 0.7);
}

/**
 * Performs a perspective projection warp on a source image
 * using 4 arbitrary coordinates and scales to a rectangular destination canvas.
 */
async function warpPerspective(srcImgData, srcWidth, srcHeight, corners) {
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
  const maxSrcX = srcWidth - 1;
  const maxSrcY = srcHeight - 1;

  for (let r = 0; r < H; r++) {
    if (r > 0 && (r & 255) === 0) {
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    const v = r / H;
    const offsetDstRow = r * W * 4;
    for (let c_idx = 0; c_idx < W; c_idx++) {
      const u = c_idx / W;
      const den = g * u + h * v + 1;

      const fx = Math.max(0, Math.min(maxSrcX, (a * u + b * v + c) / den));
      const fy = Math.max(0, Math.min(maxSrcY, (d * u + e * v + f) / den));

      const ix0 = Math.floor(fx);
      const iy0 = Math.floor(fy);
      const ix1 = Math.min(maxSrcX, ix0 + 1);
      const iy1 = Math.min(maxSrcY, iy0 + 1);
      const wx = fx - ix0;
      const wy = fy - iy0;
      const w00 = (1 - wx) * (1 - wy);
      const w10 = wx * (1 - wy);
      const w01 = (1 - wx) * wy;
      const w11 = wx * wy;

      const i00 = (iy0 * srcWidth + ix0) * 4;
      const i10 = (iy0 * srcWidth + ix1) * 4;
      const i01 = (iy1 * srcWidth + ix0) * 4;
      const i11 = (iy1 * srcWidth + ix1) * 4;
      const dstIdx = offsetDstRow + c_idx * 4;

      dstData[dstIdx]     = srcData[i00]     * w00 + srcData[i10]     * w10 + srcData[i01]     * w01 + srcData[i11]     * w11; // R
      dstData[dstIdx + 1] = srcData[i00 + 1] * w00 + srcData[i10 + 1] * w10 + srcData[i01 + 1] * w01 + srcData[i11 + 1] * w11; // G
      dstData[dstIdx + 2] = srcData[i00 + 2] * w00 + srcData[i10 + 2] * w10 + srcData[i01 + 2] * w01 + srcData[i11 + 2] * w11; // B
      dstData[dstIdx + 3] = srcData[i00 + 3] * w00 + srcData[i10 + 3] * w10 + srcData[i01 + 3] * w01 + srcData[i11 + 3] * w11; // A
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
  const [textDirection, setTextDirection] = useState('upright');

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

  const handleTouchMove = (e) => {
    if (activeHandle === null || e.touches.length === 0) return;
    handleMove(e.touches[0].clientX, e.touches[0].clientY);
  };

  const handleTouchEnd = () => {
    setActiveHandle(null);
  };

  // A corner dragged with the mouse keeps following it past the photo's edge until the button is let go
  useEffect(() => {
    if (activeHandle === null) return;
    const onMove = (e) => handleMove(e.clientX, e.clientY);
    const onUp = () => setActiveHandle(null);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    // Attached once per drag (handleMove reads the corner being dragged from this render)
  }, [activeHandle]);

  // A photo that will not open must not leave the spinner running
  const failImageLoad = () => {
    setLoading(false);
    setStatusMessage('');
    if (onError) onError('Could not open this photo. Please try another one.');
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
          setTextDirection('upright');
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
    img.onerror = failImageLoad;
    img.src = croppingImageSrc;
  };

  const handleScanAsIs = () => {
    if (!originalFile || !croppingImageSrc) return;

    setLoading(true);
    setStatusMessage('Analyzing document with Gemini AI...');

    const img = new Image();
    img.onload = async () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      canvas.getContext('2d').drawImage(img, 0, 0);

      if (croppingImageSrc.startsWith('blob:')) {
        URL.revokeObjectURL(croppingImageSrc);
      }
      setCroppingImageSrc(null);
      setOriginalFile(null);

      const blob = await canvasToJpegUnderLimit(rotateCanvas(canvas, rotationForTextDirection(textDirection)));
      if (blob) {
        await analyzeCroppedFile(new File([blob], `photo_${Date.now()}.jpg`, { type: 'image/jpeg' }));
      } else {
        setLoading(false);
        if (onError) onError('Failed to prepare the photo.');
      }
    };
    img.onerror = failImageLoad;
    img.src = croppingImageSrc;
  };

  const handleCropAndScan = () => {
    if (!originalFile || !croppingImageSrc) return;
    
    setLoading(true);
    setStatusMessage('Warping perspective...');
    
    const img = new Image();
    img.onload = async () => {
      try {
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

        const warpedCanvas = await warpPerspective(srcImgData, img.width, img.height, rawCorners);

        if (!warpedCanvas) {
          setLoading(false);
          setStatusMessage('');
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

        const blob = await canvasToJpegUnderLimit(rotateCanvas(warpedCanvas, rotationForTextDirection(textDirection)));
        if (blob) {
          const croppedFile = new File([blob], `cropped_${Date.now()}.jpg`, { type: 'image/jpeg' });
          await analyzeCroppedFile(croppedFile);
        } else {
          setLoading(false);
          setStatusMessage('');
          const captureErr = 'Failed to capture cropped canvas.';
          if (onError) onError(captureErr);
        }
      } catch (err) {
        // Without this the "Analyzing document" spinner would never stop
        console.error('Could not prepare the cropped photo:', err);
        setLoading(false);
        setStatusMessage('');
        if (onError) onError('Could not prepare the cropped photo. Please try again.');
      }
    };
    img.onerror = failImageLoad;
    img.src = croppingImageSrc;
  };

  const analyzeCroppedFile = async (file) => {
    try {
      const { data: extractedData, readByBackupAi } = await extractDocumentData(file);
      onDataExtracted({
        metadata: extractedData,
        mainImage: file,
        readByBackupAi
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

  // Cleanup blob URLs on unmount
  useEffect(() => {
    return () => {
      if (croppingImageSrc && croppingImageSrc.startsWith('blob:')) {
        URL.revokeObjectURL(croppingImageSrc);
      }
    };
  }, [croppingImageSrc]);

  const {
    showCamera,
    videoRef,
    zoomInfo,
    zoomValue,
    startCamera,
    stopCamera,
    handleZoomChange,
    capturePhoto
  } = useInlineCamera({
    onPhotoCaptured: (file) => processFile(file),
    onError
  });

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
      const compressedFile = await compressImage(file, 3000, 3000, 0.85);

      // Find the paper's edges so the crop starts on the document (falls back to the default box)
      setStatusMessage('Finding the document edges...');
      const detected = await detectDocumentCorners(await compressImage(file, 1000, 1000, 0.85));
      setTextDirection(detected?.textDirection || 'upright');
      
      // Load image into crop editor
      const url = URL.createObjectURL(compressedFile);
      setOriginalFile(compressedFile);
      setCroppingImageSrc(url);
      
      // Reset handles
      setCorners(detected?.corners || [
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
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', paddingBottom: '96px' }}>
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
          The gold corners start on the document's edges. Drag them if they are off, or use "Rotate 90°" if needed.
        </p>
        {textDirection !== 'upright' && (
          <p style={{ fontSize: '0.78rem', color: 'var(--color-amber-400)', margin: 0, lineHeight: 1.4 }}>
            This photo is turned sideways. It will be turned upright after the crop.
          </p>
        )}

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
        <button
          type="button"
          onClick={handleScanAsIs}
          className="btn btn-secondary"
          style={{ width: '100%', padding: '10px', fontSize: '0.8rem' }}
        >
          Scan as is (no crop)
        </button>
      </div>
    );
  }

  if (showCamera) {
    return (
      <EditFormCamera
        className=""
        videoRef={videoRef}
        onCapturePhoto={capturePhoto}
        onStopCamera={stopCamera}
        zoomInfo={zoomInfo}
        zoomValue={zoomValue}
        onZoomChange={handleZoomChange}
      />
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
            <Sparkles size={18} className="logo-icon" style={{ animation: 'pulse 1.5s infinite ease-in-out', color: 'var(--color-amber-500)' }} />
            {statusMessage}
          </div>
          <p style={{ fontSize: '0.8rem', color: 'var(--color-zinc-500)', textAlign: 'center', maxWidth: '280px' }}>
            Processing image and running OCR layout analysis.
          </p>
        </div>
      ) : (
        <div 
          className="scan-area" 
          style={{ padding: '28px 20px', cursor: 'default', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: '24px' }}
          onClick={(e) => e.stopPropagation()} // prevent clicking background
        >
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

            {/* Choose Photo or File (photos and PDFs) */}
            <div style={{ position: 'relative', width: '100%' }}>
              <button 
                type="button" 
                className="btn btn-secondary"
                style={{ padding: '14px', width: '100%' }}
              >
                <ImageIcon size={18} />
                Choose Photo or File
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
        </div>
      )}
    </div>
  );
}
