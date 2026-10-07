import { useState, useEffect } from 'react';
import { loadIssuesVault, saveIssuesVault, uploadIssuePhoto, uploadIssueProofPhoto, mergeIssues, mergeActivityHistories } from '../services/issuesDrive';
import { getDriveErrorMessage } from '../services/appErrors';

const OFFLINE_QUEUE_KEY = 'jobscan_offline_issues_queue';
const CACHED_ISSUES_PREFIX = 'jobscan_cached_issues_';

function appendActivityHistoryEvent(history = [], newEvent) {
  const list = Array.isArray(history) ? history : [];
  const eventId = newEvent.id || `act_${newEvent.action}_${Date.now()}`;
  return mergeActivityHistories(list, [{ ...newEvent, id: eventId }]);
}

// Helper to convert File to Base64 (for offline storage)
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result);
    reader.onerror = error => reject(error);
  });
}

// Helper to convert Base64 to Blob (for uploading when going online)
function base64ToBlob(base64Str, mimeType) {
  const parts = base64Str.split(';base64,');
  const raw = window.atob(parts[1] || parts[0]);
  const rawLength = raw.length;
  const u8arr = new Uint8Array(rawLength);
  for (let i = 0; i < rawLength; ++i) {
    u8arr[i] = raw.charCodeAt(i);
  }
  return new Blob([u8arr], { type: mimeType });
}

