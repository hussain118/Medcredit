import { 
  collection, 
  doc, 
  getDoc, 
  getDocs, 
  setDoc, 
  deleteDoc, 
  getFirestore 
} from 'firebase/firestore';
import { initializeApp, getApp, getApps } from 'firebase/app';
import firebaseConfig from '../firebase-applet-config.json';
import { auth } from './auth';
import { AppRecord, AppSettings } from './types';

// Obtain initialized Firebase app or initialize it safely
const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
export const db = getFirestore(app);

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData?.map(provider => ({
        providerId: provider.providerId,
        email: provider.email,
      })) || []
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

/**
 * Load user settings from Firestore.
 */
export async function loadSettingsFromFirebase(userId: string): Promise<AppSettings | null> {
  const path = `users/${userId}/settings/app`;
  try {
    const docRef = doc(db, path);
    const docSnap = await getDoc(docRef);
    if (docSnap.exists()) {
      return docSnap.data() as AppSettings;
    }
    return null;
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
    return null;
  }
}

/**
 * Save user settings to Firestore.
 */
export async function saveSettingsToFirebase(userId: string, settings: AppSettings): Promise<void> {
  const path = `users/${userId}/settings/app`;
  try {
    const docRef = doc(db, path);
    await setDoc(docRef, settings, { merge: true });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

/**
 * Load all ledger records for the authenticated user from Firestore.
 */
export async function loadRecordsFromFirebase(userId: string): Promise<AppRecord[]> {
  const path = `users/${userId}/records`;
  try {
    const querySnapshot = await getDocs(collection(db, path));
    const records: AppRecord[] = [];
    querySnapshot.forEach((doc) => {
      records.push(doc.data() as AppRecord);
    });
    // Sort by date descending (standard behavior)
    return records.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
    return [];
  }
}

/**
 * Save or update a single ledger record in Firestore.
 */
export async function saveRecordToFirebase(userId: string, record: AppRecord): Promise<void> {
  const path = `users/${userId}/records/${record.id}`;
  try {
    const docRef = doc(db, path);
    await setDoc(docRef, record);
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

/**
 * Delete a single ledger record from Firestore.
 */
export async function deleteRecordFromFirebase(userId: string, recordId: string): Promise<void> {
  const path = `users/${userId}/records/${recordId}`;
  try {
    const docRef = doc(db, path);
    await deleteDoc(docRef);
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}
