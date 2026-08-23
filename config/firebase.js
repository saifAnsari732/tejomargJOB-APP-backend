const { initializeApp, getApps, cert } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
if (!getApps().length) {
  initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    }),
  });
}

const { getAuth } = require('firebase-admin/auth');
const { getStorage } = require('firebase-admin/storage');

const db = getFirestore();
const adminAuth = getAuth();
const bucket = getStorage().bucket(process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || 'tejomart-trade.firebasestorage.app');

module.exports = { db, FieldValue, adminAuth, bucket };