export function useIssues({ googleToken, activeProject }) {
  const [issues, setIssues] = useState([]);
  const [contacts, setContacts] = useState({});
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [issuesDataFileId, setIssuesDataFileId] = useState(null);

  const projectId = activeProject?.id || 'default';
  const offlineQueueKey = `${OFFLINE_QUEUE_KEY}_${projectId}`;
  const cacheKey = `${CACHED_ISSUES_PREFIX}_${projectId}`;
  const contactsCacheKey = `jobscan_cached_contacts_${projectId}`;

  // Get local queue
  const getOfflineQueue = () => {
    try {
      return JSON.parse(localStorage.getItem(offlineQueueKey)) || [];
    } catch {
      return [];
    }
  };

  // Save local queue
  const saveOfflineQueue = (queue) => {
    localStorage.setItem(offlineQueueKey, JSON.stringify(queue));
  };

  // Load issues (either from Drive or local cache if offline)
  const loadIssues = async (forceSync = false) => {
    if (!activeProject?.folderId) {
      // Offline fallback: load from localStorage cache
      const cached = localStorage.getItem(cacheKey);
      if (cached) {
        try {
          setIssues(JSON.parse(cached));
        } catch {
          setIssues([]);
        }
      }
      const cachedContacts = localStorage.getItem(contactsCacheKey);
      if (cachedContacts) {
        try {
          setContacts(JSON.parse(cachedContacts));
        } catch {
          setContacts({});
        }
      }
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const { issuesDataFileId: fileId, issues: remoteList, contacts: remoteContacts } = await loadIssuesVault(
        googleToken,
        activeProject.folderId
      );
      setIssuesDataFileId(fileId);
      setContacts(remoteContacts || {});
      localStorage.setItem(contactsCacheKey, JSON.stringify(remoteContacts || {}));

      const queue = getOfflineQueue();
      if (queue.length > 0 || forceSync) {
        // We have pending offline operations, trigger merge & upload
        await processAndSyncQueue(remoteList, fileId, remoteContacts || {});
      } else {
        setIssues(remoteList);
        localStorage.setItem(cacheKey, JSON.stringify(remoteList));
      }
    } catch (err) {
      console.error(err);
      setError(getDriveErrorMessage(err, 'load issues from Google Drive'));
      // Fallback to cache on error
      const cached = localStorage.getItem(cacheKey);
      if (cached) setIssues(JSON.parse(cached));
      const cachedContacts = localStorage.getItem(contactsCacheKey);
      if (cachedContacts) setContacts(JSON.parse(cachedContacts));
    } finally {
      setLoading(false);
    }
  };

  // Sync effect on project/auth state changes
  useEffect(() => {
    loadIssues();
  }, [googleToken, activeProject?.id]);

  // Execute and upload the merged operations to Drive & Sheets
  const processAndSyncQueue = async (remoteList, fileId, updatedContacts = contacts) => {
    if (!googleToken || !activeProject?.folderId) return;

    setSyncing(true);
    setError(null);
    try {
      const queue = getOfflineQueue();
      const currentFileId = fileId || issuesDataFileId;

      // 1. Process any pending image uploads inside the queue
      for (const op of queue) {
        if ((op.type === 'CREATE' || op.type === 'UPDATE') && op.payload.photoBase64 && !op.payload.photoUrl) {
          try {
            const mimeType = op.payload.photoBase64.match(/:(.*?);/)[1] || 'image/jpeg';
            const blob = base64ToBlob(op.payload.photoBase64, mimeType);
            const fileObj = new File([blob], `offline_issue_photo.jpg`, { type: mimeType });

            const uploadResult = await uploadIssuePhoto(googleToken, activeProject.folderId, fileObj);
            op.payload.photoUrl = uploadResult.url;
            op.payload.photoFileId = uploadResult.id;

            // Cache base64 photo locally on this device before stripping it from operations payload
            if (op.payload.photoBase64) {
              try {
                localStorage.setItem(`jobscan_photo_${op.id}`, op.payload.photoBase64);
              } catch (e) {
                console.warn('Failed to cache base64 photo locally during sync:', e);
              }
            }

            delete op.payload.photoBase64; // Remove base64 data to keep JSON light
          } catch (uploadErr) {
            console.error('Failed to upload offline photo during sync:', uploadErr);
          }
        }
      }

      // 2. Perform the merge
      const mergedList = mergeIssues(remoteList, queue);

      // 3. Save merged config back to Google Drive
      const savedFileId = await saveIssuesVault(
        googleToken,
        activeProject.folderId,
        currentFileId,
        { issues: mergedList, contacts: updatedContacts }
      );
      setIssuesDataFileId(savedFileId);

      // 5. Success! Clear local queue, update states and cache
      saveOfflineQueue([]);
      setIssues(mergedList);
      localStorage.setItem(cacheKey, JSON.stringify(mergedList));
      setSuccess('Issues synchronized successfully!');
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      console.error(err);
      setError(getDriveErrorMessage(err, 'sync offline issues to Google Drive'));
    } finally {
      setSyncing(false);
    }
  };

  // Add issue action
  const addIssue = async ({
    title,
    description,
    category,
    tradePhase,
    contractorName,
    phoneNumber,
    priority,
    dueDate = '',
    photoFile,
    floorPlanX = null,
    floorPlanY = null
  }) => {
    setError(null);
    const newId = `issue_${Date.now()}`;
    const timestamp = Date.now();

    let photoBase64 = null;
    let photoUrl = null;
    let photoFileId = null;

    // Save/update phone number in contacts registry
    let updatedContacts = { ...contacts };
    if (contractorName?.trim() && phoneNumber?.trim()) {
      updatedContacts[contractorName.trim()] = phoneNumber.trim();
      setContacts(updatedContacts);
      localStorage.setItem(contactsCacheKey, JSON.stringify(updatedContacts));
    }

    // Handle photo attachment
    if (photoFile) {
      const isOnline = !!(googleToken && activeProject?.folderId);
      if (isOnline) {
        setLoading(true);
        try {
          const uploadResult = await uploadIssuePhoto(googleToken, activeProject.folderId, photoFile);
          photoUrl = uploadResult.url;
          photoFileId = uploadResult.id;
        } catch (uploadErr) {
          console.error('Failed to upload photo immediately:', uploadErr);
          setError('Failed to upload photo to Drive, queuing issue locally...');
          // Fallback to offline mode for photo
          photoBase64 = await fileToBase64(photoFile);
        } finally {
          setLoading(false);
        }
      } else {
        // Offline: convert to base64 to store in queue
        photoBase64 = await fileToBase64(photoFile);
      }
    }

    const createdAtIso = new Date(timestamp).toISOString();
    const initialEvents = [
      {
        id: `act_created_${timestamp}`,
        action: 'created',
        timestamp: createdAtIso,
        actor: 'Builder',
        note: description ? `Initial defect logged: ${description}` : 'Initial defect logged'
      },
      contractorName?.trim() ? {
        id: `act_assigned_${timestamp}`,
        action: 'assigned',
        timestamp: createdAtIso,
        actor: 'Builder',
        details: `Assigned to ${contractorName.trim()}${dueDate ? ` (Due: ${dueDate})` : ''}`
      } : null
    ].filter(Boolean);

    const payload = {
      title,
      description,
      category,
      tradePhase: tradePhase || '',
      contractorName: contractorName || '',
      phoneNumber: phoneNumber || '',
      priority,
      status: 'open',
      dueDate: dueDate || '',
      activityHistory: initialEvents,
      photoBase64,
      photoUrl,
      photoFileId,
      proofPhotoBase64: null,
      proofPhotoUrl: null,
      proofPhotoFileId: null,
      proofNotes: '',
      proofSubmittedAt: null,
      verifiedAt: null,
      verifiedBy: null,
      reopenReason: '',
      reopenedAt: null,
      floorPlanX,
      floorPlanY
    };

    const newOp = {
      type: 'CREATE',
      id: newId,
      payload,
      timestamp
    };

    // Update queue
    const queue = [...getOfflineQueue(), newOp];
    saveOfflineQueue(queue);

    // Update local UI state immediately (optimistic update)
    const localNewIssue = {
      id: newId,
      ...payload,
      createdAt: new Date(timestamp).toISOString(),
      updatedAt: new Date(timestamp).toISOString(),
      deletedAt: null
    };
    const updatedList = [...issues, localNewIssue];
    setIssues(updatedList);
    localStorage.setItem(cacheKey, JSON.stringify(updatedList));

    // Cache the base64 photo locally on this device permanently
    if (photoBase64) {
      try {
        localStorage.setItem(`jobscan_photo_${newId}`, photoBase64);
      } catch (e) {
        console.warn('Failed to cache base64 photo locally:', e);
      }
    }

    // Try to trigger online sync
    if (googleToken && activeProject?.folderId) {
      try {
        const { issues: latestRemote } = await loadIssuesVault(googleToken, activeProject.folderId);
        await processAndSyncQueue(latestRemote, issuesDataFileId, updatedContacts);
      } catch {
        // If sync fails, it will remain in queue and sync next time
      }
    } else {
      setSuccess('Issue saved locally. Will sync when online.');
      setTimeout(() => setSuccess(null), 3000);
    }
  };

  // Update status action
  const updateIssue = async (id, updates) => {
    setError(null);
    const timestamp = Date.now();
    const existingIssue = issues.find(issue => issue.id === id);
    if (!existingIssue) return;

    let photoBase64 = existingIssue.photoBase64 || null;
    let photoUrl = existingIssue.photoUrl || null;
    let photoFileId = existingIssue.photoFileId || null;

    let updatedContacts = { ...contacts };
    if (updates.contractorName?.trim() && updates.phoneNumber?.trim()) {
      updatedContacts[updates.contractorName.trim()] = updates.phoneNumber.trim();
      setContacts(updatedContacts);
      localStorage.setItem(contactsCacheKey, JSON.stringify(updatedContacts));
    }

    if (updates.photoFile) {
      const isOnline = !!(googleToken && activeProject?.folderId);
      if (isOnline) {
        setLoading(true);
        try {
          const uploadResult = await uploadIssuePhoto(googleToken, activeProject.folderId, updates.photoFile);
          photoUrl = uploadResult.url;
          photoFileId = uploadResult.id;
          photoBase64 = null;
        } catch (uploadErr) {
          console.error('Failed to upload updated issue photo immediately:', uploadErr);
          setError('Failed to upload photo to Drive, queuing issue update locally...');
          photoBase64 = await fileToBase64(updates.photoFile);
        } finally {
          setLoading(false);
        }
      } else {
        photoBase64 = await fileToBase64(updates.photoFile);
      }
    }

    const payload = {
      title: updates.title !== undefined ? updates.title : existingIssue.title,
      description: updates.description !== undefined ? updates.description : existingIssue.description,
      category: updates.category !== undefined ? updates.category : existingIssue.category,
      tradePhase: updates.tradePhase !== undefined ? updates.tradePhase : (existingIssue.tradePhase || ''),
      contractorName: updates.contractorName !== undefined ? updates.contractorName : (existingIssue.contractorName || ''),
      phoneNumber: updates.phoneNumber !== undefined ? updates.phoneNumber : (existingIssue.phoneNumber || ''),
      priority: updates.priority !== undefined ? updates.priority : existingIssue.priority,
      status: updates.status !== undefined ? updates.status : existingIssue.status,
      dueDate: updates.dueDate !== undefined ? updates.dueDate : (existingIssue.dueDate || ''),
      photoBase64,
      photoUrl,
      photoFileId,
      proofPhotoBase64: updates.proofPhotoBase64 !== undefined ? updates.proofPhotoBase64 : (existingIssue.proofPhotoBase64 || null),
      proofPhotoUrl: updates.proofPhotoUrl !== undefined ? updates.proofPhotoUrl : (existingIssue.proofPhotoUrl || null),
      proofPhotoFileId: updates.proofPhotoFileId !== undefined ? updates.proofPhotoFileId : (existingIssue.proofPhotoFileId || null),
      proofNotes: updates.proofNotes !== undefined ? updates.proofNotes : (existingIssue.proofNotes || ''),
      proofSubmittedAt: updates.proofSubmittedAt !== undefined ? updates.proofSubmittedAt : (existingIssue.proofSubmittedAt || null),
      verifiedAt: updates.verifiedAt !== undefined ? updates.verifiedAt : (existingIssue.verifiedAt || null),
      verifiedBy: updates.verifiedBy !== undefined ? updates.verifiedBy : (existingIssue.verifiedBy || null),
      reopenReason: updates.reopenReason !== undefined ? updates.reopenReason : (existingIssue.reopenReason || ''),
      reopenedAt: updates.reopenedAt !== undefined ? updates.reopenedAt : (existingIssue.reopenedAt || null),
      activityHistory: updates.activityHistory !== undefined
        ? updates.activityHistory
        : (Array.isArray(existingIssue.activityHistory) ? existingIssue.activityHistory : []),
      floorPlanX: Number.isFinite(Number(updates.floorPlanX)) ? updates.floorPlanX : existingIssue.floorPlanX,
      floorPlanY: Number.isFinite(Number(updates.floorPlanY)) ? updates.floorPlanY : existingIssue.floorPlanY,
      floorPlanSnapshotUrl: updates.floorPlanSnapshotUrl || existingIssue.floorPlanSnapshotUrl || '',
      floorPlanSnapshotFileId: updates.floorPlanSnapshotFileId || existingIssue.floorPlanSnapshotFileId || ''
    };

    const newOp = {
      type: 'UPDATE',
      id,
      payload,
      timestamp
    };

    const queue = [...getOfflineQueue(), newOp];
    saveOfflineQueue(queue);

    const updatedList = issues.map(issue => {
      if (issue.id === id) {
        return {
          ...issue,
          ...payload,
          updatedAt: new Date(timestamp).toISOString()
        };
      }
      return issue;
    });
    setIssues(updatedList);
    localStorage.setItem(cacheKey, JSON.stringify(updatedList));

    if (photoBase64) {
      try {
        localStorage.setItem(`jobscan_photo_${id}`, photoBase64);
      } catch (e) {
        console.warn('Failed to cache updated base64 photo locally:', e);
      }
    }

    if (googleToken && activeProject?.folderId) {
      try {
        const { issues: latestRemote } = await loadIssuesVault(googleToken, activeProject.folderId);
        await processAndSyncQueue(latestRemote, issuesDataFileId, updatedContacts);
      } catch {
        // Remains in queue
      }
    } else {
      setSuccess('Issue updated locally. Will sync when online.');
      setTimeout(() => setSuccess(null), 3000);
    }
  };

  // Subcontractor / field mark fixed action (Recorded by Builder on behalf of sub)
  const markIssueFixed = async (id, { proofPhotoFile = null, proofNotes = '' } = {}) => {
    const existingIssue = issues.find(i => i.id === id);
    if (!existingIssue) return;

    let proofPhotoUrl = null;
    let proofPhotoFileId = null;
    let proofPhotoBase64 = null;

    if (proofPhotoFile) {
      const isOnline = !!(googleToken && activeProject?.folderId);
      if (isOnline) {
        setLoading(true);
        try {
          const uploadResult = await uploadIssueProofPhoto(googleToken, activeProject.folderId, proofPhotoFile);
          proofPhotoUrl = uploadResult.url;
          proofPhotoFileId = uploadResult.id;
        } catch (uploadErr) {
          console.error('Failed to upload proof photo immediately:', uploadErr);
          setError('Failed to upload proof photo to Drive, saving locally...');
          proofPhotoBase64 = await fileToBase64(proofPhotoFile);
        } finally {
          setLoading(false);
        }
      } else {
        proofPhotoBase64 = await fileToBase64(proofPhotoFile);
      }
    }

    const timestamp = Date.now();
    const subLabel = existingIssue.contractorName?.trim() || 'subcontractor';
    const proofEvent = {
      id: `act_proof_${timestamp}`,
      action: 'proof_submitted',
      timestamp: new Date(timestamp).toISOString(),
      actor: 'Builder',
      details: `Submitted on behalf of ${subLabel}`,
      note: proofNotes?.trim() || 'Resolution proof submitted'
    };

    const updatedHistory = appendActivityHistoryEvent(existingIssue.activityHistory, proofEvent);

    await updateIssue(id, {
      status: 'in_progress',
      proofPhotoUrl: proofPhotoUrl || existingIssue.proofPhotoUrl,
      proofPhotoFileId: proofPhotoFileId || existingIssue.proofPhotoFileId,
      proofPhotoBase64: proofPhotoBase64 || existingIssue.proofPhotoBase64,
      proofNotes: proofNotes?.trim() || existingIssue.proofNotes,
      proofSubmittedAt: new Date(timestamp).toISOString(),
      activityHistory: updatedHistory
    });
  };

  // Builder verification action (Requires photo proof OR explicit builder inspection record)
  const verifyIssue = async (id, { verifiedBy = 'Builder', inspectionNote = '' } = {}) => {
    const existingIssue = issues.find(i => i.id === id);
    if (!existingIssue) return;

    const hasPhotoProof = Boolean(existingIssue.proofPhotoUrl || existingIssue.proofPhotoBase64);
    if (!hasPhotoProof && !inspectionNote?.trim()) {
      throw new Error('Verification requires a resolution photo or an explicit builder inspection record.');
    }

    const timestamp = Date.now();
    const verifyEvent = {
      id: `act_verified_${timestamp}`,
      action: 'verified_closed',
      timestamp: new Date(timestamp).toISOString(),
      actor: verifiedBy || 'Builder',
      details: hasPhotoProof ? 'Resolution photo inspected and approved' : 'On-site visual inspection verified',
      note: inspectionNote?.trim() || 'Work verified and approved by Builder'
    };

    const updatedHistory = appendActivityHistoryEvent(existingIssue.activityHistory, verifyEvent);

    await updateIssue(id, {
      status: 'resolved',
      verifiedAt: new Date(timestamp).toISOString(),
      verifiedBy: verifiedBy || 'Builder',
      activityHistory: updatedHistory
    });
  };

  // Builder reject / reopen action (Requires mandatory feedback note)
  const reopenIssue = async (id, { reason = '' } = {}) => {
    const trimmedReason = reason?.trim();
    if (!trimmedReason) {
      throw new Error('Rejection requires an explanatory feedback note.');
    }

    const existingIssue = issues.find(i => i.id === id);
    if (!existingIssue) return;

    const timestamp = Date.now();
    const rejectEvent = {
      id: `act_rejected_${timestamp}`,
      action: 'rejected',
      timestamp: new Date(timestamp).toISOString(),
      actor: 'Builder',
      details: 'Fix rejected during inspection',
      note: trimmedReason
    };

    const updatedHistory = appendActivityHistoryEvent(existingIssue.activityHistory, rejectEvent);

    await updateIssue(id, {
      status: 'open',
      reopenReason: trimmedReason,
      reopenedAt: new Date(timestamp).toISOString(),
      activityHistory: updatedHistory
    });
  };

  // Update status action
  const updateIssueStatus = async (id, status) => {
    setError(null);
    const timestamp = Date.now();
    const newOp = {
      type: 'UPDATE_STATUS',
      id,
      payload: { status },
      timestamp
    };

    // Update queue
    const queue = [...getOfflineQueue(), newOp];
    saveOfflineQueue(queue);

    // Optimistic local state update
    const updatedList = issues.map(i => {
      if (i.id === id) {
        return {
          ...i,
          status,
          updatedAt: new Date(timestamp).toISOString()
        };
      }
      return i;
    });
    setIssues(updatedList);
    localStorage.setItem(cacheKey, JSON.stringify(updatedList));

    // Try sync
    if (googleToken && activeProject?.folderId) {
      try {
        const { issues: latestRemote } = await loadIssuesVault(googleToken, activeProject.folderId);
        await processAndSyncQueue(latestRemote, issuesDataFileId);
      } catch {
        // Remains in queue
      }
    }
  };

  // Soft delete action
  const softDeleteIssue = async (id) => {
    setError(null);
    const timestamp = Date.now();
    const newOp = {
      type: 'SOFT_DELETE',
      id,
      timestamp
    };

    // Update queue
    const queue = [...getOfflineQueue(), newOp];
    saveOfflineQueue(queue);

    // Optimistic local state update
    const updatedList = issues.map(i => {
      if (i.id === id) {
        return {
          ...i,
          deletedAt: new Date(timestamp).toISOString(),
          updatedAt: new Date(timestamp).toISOString()
        };
      }
      return i;
    });
    setIssues(updatedList);
    localStorage.setItem(cacheKey, JSON.stringify(updatedList));

    // Try sync
    if (googleToken && activeProject?.folderId) {
      try {
        const { issues: latestRemote } = await loadIssuesVault(googleToken, activeProject.folderId);
        await processAndSyncQueue(latestRemote, issuesDataFileId);
      } catch {
        // Remains in queue
      }
    }
  };

  // Manual trigger sync
  const triggerSync = async () => {
    await loadIssues(true);
  };

  return {
    issues,
    contacts,
    loading,
    syncing,
    error,
    success,
    addIssue,
    updateIssue,
    updateIssueStatus,
    markIssueFixed,
    verifyIssue,
    reopenIssue,
    softDeleteIssue,
    triggerSync
  };
}
