import { initializeApp, getApp, getApps } from 'firebase/app';
import { 
  getAuth, 
  GoogleAuthProvider, 
  signInWithPopup, 
  signOut 
} from 'firebase/auth';
import { getFirestore } from 'firebase/firestore/lite';
import { DEFAULT_FIREBASE_CONFIG } from '../config/appConfig.js';

let cachedAuthInstance = null;

/**
 * Gets or initializes the Firebase app with the built-in project settings.
 */
function getFirebaseAppInstance() {
  const { apiKey, projectId, appId } = DEFAULT_FIREBASE_CONFIG;

  if (!apiKey || !projectId) {
    return null;
  }

  const firebaseConfig = {
    apiKey,
    authDomain: `${projectId}.firebaseapp.com`,
    projectId,
    storageBucket: `${projectId}.appspot.com`,
    messagingSenderId: '',
    appId
  };

  try {
    if (getApps().length === 0) {
      return initializeApp(firebaseConfig);
    }
    return getApp();
  } catch (err) {
    console.error('Failed to initialize Firebase app:', err);
    return null;
  }
}

export function getFirebaseDb() {
  const app = getFirebaseAppInstance();
  return app ? getFirestore(app) : null;
}

export function getFirebaseAuthInstance() {
  const app = getFirebaseAppInstance();
  if (!app) return null;
  if (cachedAuthInstance) return cachedAuthInstance;

  cachedAuthInstance = getAuth(app);
  return cachedAuthInstance;
}

export async function signInToFirebaseWithGooglePopup(scopes = []) {
  const auth = getFirebaseAuthInstance();
  if (!auth) {
    throw new Error('Firebase is not configured.');
  }

  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  scopes.forEach((scope) => provider.addScope(scope));
  const result = await signInWithPopup(auth, provider);
  const credential = GoogleAuthProvider.credentialFromResult(result);

  if (!credential?.accessToken) {
    throw new Error('Google did not return the permissions token required for Drive access.');
  }

  return {
    user: result.user,
    accessToken: credential.accessToken,
  };
}

export async function signOutFromFirebase() {
  const auth = getFirebaseAuthInstance();
  if (!auth) return;
  await signOut(auth);
}
