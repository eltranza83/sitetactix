import { useEffect, useRef, useState } from 'react';
import { STATUS_MESSAGES, getDriveErrorMessage, getUploadErrorMessage, getValidationErrorMessage } from '../services/appErrors';
import {
  addBlueprintPin,
  deleteBlueprintPin,
  listBlueprintPhasePhotos,
  loadBlueprintVault,
  resetBlueprintVault,
  updateBlueprintPin,
  uploadBlueprintAlbumPhoto,
  uploadBlueprintVaultFile
} from '../services/blueprintDrive';
import { normalizeZoomScale } from '../services/blueprintViewport';
import { confirmAction } from '../services/confirmAction';
import { compressSitePhoto } from '../services/imageFiles';

const DEFAULT_PIN_FORM = {
  tradeCategory: 'Mechanicals_&_Utilities',
  tradePhase: 'Plumbing Rough-In',
  room: '',
  wall: '',
  level: '',
  note: ''
};

function buildPinFormData(pin) {
  return {
    tradeCategory: pin?.category || DEFAULT_PIN_FORM.tradeCategory,
    tradePhase: pin?.phase || DEFAULT_PIN_FORM.tradePhase,
    room: pin?.room || '',
    wall: pin?.wall || '',
    level: pin?.level || '',
    note: pin?.note || ''
  };
}

