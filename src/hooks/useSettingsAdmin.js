import { useEffect, useState } from 'react';
import { collection, deleteDoc, doc, getDoc, getDocs, setDoc } from 'firebase/firestore/lite';
import { getFirebaseAuthInstance, getFirebaseDb } from '../services/firebase';
import { isBuiltInAdmin } from '../config/appConfig';
import { confirmAction } from '../services/confirmAction';

export function useSettingsAdmin({ setError, setSuccess }) {
  const [isAdminUnlocked, setIsAdminUnlocked] = useState(false);
  const [checkingAdmin, setCheckingAdmin] = useState(false);
  const [showAdminPanel, setShowAdminPanel] = useState(false);
  const [invites, setInvites] = useState([]);
  const [loadingInvites, setLoadingInvites] = useState(false);

  const fetchInvitesList = async () => {
    const db = getFirebaseDb();
    if (!db) return;
    setLoadingInvites(true);
    try {
      const snapshot = await getDocs(collection(db, 'invites'));
      const list = [];
      snapshot.forEach((invite) => {
        if (invite.id !== 'CONFIG-GEMINI') list.push({ id: invite.id, ...invite.data() });
      });
      list.sort((a, b) => {
        const timeA = a.createdAt?.toDate ? a.createdAt.toDate() : 0;
        const timeB = b.createdAt?.toDate ? b.createdAt.toDate() : 0;
        return timeB - timeA;
      });
      setInvites(list);
    } catch (err) {
      console.error('Failed to fetch invites:', err);
      setError('Unable to load invite codes for this administrator.');
    } finally {
      setLoadingInvites(false);
    }
  };

  useEffect(() => {
    const db = getFirebaseDb();
    const auth = getFirebaseAuthInstance();

    const verifyAdmin = async (user) => {
      if (!user?.email) {
        setIsAdminUnlocked(false);
        return;
      }

      if (isBuiltInAdmin(user.email)) {
        setIsAdminUnlocked(true);
        setError(null);
        await fetchInvitesList();
        return;
      }

      if (!db) {
        setIsAdminUnlocked(false);
        return;
      }

      setCheckingAdmin(true);
      try {
        const adminSnap = await getDoc(doc(db, 'admins', user.email.toLowerCase()));
        const isUnlocked = adminSnap.exists();
        setIsAdminUnlocked(isUnlocked);
        if (isUnlocked) {
          setError(null);
          await fetchInvitesList();
        }
      } catch (err) {
        console.error('Failed to verify administrator:', err);
        setIsAdminUnlocked(false);
      } finally {
        setCheckingAdmin(false);
      }
    };

    const initialUser = auth?.currentUser;
    if (initialUser) {
      verifyAdmin(initialUser);
    }

    const unsubscribe = auth?.onAuthStateChanged ? auth.onAuthStateChanged((user) => {
      verifyAdmin(user);
    }) : null;

    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, []);

  const handleGenerateInvite = async () => {
    const db = getFirebaseDb();
    if (!db || !isAdminUnlocked) return;
    setError(null);
    setSuccess(null);
    try {
      const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ012345689';
      const genPart = () => Array.from({ length: 4 }, () => chars.charAt(Math.floor(Math.random() * chars.length))).join('');
      const code = `ADPC-${genPart()}-${genPart()}`;
      const authUser = getFirebaseAuthInstance()?.currentUser;

      await setDoc(doc(db, 'invites', code), {
        used: false,
        createdAt: new Date(),
        usedAt: null,
        createdByUid: authUser?.uid || null,
        createdByEmail: authUser?.email || null
      });

      setSuccess(`Generated invite code: ${code}`);
      await fetchInvitesList();
      setTimeout(() => setSuccess(null), 5000);
    } catch (err) {
      console.error(err);
      setError('Failed to generate invite code.');
    }
  };

  const handleShareInvite = async (code) => {
    const inviteLink = `${window.location.origin}?code=${code}`;
    const message = `SiteTactix by Adepec Homes invite:\n\n${inviteLink}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: 'SiteTactix by Adepec Homes Invite', text: message, url: inviteLink });
      } else {
        await navigator.clipboard.writeText(message);
        setSuccess('Invite details copied to clipboard.');
        setTimeout(() => setSuccess(null), 4000);
      }
    } catch (err) {
      if (err?.name !== 'AbortError') setError('Failed to share the invite.');
    }
  };

  const handleDeleteInvite = async (code) => {
    const db = getFirebaseDb();
    if (!db || !isAdminUnlocked) return;
    if (!(await confirmAction({ title: 'Delete this invite code?', message: `${code} will stop working.`, confirmLabel: 'Delete code' }))) return;
    try {
      await deleteDoc(doc(db, 'invites', code));
      setSuccess(`Deactivated invite code: ${code}`);
      await fetchInvitesList();
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      console.error(err);
      setError('Failed to deactivate invite code.');
    }
  };

  return {
    checkingAdmin,
    invites,
    isAdminUnlocked,
    loadingInvites,
    showAdminPanel,
    setShowAdminPanel,
    handleDeleteInvite,
    handleGenerateInvite,
    handleShareInvite
  };
}
