import { getFirebaseDb } from './firebase.js';
import { collection, doc, getDocs, setDoc, deleteDoc, query, where } from 'firebase/firestore/lite';
import { APP_STORAGE_KEYS, getStoredJson, persistProjects } from './appStorage.js';
import { toCanonicalProjectId } from './googleDocsPurchasingService.js';

export function cleanProjectId(rawId) {
  if (!rawId) return 'default_project';
  return String(rawId).replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase();
}

export function normalizeProjectRecord(data, id = null) {
  const name = (data.name || data.projectName || id || 'Untitled Project').trim();
  const canonicalId = data.canonicalId || toCanonicalProjectId(name) || cleanProjectId(id || name);
  const folderId = data.folderId || '';
  const folderName = data.folderName || '';
  const ownerEmail = (data.ownerEmail || '').trim().toLowerCase();
  const ownerUid = (data.ownerUid || '').trim();
  const members = Array.isArray(data.members)
    ? data.members.map((m) => String(m).trim().toLowerCase())
    : (ownerEmail ? [ownerEmail] : []);
  const memberUids = Array.isArray(data.memberUids)
    ? data.memberUids.map((u) => String(u).trim()).filter(Boolean)
    : (ownerUid ? [ownerUid] : []);

  return {
    id: canonicalId,
    canonicalId,
    name,
    folderId,
    folderName,
    ownerEmail,
    ownerUid,
    members,
    memberUids: Array.from(new Set(memberUids)),
    createdAt: data.createdAt || new Date().toISOString(),
    updatedAt: data.updatedAt || new Date().toISOString()
  };
}

export function resolveUserActiveProject(authorizedProjects, preferredActiveId = null) {
  if (!Array.isArray(authorizedProjects) || authorizedProjects.length === 0) {
    return null;
  }
  if (preferredActiveId) {
    const found = authorizedProjects.find(
      (p) => p.id === preferredActiveId || p.canonicalId === preferredActiveId
    );
    if (found) return found;
  }
  // Sort by updatedAt descending so the most recently updated project is selected
  const sorted = [...authorizedProjects].sort((a, b) => {
    const timeA = new Date(a.updatedAt || a.createdAt || 0).getTime();
    const timeB = new Date(b.updatedAt || b.createdAt || 0).getTime();
    return timeB - timeA;
  });
  return sorted[0] || null;
}

export class FirestoreProjectAdapter {
  constructor(db = null) {
    this.db = db;
  }

  _getDb() {
    if (this.db) return this.db;
    if (typeof window !== 'undefined') {
      try {
        return getFirebaseDb();
      } catch (err) {
        console.warn('[FirestoreProjectAdapter] Firebase DB unavailable:', err);
      }
    }
    return null;
  }

  async getProjects(user = null) {
    const database = this._getDb();
    const userEmail = (user?.email || '').trim().toLowerCase();
    const userUid = (user?.uid || user?.firebaseUid || '').trim();

    if (!database || (!userEmail && !userUid)) {
      const cached = getStoredJson(APP_STORAGE_KEYS.projects, []);
      return Array.isArray(cached) ? cached.map((p) => normalizeProjectRecord(p, p.id)) : [];
    }

    try {
      const projectsCol = collection(database, 'projects');
      const itemsMap = new Map();

      // Every user (including admins) discovers only projects where they are an owner or explicit member
      if (userUid) {
        try {
          const memberQuery = query(projectsCol, where('memberUids', 'array-contains', userUid));
          const snap = await getDocs(memberQuery);
          snap.forEach((docSnap) => {
            const norm = normalizeProjectRecord(docSnap.data(), docSnap.id);
            itemsMap.set(norm.id, norm);
          });
        } catch (qErr) {
          console.warn('[FirestoreProjectAdapter] memberUids query error, attempting ownerUid query:', qErr?.message);
        }

        try {
          const ownerQuery = query(projectsCol, where('ownerUid', '==', userUid));
          const snap = await getDocs(ownerQuery);
          snap.forEach((docSnap) => {
            const norm = normalizeProjectRecord(docSnap.data(), docSnap.id);
            itemsMap.set(norm.id, norm);
          });
        } catch {}
      }

      const items = Array.from(itemsMap.values());

      if (items.length > 0) {
        persistProjects(items);
        return items;
      }

      return [];
    } catch (err) {
      console.warn('[FirestoreProjectAdapter] Cloud project fetch failed, using local cache:', err?.message);
      const cached = getStoredJson(APP_STORAGE_KEYS.projects, []);
      return Array.isArray(cached) ? cached.map((p) => normalizeProjectRecord(p, p.id)) : [];
    }
  }

  async saveProject(project, user = null) {
    const userEmail = (user?.email || '').trim().toLowerCase();
    const userUid = (user?.uid || user?.firebaseUid || '').trim();
    const existingMemberUids = Array.isArray(project.memberUids) ? project.memberUids : [];
    const resolvedMemberUids = userUid ? Array.from(new Set([...existingMemberUids, userUid])) : existingMemberUids;

    const norm = normalizeProjectRecord({
      ...project,
      ownerEmail: project.ownerEmail || userEmail,
      ownerUid: project.ownerUid || userUid,
      members: project.members || (userEmail ? [userEmail] : []),
      memberUids: resolvedMemberUids,
      updatedAt: new Date().toISOString()
    }, project.id);

    // Save locally
    const currentList = getStoredJson(APP_STORAGE_KEYS.projects, []);
    const existingIndex = currentList.findIndex((p) => p.id === norm.id);
    let updatedList;
    if (existingIndex >= 0) {
      updatedList = [...currentList];
      updatedList[existingIndex] = norm;
    } else {
      updatedList = [...currentList, norm];
    }
    persistProjects(updatedList);

    const database = this._getDb();
    if (!database) return norm;

    try {
      const docRef = doc(database, 'projects', norm.id);
      await setDoc(docRef, norm, { merge: true });
      return norm;
    } catch (err) {
      console.warn('[FirestoreProjectAdapter] Firestore project save failed:', err?.message);
      return norm;
    }
  }

  async deleteProject(projectId, _user = null) {
    const cleanId = cleanProjectId(projectId);
    const currentList = getStoredJson(APP_STORAGE_KEYS.projects, []);
    const filtered = currentList.filter((p) => p.id !== cleanId && p.id !== projectId);
    persistProjects(filtered);

    const database = this._getDb();
    if (!database) return;

    try {
      const docRef = doc(database, 'projects', cleanId);
      await deleteDoc(docRef);
    } catch (err) {
      console.warn('[FirestoreProjectAdapter] Firestore project delete failed:', err?.message);
    }
  }
}

export const defaultProjectAdapter = new FirestoreProjectAdapter();

export async function fetchUserProjects(user = null) {
  return await defaultProjectAdapter.getProjects(user);
}

export async function saveUserProject(project, user = null) {
  return await defaultProjectAdapter.saveProject(project, user);
}

export async function deleteUserProject(projectId, user = null) {
  return await defaultProjectAdapter.deleteProject(projectId, user);
}