export function useBlueprintPinboard({
  activeProject,
  googleToken,
  selectedFolder,
  tradeSectionsConfig
}) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [blueprintDataFileId, setBlueprintDataFileId] = useState(null);
  const [blueprintFileId, setBlueprintFileId] = useState(null);
  const [blueprintFileName, setBlueprintFileName] = useState(null);
  const [imageSrc, setImageSrc] = useState(null);
  const [pins, setPins] = useState([]);
  const [zoomScale, setZoomScale] = useState(1);
  const [isAddMode, setIsAddMode] = useState(false);
  const [selectedPin, setSelectedPin] = useState(null);
  const [editingPin, setEditingPin] = useState(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newPinCoords, setNewPinCoords] = useState({ x: 0, y: 0 });
  const [formData, setFormData] = useState(DEFAULT_PIN_FORM);
  const [selectedPhotos, setSelectedPhotos] = useState([]);
  const [photoPreviews, setPhotoPreviews] = useState([]);
  const [savingPin, setSavingPin] = useState(false);
  const [viewMode, setViewMode] = useState('blueprint');
  const [expandedCategory, setExpandedCategory] = useState(null);
  const [activeAlbumPhase, setActiveAlbumPhase] = useState(null);
  const [albumPhotos, setAlbumPhotos] = useState([]);
  const [loadingAlbumPhotos, setLoadingAlbumPhotos] = useState(false);
  const [uploadingAlbumPhoto, setUploadingAlbumPhoto] = useState(false);
  const [fullscreenAlbumPhoto, setFullscreenAlbumPhoto] = useState(null);

  const fileInputRef = useRef(null);
  const blueprintInputRef = useRef(null);
  const imageContainerRef = useRef(null);
  const albumFileInputRef = useRef(null);
  const imageSrcRef = useRef(null);

  const clearBlueprintImage = () => {
    if (imageSrcRef.current) {
      URL.revokeObjectURL(imageSrcRef.current);
      imageSrcRef.current = null;
    }
    setImageSrc(null);
  };

  const loadBlueprintData = async () => {
    setLoading(true);
    setError(null);
    setSelectedPin(null);
    setIsAddMode(false);
    clearBlueprintImage();

    try {
      const data = await loadBlueprintVault(googleToken, selectedFolder.id);
      const safeData = data || {};
      setBlueprintDataFileId(safeData.blueprintDataFileId || null);
      setBlueprintFileId(safeData.blueprintFileId || null);
      setBlueprintFileName(safeData.blueprintFileName || (safeData.blueprintFileId ? 'Blueprint.png' : null));
      setPins(safeData.pins || []);

      if (safeData.blueprintBlob) {
        const localUrl = URL.createObjectURL(safeData.blueprintBlob);
        setImageSrc(localUrl);
      }
    } catch (err) {
      console.error(err);
      setError(getDriveErrorMessage(err, 'retrieve blueprint data from Google Drive'));
    } finally {
      setLoading(false);
    }
  };

  const loadPhasePhotos = async (category, phase) => {
    setLoadingAlbumPhotos(true);
    try {
      const list = await listBlueprintPhasePhotos({
        accessToken: googleToken,
        projectFolderId: selectedFolder.id,
        category,
        phase
      });
      setAlbumPhotos(list || []);
    } catch (err) {
      console.error(err);
      setError(getDriveErrorMessage(err, 'load photos from Google Drive'));
    } finally {
      setLoadingAlbumPhotos(false);
    }
  };

  useEffect(() => {
    if (googleToken && selectedFolder?.id) {
      loadBlueprintData();
    }
  }, [googleToken, selectedFolder?.id, activeProject?.id]);

  useEffect(() => {
    if (imageSrc) {
      setViewMode('blueprint');
    } else {
      setViewMode('albums');
    }
    imageSrcRef.current = imageSrc;
  }, [imageSrc]);

  useEffect(() => {
    if (activeAlbumPhase) {
      loadPhasePhotos(activeAlbumPhase.category, activeAlbumPhase.phase);
    }
  }, [activeAlbumPhase]);

  useEffect(() => {
    return () => {
      if (imageSrcRef.current) {
        URL.revokeObjectURL(imageSrcRef.current);
      }
    };
  }, []);

  const handleUploadAlbumPhoto = async (e) => {
    const file = e.target.files[0];
    // Clear the picker so choosing the same photo again still counts as a change
    e.target.value = '';
    if (!file || !activeAlbumPhase) return;

    setUploadingAlbumPhoto(true);
    setError(null);
    try {
      await uploadBlueprintAlbumPhoto({
        accessToken: googleToken,
        projectFolderId: selectedFolder.id,
        activeAlbumPhase,
        file: await compressSitePhoto(file)
      });
      await loadPhasePhotos(activeAlbumPhase.category, activeAlbumPhase.phase);
      setSuccess('Progress photo uploaded successfully!');
      setTimeout(() => setSuccess(null), 2500);
    } catch (err) {
      console.error(err);
      setError(getUploadErrorMessage(err, 'progress photo'));
    } finally {
      setUploadingAlbumPhoto(false);
    }
  };

  const handleUploadBlueprint = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setError(getValidationErrorMessage('Please pick the floor plan as a picture (PNG or JPEG). For a PDF, take a screenshot of the floor plan page and pick that.'));
      return;
    }

    setLoading(true);
    setError(null);

    try {
      await uploadBlueprintVaultFile({
        accessToken: googleToken,
        projectFolderId: selectedFolder.id,
        projectName: activeProject?.name,
        file,
        blueprintDataFileId
      });
      await loadBlueprintData();
      setSuccess('Blueprint uploaded successfully!');
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      console.error(err);
      setError(getUploadErrorMessage(err, 'blueprint'));
    } finally {
      setLoading(false);
    }
  };

  const handleCanvasClick = (e) => {
    if (!isAddMode) return;

    const rect = e.target.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;

    setNewPinCoords({ x, y });
    setFormData(DEFAULT_PIN_FORM);
    setSelectedPhotos([]);
    setPhotoPreviews([]);
    setEditingPin(null);
    setShowAddForm(true);
    setIsAddMode(false);
  };

  const handleCategoryChange = (e) => {
    const cat = e.target.value;
    const defaultPhase = tradeSectionsConfig[cat]?.phases[0] || '';
    setFormData(prev => ({
      ...prev,
      tradeCategory: cat,
      tradePhase: defaultPhase
    }));
  };

  const handlePhotoSelect = async (e) => {
    const picked = Array.from(e.target.files || []);
    // Clear the picker so choosing the same photo again still counts as a change
    e.target.value = '';
    if (!picked.length) return;

    const files = await Promise.all(picked.map(compressSitePhoto));
    setSelectedPhotos(prev => [...prev, ...files]);

    const fileReaders = files.map((file) => new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(file);
    }));

    Promise.all(fileReaders).then((results) => {
      setPhotoPreviews(prev => [...prev, ...results.filter(Boolean)]);
    });
  };

  const clearSelectedPhoto = () => {
    setSelectedPhotos([]);
    setPhotoPreviews([]);
  };

  const handleSavePin = async (e) => {
    e.preventDefault();
    // The note is optional: level, room, wall, phase and the photo already describe the pin

    setSavingPin(true);
    setError(null);

    try {
      let updatedPins;
      let updatedPin = null;

      if (editingPin) {
        const result = await updateBlueprintPin({
          accessToken: googleToken,
          projectFolderId: selectedFolder.id,
          blueprintDataFileId,
          blueprintFileId,
          blueprintFileName,
          pins,
          pinId: editingPin.id,
          formData,
          selectedPhotos
        });
        updatedPins = result.updatedPins;
        updatedPin = result.updatedPin;
      } else {
        const result = await addBlueprintPin({
          accessToken: googleToken,
          projectFolderId: selectedFolder.id,
          blueprintDataFileId,
          blueprintFileId,
          blueprintFileName,
          pins,
          pinCoords: newPinCoords,
          formData,
          selectedPhotos
        });
        updatedPins = result.updatedPins;
        updatedPin = result.newPin;
      }

      setPins(updatedPins);
      setSelectedPin(updatedPin);
      setShowAddForm(false);
      setEditingPin(null);
      setFormData(DEFAULT_PIN_FORM);
      clearSelectedPhoto();
      setSuccess(editingPin ? 'Pin updated.' : 'Pin added to blueprint!');
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      console.error(err);
      setError(getDriveErrorMessage(err, editingPin ? 'update pin details' : 'save pin details'));
    } finally {
      setSavingPin(false);
    }
  };

  const handleDeletePin = async (pinId) => {
    if (!(await confirmAction({ title: 'Delete this pin?', message: 'The pin comes off the floor plan. Its photos stay in Drive.', confirmLabel: 'Delete pin' }))) return;

    setLoading(true);
    setError(null);

    try {
      const updatedPins = await deleteBlueprintPin({
        accessToken: googleToken,
        blueprintDataFileId,
        blueprintFileId,
        blueprintFileName,
        pins,
        pinId
      });
      setPins(updatedPins);
      setSelectedPin(null);
      setSuccess('Pin removed.');
      setTimeout(() => setSuccess(null), 2000);
    } catch (err) {
      console.error(err);
      setError(getDriveErrorMessage(err, 'update pins data'));
    } finally {
      setLoading(false);
    }
  };

  const handleResetBlueprint = async () => {
    if (!(await confirmAction({
      title: 'Remove the floor plan?',
      message: 'This also removes every X-Ray pin on it. The pin photos stay in Drive, but lose their spots on the plan.',
      confirmLabel: 'Remove floor plan'
    }))) return;

    setLoading(true);
    setError(null);
    try {
      if (selectedFolder?.id) {
        await resetBlueprintVault(googleToken, selectedFolder.id, blueprintDataFileId);
      }
      clearBlueprintImage();
      setBlueprintDataFileId(null);
      setBlueprintFileId(null);
      setBlueprintFileName(null);
      setPins([]);
      setSelectedPin(null);
      setSuccess('Floor plan removed.');
      setTimeout(() => setSuccess(null), 2500);
    } catch (err) {
      console.error('Error resetting blueprint:', err);
      setError(getDriveErrorMessage(err, 'clear blueprint'));
    } finally {
      setLoading(false);
    }
  };

  const handleToggleAddMode = () => {
    setIsAddMode(!isAddMode);
    setSelectedPin(null);
    setEditingPin(null);
  };

  const handleSetZoomScale = (updater) => {
    setZoomScale((prev) => normalizeZoomScale(typeof updater === 'function' ? updater(prev) : updater));
  };

  const handleSelectPin = (pin) => {
    setSelectedPin(pin);
    if (pin) {
      setIsAddMode(false);
    }
  };

  const handleEditPin = (pin) => {
    setEditingPin(pin);
    setSelectedPin(pin);
    setFormData(buildPinFormData(pin));
    setSelectedPhotos([]);
    setPhotoPreviews([]);
    setShowAddForm(true);
    setIsAddMode(false);
  };

  return {
    activeAlbumPhase,
    albumFileInputRef,
    albumPhotos,
    blueprintInputRef,
    error,
    expandedCategory,
    fileInputRef,
    formData,
    fullscreenAlbumPhoto,
    imageContainerRef,
    imageSrc,
    isAddMode,
    loading,
    loadingAlbumPhotos,
    photoPreviews,
    pins,
    savingPin,
    selectedPin,
    editingPin,
    showAddForm,
    success,
    uploadingAlbumPhoto,
    viewMode,
    zoomScale,
    clearSelectedPhoto,
    handleCanvasClick,
    handleCategoryChange,
    handleDeletePin,
    handleEditPin,
    handlePhotoSelect,
    handleResetBlueprint,
    handleSavePin,
    handleSelectPin,
    handleToggleAddMode,
    handleUploadAlbumPhoto,
    handleUploadBlueprint,
    setActiveAlbumPhase,
    setExpandedCategory,
    setFormData,
    setFullscreenAlbumPhoto,
    setShowAddForm,
    setViewMode,
    setZoomScale: handleSetZoomScale,
    statusMessages: STATUS_MESSAGES
  };
}
