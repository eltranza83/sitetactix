import { useEffect, useState, useCallback } from 'react';
import {
  clearGoogleIdentity,
  clearGoogleSession,
  loadStoredAppState,
  persistGoogleToken,
  persistGoogleUser,
  APP_STORAGE_KEYS,
} from '../services/appStorage';
import { getFirebaseAuthInstance, signInToFirebaseWithGooglePopup, signOutFromFirebase } from '../services/firebase';

const GOOGLE_SCOPE = 'https://www.googleapis.com/auth/drive https://www.googleapis.com/auth/spreadsheets email profile';
const GOOGLE_SCOPES = GOOGLE_SCOPE.split(' ');
const GOOGLE_SCRIPT_ID = 'google-gis-script';
const GOOGLE_SCRIPT_SRC = 'https://accounts.google.com/gsi/client';

function getFriendlyAuthError(err) {
  const message = err?.message || err?.error || String(err || '');
  if (!message) return 'Google sign-in was cancelled or failed.';
  if (message.includes('origin_mismatch')) {
    return `Google rejected the sign-in because this origin is not authorized for the OAuth client. Add ${window.location.origin} to the Google Cloud Console Authorized JavaScript origins and redirect URIs, then refresh the page.`;
  }
  if (message.includes('popup')) {
    return 'The sign-in popup was blocked. Please allow popups for this site and try again.';
  }
  if (message.includes('auth/operation-not-allowed') || message.includes('auth/configuration-not-found')) {
    return 'Firebase Google sign-in is not enabled yet. In Firebase Console, enable Authentication > Sign-in method > Google, then try again.';
  }
  return `Google Sign In failed: ${message}`;
}

async function fetchGoogleUserInfo(accessToken) {
  const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` }
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Failed to retrieve Google profile: ${res.status} ${errText}`);
  }

  return await res.json();
}

async function buildSignedInUser(accessToken, firebaseUser = null) {
  const auth = getFirebaseAuthInstance();
  if (!firebaseUser && auth?.authStateReady) {
    await auth.authStateReady();
  }
  const resolvedFirebaseUser = firebaseUser || auth?.currentUser;
  try {
    const info = await fetchGoogleUserInfo(accessToken);
    return {
      ...info,
      firebaseUid: resolvedFirebaseUser?.uid || '',
    };
  } catch (err) {
    console.warn('Could not fetch Google userinfo, using Firebase auth identity:', err);
    if (resolvedFirebaseUser) {
      return {
        email: resolvedFirebaseUser.email,
        name: resolvedFirebaseUser.displayName || 'User',
        picture: resolvedFirebaseUser.photoURL || '',
        firebaseUid: resolvedFirebaseUser.uid,
      };
    }
    throw err;
  }
}

