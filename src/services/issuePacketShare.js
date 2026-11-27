import { fetchDriveFileBlob } from './googleDrive';
import { createIssueFloorPlanSnapshotBlob } from './floorPlanSnapshot';
import { hasFloorPlanPin } from './floorPlanPin.js';
import { dataUrlToBlob, downloadBlob } from './imageFiles.js';
import { translatePunchPacketToSpanish } from './gemini.js';

function getSafePacketFilename(issue, projectName, language = 'en') {
  const project = String(projectName || 'Project').trim();
  const title = String(issue?.title || 'Punch Issue').trim();
  const safeName = `${project}_${title}`
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 72);
  const langSuffix = String(language || 'en').toLowerCase() === 'es' ? '_ES' : '';
  return `${safeName || 'Punch_Issue'}_Packet${langSuffix}.pdf`;
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

async function getFloorPlanSnapshotBlob(issue, floorPlanImageSrc) {
  const hasLocation = hasFloorPlanPin(issue);
  if (!hasLocation || !floorPlanImageSrc) {
    return null;
  }

  return await createIssueFloorPlanSnapshotBlob(floorPlanImageSrc, issue);
}

export async function createAndShareIssuePacket({
  issue,
  googleToken,
  floorPlanImageSrc,
  projectName,
  subdivision = '',
  selectedFolderName,
  projectInfo = null,
  language = 'en'
}) {
  const targetLang = String(language || 'en').toLowerCase() === 'es' ? 'es' : 'en';
  const translationPromise = targetLang === 'es'
    ? translatePunchPacketToSpanish({
        title: issue?.title || '',
        description: issue?.description || '',
        categoryLabel: String(issue?.category || '').replace(/_/g, ' '),
        tradePhase: issue?.tradePhase || ''
      }).catch(err => {
        console.warn('Could not auto-translate punch issue text to Spanish; using Spanish headers with original text:', err);
        return null;
      })
    : Promise.resolve(null);

  const [issuePhotoBlob, floorPlanSnapshotBlob, translatedFields, { generateIssuePacketPDF }] = await Promise.all([
    getIssuePhotoBlob(issue, googleToken),
    getFloorPlanSnapshotBlob(issue, floorPlanImageSrc),
    translationPromise,
    import('./pdfGenerator.js')
  ]);

  const pdfBlob = await generateIssuePacketPDF({
    issue,
    projectName,
    subdivision,
    selectedFolderName,
    projectInfo,
    issuePhotoBlob,
    floorPlanSnapshotBlob,
    language: targetLang,
    translatedFields
  });

  const filename = getSafePacketFilename(issue, projectName || selectedFolderName, targetLang);
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
