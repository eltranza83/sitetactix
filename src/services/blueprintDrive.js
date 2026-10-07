import {
  ensureAppSubfolder,
  fetchDriveFileBlob,
  findFileInFolder,
  getFileContent,
  listPhotosInPhase,
  updateFileContent,
  uploadFileToDrive,
  uploadPhotoToPhaseFolder
} from './googleDrive.js';

const X_RAY_FOLDER_NAME = 'X-Ray Photos';
const BLUEPRINT_CONFIG_FILE = 'blueprint_data.json';
const BLUEPRINT_CONFIG_MIME_TYPE = 'application/json';

function buildJsonBlob(data) {
  return new Blob([JSON.stringify(data, null, 2)], { type: BLUEPRINT_CONFIG_MIME_TYPE });
}

function buildBlueprintConfig({ blueprintFileId = null, blueprintFileName = null, pins = [] } = {}) {
  return {
    blueprintFileId,
    blueprintFileName,
    pins
  };
}

function cleanPinLocationValue(value) {
  return String(value || '').trim();
}

function buildPinDetailsFromForm(formData) {
  return {
    category: formData.tradeCategory,
    phase: formData.tradePhase,
    note: formData.note.trim(),
    room: cleanPinLocationValue(formData.room),
    wall: cleanPinLocationValue(formData.wall),
    level: cleanPinLocationValue(formData.level)
  };
}

export function normalizePhotoUrl(url, fileId) {
  if (!url && !fileId) return '';
  if (!url) return `https://drive.google.com/uc?export=view&id=${fileId}`;
  if (!fileId) return url;

  const driveViewMatch = url.match(/https?:\/\/drive\.google\.com\/file\/d\/([^/]+)\/view/i);
  if (driveViewMatch?.[1]) {
    return `https://drive.google.com/uc?export=view&id=${driveViewMatch[1]}`;
  }

  const driveOpenMatch = url.match(/https?:\/\/drive\.google\.com\/open\?id=([^&]+)/i);
  if (driveOpenMatch?.[1]) {
    return `https://drive.google.com/uc?export=view&id=${driveOpenMatch[1]}`;
  }

  return url;
}

export function normalizePinPhotos(pin) {
  const legacyPhoto = pin?.photoUrl || pin?.photoFileId ? {
    fileId: pin?.photoFileId || '',
    url: pin?.photoUrl || '',
    name: pin?.photoName || ''
  } : null;

  if (Array.isArray(pin?.photoAttachments)) {
    return pin.photoAttachments
      .filter(Boolean)
      .map((photo) => ({
        fileId: photo?.fileId || '',
        url: normalizePhotoUrl(photo?.url || '', photo?.fileId || ''),
        name: photo?.name || ''
      }));
  }

  return legacyPhoto ? [{
    fileId: legacyPhoto.fileId,
    url: normalizePhotoUrl(legacyPhoto.url, legacyPhoto.fileId),
    name: legacyPhoto.name
  }] : [];
}

function buildPinPhotoAttachment(selectedPhoto, formData, accessToken, projectFolderId) {
  const extension = selectedPhoto.name.split('.').pop();
  const photoFileName = `${formData.tradePhase.replace(/[^a-zA-Z0-9_]/g, '_')}_Pin_${Date.now()}.${extension}`;
  return uploadPhotoToPhaseFolder(
    accessToken,
    projectFolderId,
    formData.tradeCategory,
    formData.tradePhase,
    photoFileName,
    selectedPhoto.type,
    selectedPhoto
  );
}

async function ensureXRayFolder(accessToken, projectFolderId) {
  return await ensureAppSubfolder(accessToken, projectFolderId, X_RAY_FOLDER_NAME);
}

async function saveBlueprintConfig(accessToken, blueprintDataFileId, config) {
  const blob = buildJsonBlob(config);
  return await updateFileContent(accessToken, blueprintDataFileId, blob, BLUEPRINT_CONFIG_MIME_TYPE);
}

