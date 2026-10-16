import React, { useEffect, useRef, useState } from 'react';
import { Image } from 'lucide-react';
import { useAuthenticatedDriveImage } from '../hooks/useAuthenticatedDriveImage';
import { isGoogleThumbnail } from '../services/imageFiles';

/**
 * One Drive photo. For small tiles it shows Google's ~15 KB thumbnail first; if that will not load
 * (or a full-size view is wanted) it downloads the photo with the user's Google sign-in, only once
 * it is on screen. Shows a placeholder while loading and never points at a drive.google.com address.
 */
export default function DrivePhoto({
  googleToken,
  fileId,
  url = '',
  thumbnailLink = '',
  alt = '',
  full = false,
  style = {},
  placeholderSize = 18
}) {
  const [thumbnailFailed, setThumbnailFailed] = useState(false);
  const [visible, setVisible] = useState(full);
  const boxRef = useRef(null);
  const useThumbnail = !full && !thumbnailFailed && isGoogleThumbnail(thumbnailLink);

  // Download only photos that are on screen (a long album does not download everything at once)
  useEffect(() => {
    if (visible || useThumbnail) return;
    const box = boxRef.current;
    if (!box || typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some(entry => entry.isIntersecting)) {
        setVisible(true);
        observer.disconnect();
      }
    }, { rootMargin: '200px' });
    observer.observe(box);
    return () => observer.disconnect();
  }, [visible, useThumbnail]);

  const image = useAuthenticatedDriveImage({
    googleToken,
    fileId,
    url,
    enabled: visible && !useThumbnail
  });

  const src = useThumbnail ? thumbnailLink : image.src;
  const fit = full ? 'contain' : 'cover';

  if (src) {
    return (
      <img
        src={src}
        alt={alt}
        decoding="async"
        onError={useThumbnail ? () => setThumbnailFailed(true) : undefined}
        style={{ width: full ? 'auto' : '100%', height: full ? 'auto' : '100%', objectFit: fit, display: 'block', ...style }}
      />
    );
  }

  return (
    <div
      ref={boxRef}
      role="img"
      aria-label={image.error ? `${alt} (could not load)` : `${alt} (loading)`}
      style={{
        width: '100%',
        height: '100%',
        minHeight: full ? '200px' : undefined,
        minWidth: full ? '200px' : undefined,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'var(--color-zinc-900)',
        color: 'var(--color-zinc-600)',
        ...style
      }}
    >
      <Image size={placeholderSize} style={{ opacity: image.loading ? 0.4 : 0.8 }} />
    </div>
  );
}
