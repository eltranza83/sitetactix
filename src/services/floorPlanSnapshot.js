import { pinCoordinate } from './floorPlanPin.js';

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load floor plan image for sharing.'));
    img.src = src;
  });
}

function drawIssueMarker(ctx, x, y, scale = 1) {
  const markerSize = Math.max(34, 46 * scale);
  const radius = markerSize / 2;

  ctx.save();
  ctx.shadowColor = 'rgba(0, 0, 0, 0.38)';
  ctx.shadowBlur = 14 * scale;
  ctx.shadowOffsetY = 5 * scale;
  ctx.fillStyle = '#ef4444';
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = Math.max(3, 4 * scale);
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.shadowColor = 'transparent';
  ctx.fillStyle = '#ffffff';
  ctx.font = `700 ${Math.max(22, 28 * scale)}px Arial, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('!', x, y + 1 * scale);
  ctx.restore();
}

export async function createIssueFloorPlanSnapshotBlob(imageSrc, issue) {
  if (!imageSrc) {
    throw new Error('No floor plan image is available to share.');
  }

  const xPercent = pinCoordinate(issue?.floorPlanX);
  const yPercent = pinCoordinate(issue?.floorPlanY);
  if (xPercent === null || yPercent === null) {
    throw new Error('This issue does not have a floor plan location.');
  }

  const img = await loadImage(imageSrc);
  const maxWidth = 1600;
  const scale = Math.min(1, maxWidth / img.naturalWidth);
  const width = Math.round(img.naturalWidth * scale);
  const height = Math.round(img.naturalHeight * scale);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(img, 0, 0, width, height);

  drawIssueMarker(ctx, (xPercent / 100) * width, (yPercent / 100) * height, scale);

  return await new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
      } else {
        reject(new Error('Failed to create marked floor plan image.'));
      }
    }, 'image/jpeg', 0.9);
  });
}