export async function loadBlueprintVault(accessToken, projectFolderId) {
  const xRayFolderId = await ensureXRayFolder(accessToken, projectFolderId);
  const configJsonFile = await findFileInFolder(accessToken, xRayFolderId, BLUEPRINT_CONFIG_FILE);

  if (!configJsonFile) {
    return {
      blueprintDataFileId: null,
      blueprintFileId: null,
      blueprintFileName: null,
      pins: [],
      blueprintBlob: null
    };
  }

  try {
    const data = await getFileContent(accessToken, configJsonFile.id);
    const blueprintFileId = data?.blueprintFileId || null;

    return {
      blueprintDataFileId: configJsonFile.id,
      blueprintFileId,
      blueprintFileName: data?.blueprintFileName || null,
      pins: data?.pins || [],
      blueprintBlob: blueprintFileId ? await fetchDriveFileBlob(accessToken, blueprintFileId) : null
    };
  } catch (err) {
    console.error('Failed to parse blueprint_data.json content:', err);
    return {
      blueprintDataFileId: configJsonFile.id,
      blueprintFileId: null,
      blueprintFileName: null,
      pins: [],
      blueprintBlob: null
    };
  }
}

export async function uploadBlueprintVaultFile({
  accessToken,
  projectFolderId,
  projectName,
  file,
  blueprintDataFileId
}) {
  const xRayFolderId = await ensureXRayFolder(accessToken, projectFolderId);
  const extension = file.name.split('.').pop();
  const blueprintFileName = `${projectName || 'Project'}_Blueprint_${Date.now()}.${extension}`;
  const imgUpload = await uploadFileToDrive(accessToken, xRayFolderId, blueprintFileName, file.type, file);
  const configPayload = buildBlueprintConfig({
    blueprintFileId: imgUpload.id,
    blueprintFileName,
    pins: []
  });
  const blob = buildJsonBlob(configPayload);

  if (blueprintDataFileId) {
    await updateFileContent(accessToken, blueprintDataFileId, blob, BLUEPRINT_CONFIG_MIME_TYPE);
    return blueprintDataFileId;
  }

  const uploadedConfig = await uploadFileToDrive(
    accessToken,
    xRayFolderId,
    BLUEPRINT_CONFIG_FILE,
    BLUEPRINT_CONFIG_MIME_TYPE,
    blob
  );
  return uploadedConfig.id;
}

