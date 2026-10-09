const ENV = import.meta.env || {};

export const APP_VERSION = ENV.VITE_APP_VERSION || '1.7.9';
export const APP_BUILD_LABEL = ENV.VITE_APP_BUILD_LABEL || `v${APP_VERSION}`;
export const APP_RELEASE_NAME = ENV.VITE_APP_RELEASE_NAME || 'Logo fixed';

export const DEFAULT_FIREBASE_CONFIG = {
  apiKey: ENV.VITE_FIREBASE_API_KEY || 'AIzaSyDjYPPkW8ffQMOCByCo9gMlVxQ8PsMpAoU',
  projectId: ENV.VITE_FIREBASE_PROJECT_ID || 'adepec-scanner-invites',
  appId: ENV.VITE_FIREBASE_APP_ID || '1:256926375840:web:1dfab80a93a0f9cfa9cec5',
};

export const DEFAULT_GOOGLE_CLIENT_ID =
  ENV.VITE_GOOGLE_CLIENT_ID ||
  '523814311929-lku3c1m2rq4qpmbf1earpgnm1beuvq8m.apps.googleusercontent.com';


export const DEFAULT_ADMIN_EMAILS = [
  'adepecgroup@gmail.com'
];

export function isBuiltInAdmin(email) {
  if (!email) return false;
  const clean = String(email).trim().toLowerCase();
  return DEFAULT_ADMIN_EMAILS.includes(clean);
}