export function useGoogleAuth({ setError, setSuccess, onSignedOut } = {}) {
  const [googleClientId, setGoogleClientId] = useState(() => loadStoredAppState().googleClientId);
  const [googleToken, setGoogleToken] = useState(() => loadStoredAppState().googleToken);
  const [googleUser, setGoogleUser] = useState(() => loadStoredAppState().googleUser);
  const [signingIn, setSigningIn] = useState(false);

  // 1. Firebase Auth listener: Keep user session continuously active from Firebase IndexedDB
  useEffect(() => {
    const auth = getFirebaseAuthInstance();
    if (!auth) return;

    const unsubscribe = auth.onAuthStateChanged((firebaseUser) => {
      if (firebaseUser) {
        const existingStoredUser = loadStoredAppState().googleUser;
        const resolvedUser = {
          email: firebaseUser.email,
          name: firebaseUser.displayName || existingStoredUser?.name || 'User',
          picture: firebaseUser.photoURL || existingStoredUser?.picture || '',
          firebaseUid: firebaseUser.uid,
        };
        setGoogleUser(resolvedUser);
        persistGoogleUser(resolvedUser);
      }
    });

    return () => unsubscribe();
  }, []);

  // 2. Initialize Google Identity Services (GIS) token client
  useEffect(() => {
    const initClient = () => {
      if (!googleClientId || !window.google?.accounts?.oauth2 || window.googleTokenClient) return;

      try {
        const storedUser = loadStoredAppState().googleUser;
        const client = window.google.accounts.oauth2.initTokenClient({
          client_id: googleClientId,
          scope: GOOGLE_SCOPE,
          hint: storedUser?.email || '',
          callback: async (tokenResponse) => {
            if (tokenResponse.access_token) {
              setGoogleToken(tokenResponse.access_token);
              persistGoogleToken(tokenResponse.access_token);
              setError?.(null);

              try {
                const info = await buildSignedInUser(tokenResponse.access_token);
                setGoogleUser(info);
                persistGoogleUser(info);
              } catch (err) {
                console.warn('Quiet user profile update note:', err);
              }
            } else if (tokenResponse.error) {
              console.warn('Silent Google token request note:', tokenResponse.error);
              // CRITICAL: NEVER wipe existing stored token or user session on silent background error
              try {
                const currentStoredToken = localStorage.getItem(APP_STORAGE_KEYS.googleToken);
                if (!currentStoredToken) {
                  setGoogleToken(null);
                }
              } catch (storageErr) {
                console.warn('Safe check of stored token note:', storageErr);
              }
            }
          }
        });
        window.googleTokenClient = client;
        console.log('Google token client pre-initialized successfully.');
      } catch (err) {
        console.error('Failed to pre-initialize GIS token client:', err);
      }
    };

    let script = document.getElementById(GOOGLE_SCRIPT_ID);
    if (!script) {
      script = document.createElement('script');
      script.id = GOOGLE_SCRIPT_ID;
      script.src = GOOGLE_SCRIPT_SRC;
      script.async = true;
      script.defer = true;
      script.onload = initClient;
      document.body.appendChild(script);
    } else {
      initClient();
    }
  }, [googleClientId, setError]);

  const requestDriveAccessToken = useCallback((options = {}) => {
    const user = loadStoredAppState().googleUser;
    const emailHint = user?.email || '';
    if (!window.googleTokenClient) {
      console.warn('Google token client not initialized yet.');
      return;
    }

    try {
      window.googleTokenClient.requestAccessToken({
        hint: emailHint,
        ...(options.interactive === false ? { prompt: 'none' } : { prompt: '' }),
      });
    } catch (err) {
      console.error('Failed to request Google Drive token:', err);
    }
  }, []);

  const signIn = async () => {
    setError?.(null);
    setSigningIn(true);
    try {
      const firebaseResult = await signInToFirebaseWithGooglePopup(GOOGLE_SCOPES);
      const info = await buildSignedInUser(firebaseResult.accessToken, firebaseResult.user);
      setGoogleToken(firebaseResult.accessToken);
      persistGoogleToken(firebaseResult.accessToken);
      setGoogleUser(info);
      persistGoogleUser(info);
      setSuccess?.('Successfully signed in with Google!');
      setTimeout(() => setSuccess?.(null), 3000);
    } catch (err) {
      console.error('Failed to sign in with Google/Firebase:', err);
      setError?.(getFriendlyAuthError(err));
    } finally {
      setSigningIn(false);
    }
  };

  const signOut = async () => {
    setGoogleToken(null);
    setGoogleUser(null);
    clearGoogleSession();
    try {
      await signOutFromFirebase();
    } catch (err) {
      console.warn('Firebase sign out failed:', err);
    }
    onSignedOut?.();
    setSuccess?.('Signed out of Google account.');
    setTimeout(() => setSuccess?.(null), 3000);
  };

  const handleSessionExpired = useCallback((options = {}) => {
    const user = loadStoredAppState().googleUser;
    const emailHint = user?.email || '';
    console.warn('Google Drive token expired. Triggering non-destructive refresh with hint:', emailHint);

    // Only clear the expired Drive token. NEVER wipe the user's project, invite, or Firebase session!
    clearGoogleIdentity();
    setGoogleToken(null);

    try {
      if (window.googleTokenClient) {
        window.googleTokenClient.requestAccessToken({
          hint: emailHint,
          ...(options.interactive === true ? { prompt: '' } : { prompt: 'none' })
        });
      }
    } catch (err) {
      console.warn('Background token refresh attempt note:', err);
    }
  }, []);

  const reconnectGoogleDrive = useCallback((options = {}) => {
    const user = loadStoredAppState().googleUser;
    const emailHint = user?.email || '';
    if (window.googleTokenClient) {
      try {
        window.googleTokenClient.requestAccessToken({
          hint: emailHint,
          prompt: options.interactive === false ? 'none' : ''
        });
        return;
      } catch (err) {
        console.warn('GIS requestAccessToken failed, falling back to popup sign-in:', err);
      }
    }
    // Fallback to signIn popup if GIS client not loaded yet
    signIn();
  }, [signIn]);

  return {
    googleClientId,
    setGoogleClientId,
    googleToken,
    setGoogleToken,
    googleUser,
    signingIn,
    signIn,
    signOut,
    reconnectGoogleDrive,
    handleSessionExpired,
    requestDriveAccessToken,
  };
}