export async function addBlueprintPin({
  accessToken,
  projectFolderId,
  blueprintDataFileId,
  blueprintFileId,
  blueprintFileName,
  pins,
  pinCoords,
  formData,
  selectedPhotos
}) {
  let photoAttachments = [];

  if (selectedPhotos?.length) {
    const uploadResults = await Promise.all(
      selectedPhotos.map((selectedPhoto) => buildPinPhotoAttachment(selectedPhoto, formData, accessToken, projectFolderId))
    );
    photoAttachments = uploadResults.map((uploadResult, index) => ({
      fileId: uploadResult.id,
      url: uploadResult.webViewLink || '',
      name: selectedPhotos[index]?.name || ''
    }));
  }

  const newPin = {
    id: `pin_${Date.now()}`,
    x: parseFloat(pinCoords.x.toFixed(2)),
    y: parseFloat(pinCoords.y.toFixed(2)),
    ...buildPinDetailsFromForm(formData),
    photoAttachments,
    photoFileId: photoAttachments[0]?.fileId || '',
    photoUrl: photoAttachments[0]?.url || '',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  const updatedPins = [...pins, newPin];

  await saveBlueprintConfig(
    accessToken,
    blueprintDataFileId,
    buildBlueprintConfig({ blueprintFileId, blueprintFileName, pins: updatedPins })
  );

  return { newPin, updatedPins };
}

export async function updateBlueprintPin({
  accessToken,
  projectFolderId,
  blueprintDataFileId,
  blueprintFileId,
  blueprintFileName,
  pins,
  pinId,
  formData,
  selectedPhotos
}) {
  const existingPin = pins.find(pin => pin.id === pinId);
  if (!existingPin) {
    throw new Error('Could not update pin. The selected pin no longer exists.');
  }

  let photoAttachments = normalizePinPhotos(existingPin);
  let photoUrl = existingPin.photoUrl || (photoAttachments[0]?.url || '');
  let photoFileId = existingPin.photoFileId || (photoAttachments[0]?.fileId || '');

  if (selectedPhotos?.length) {
    const uploadResults = await Promise.all(
      selectedPhotos.map((selectedPhoto) => buildPinPhotoAttachment(selectedPhoto, formData, accessToken, projectFolderId))
    );
    const nextAttachments = uploadResults.map((uploadResult, index) => ({
      fileId: uploadResult.id,
      url: uploadResult.webViewLink || '',
      name: selectedPhotos[index]?.name || ''
    }));
    photoAttachments = [...nextAttachments, ...photoAttachments.filter((attachment) => !nextAttachments.some((nextAttachment) => nextAttachment.fileId === attachment.fileId))];
    photoUrl = photoAttachments[0]?.url || '';
    photoFileId = photoAttachments[0]?.fileId || '';
  }

  const updatedPin = {
    ...existingPin,
    ...buildPinDetailsFromForm(formData),
    photoAttachments,
    photoFileId,
    photoUrl,
    updatedAt: new Date().toISOString()
  };
  const updatedPins = pins.map(pin => (pin.id === pinId ? updatedPin : pin));

  await saveBlueprintConfig(
    accessToken,
    blueprintDataFileId,
    buildBlueprintConfig({ blueprintFileId, blueprintFileName, pins: updatedPins })
  );

  return { updatedPin, updatedPins };
}

export function buildBlueprintAlbumPhotoFileName(phaseName, originalName, timestamp = Date.now()) {
  const extension = originalName.split('.').pop();
  return `${phaseName.replace(/[^a-zA-Z0-9_]/g, '_')}_Album_${timestamp}.${extension}`;
}

export async function listBlueprintPhasePhotos({
  accessToken,
  projectFolderId,
  category,
  phase
}) {
  return await listPhotosInPhase(accessToken, projectFolderId, category, phase);
}

export async function uploadBlueprintAlbumPhoto({
  accessToken,
  projectFolderId,
  activeAlbumPhase,
  file
}) {
  const photoFileName = buildBlueprintAlbumPhotoFileName(activeAlbumPhase.phase, file.name);
  return await uploadPhotoToPhaseFolder(
    accessToken,
    projectFolderId,
    activeAlbumPhase.category,
    activeAlbumPhase.phase,
    photoFileName,
    file.type,
    file
  );
}

export async function deleteBlueprintPin({
  accessToken,
  blueprintDataFileId,
  blueprintFileId,
  blueprintFileName,
  pins,
  pinId
}) {
  const updatedPins = pins.filter(pin => pin.id !== pinId);

  await saveBlueprintConfig(
    accessToken,
    blueprintDataFileId,
    buildBlueprintConfig({ blueprintFileId, blueprintFileName, pins: updatedPins })
  );

  return updatedPins;
}

export async function resetBlueprintVault(accessToken, projectFolderId, blueprintDataFileId) {
  try {
    let fileId = blueprintDataFileId;
    if (!fileId && projectFolderId) {
      const xRayFolderId = await ensureXRayFolder(accessToken, projectFolderId);
      const configJsonFile = await findFileInFolder(accessToken, xRayFolderId, BLUEPRINT_CONFIG_FILE);
      fileId = configJsonFile?.id || null;
    }
    if (fileId) {
      await saveBlueprintConfig(accessToken, fileId, buildBlueprintConfig());
    }
  } catch (err) {
    console.error('Error resetting blueprint vault:', err);
  }
}
