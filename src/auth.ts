import { initializeApp } from 'firebase/app';
import { getAuth, signInWithPopup, GoogleAuthProvider, onAuthStateChanged, User, signOut } from 'firebase/auth';
import firebaseConfig from '../firebase-applet-config.json';

// Initialize Firebase
const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

// Cache the access token in memory and local storage for persistence
let cachedAccessToken: string | null = localStorage.getItem('google_access_token');
let isSigningIn = false;

// Initialize auth state listener. Call this on app load.
export const initAuth = (
  onAuthSuccess?: (user: User, token: string | null) => void,
  onAuthFailure?: () => void
) => {
  return onAuthStateChanged(auth, async (user: User | null) => {
    if (user) {
      // If we have a user, they are logged in! Provide the cached token if available.
      if (onAuthSuccess) {
        onAuthSuccess(user, cachedAccessToken);
      }
    } else {
      cachedAccessToken = null;
      localStorage.removeItem('google_access_token');
      if (onAuthFailure) onAuthFailure();
    }
  });
};

// Must be called from a button click or user interaction
export const googleSignIn = async (requestSheetsScope = false): Promise<{ user: User; accessToken: string | null } | null> => {
  try {
    isSigningIn = true;
    const provider = new GoogleAuthProvider();
    if (requestSheetsScope) {
      provider.addScope('https://www.googleapis.com/auth/spreadsheets');
    }
    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    
    const token = credential?.accessToken || null;
    if (token) {
      cachedAccessToken = token;
      localStorage.setItem('google_access_token', token);
    } else if (requestSheetsScope) {
      console.warn('No Google Sheets access token retrieved during login.');
    }

    return { user: result.user, accessToken: token };
  } catch (error: any) {
    console.error('Sign in error:', error);
    throw error;
  } finally {
    isSigningIn = false;
  }
};

export const getAccessToken = async (): Promise<string | null> => {
  if (!cachedAccessToken) {
    cachedAccessToken = localStorage.getItem('google_access_token');
  }
  return cachedAccessToken;
};

export const logout = async () => {
  await signOut(auth);
  cachedAccessToken = null;
  localStorage.removeItem('google_access_token');
};
