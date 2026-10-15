import { fetchDriveFileBlob } from './googleDrive';
import { createIssueFloorPlanSnapshotBlob } from './floorPlanSnapshot';
import { hasFloorPlanPin } from './floorPlanPin.js';

function dataUrlToBlob(dataUrl) {
  const [meta, base64] = String(dataUrl || '').split(',');
  const mimeMatch = meta.match(/data:(.*?);base64/);
  const mimeType = mimeMatch?.[1] || 'image/jpeg';
  const raw = window.atob(base64 || '');
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) {
    bytes[i] = raw.charCodeAt(i);
  }
  return new Blob([bytes], { type: mimeType });
}

function getSafePacketFilename(issue, projectName) {
  const project = String(projectName || 'Project').trim();
  const title = String(issue?.title || 'Punch Issue').trim();
  const safeName = `${project}_${title}`
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 72);
  return `${safeName || 'Punch_Issue'}_Packet.pdf`;
}

async function getIssuePhotoBlob(issue, googleToken) {
  if (issue?.photoBase64) {
    return dataUrlToBlob(issue.photoBase64);
  }

  if (issue?.photoFileId && googleToken) {
    return await fetchDriveFileBlob(googleToken, issue.photoFileId);
  }

  return null;
}

async function getIssueProofPhotoBlob(issue, googleToken) {
  if (issue?.proofPhotoBase64) {
    return dataUrlToBlob(issue.proofPhotoBase64);
  }

  if (issue?.proofPhotoFileId && googleToken) {
    return await fetchDriveFileBlob(googleToken, issue.proofPhotoFileId);
  }

  return null;
}

async function getFloorPlanSnapshotBlob(issue, floorPlanImageSrc) {
  const hasLocation = hasFloorPlanPin(issue);
  if (!hasLocation || !floorPlanImageSrc) {
    return null;
  }

  return await createIssueFloorPlanSnapshotBlob(floorPlanImageSrc, issue);
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

export async function createAndShareIssuePacket({
  issue,
  googleToken,
  floorPlanImageSrc,
  projectName,
  subdivision = '',
  selectedFolderName,
  projectInfo = null
}) {
  const [issuePhotoBlob, issueProofPhotoBlob, floorPlanSnapshotBlob, { generateIssuePacketPDF }] = await Promise.all([
    getIssuePhotoBlob(issue, googleToken),
    getIssueProofPhotoBlob(issue, googleToken),
    getFloorPlanSnapshotBlob(issue, floorPlanImageSrc),
    import('./pdfGenerator.js')
  ]);

  const pdfBlob = await generateIssuePacketPDF({
    issue,
    projectName,
    subdivision,
    selectedFolderName,
    projectInfo,
    issuePhotoBlob,
    issueProofPhotoBlob,
    floorPlanSnapshotBlob
  });

  const filename = getSafePacketFilename(issue, projectName || selectedFolderName);
  const file = new File([pdfBlob], filename, { type: 'application/pdf' });
  const shareData = {
    files: [file]
  };

  if (navigator.share && (!navigator.canShare || navigator.canShare(shareData))) {
    await navigator.share(shareData);
    return { shared: true, downloaded: false, filename };
  }

  downloadBlob(pdfBlob, filename);
  return { shared: false, downloaded: true, filename };
}
