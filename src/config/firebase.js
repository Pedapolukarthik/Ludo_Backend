const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');

let firebaseInitialized = false;

const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
let serviceAccount;

if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
  try {
    serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
  } catch (error) {
    console.error('Failed to parse FIREBASE_SERVICE_ACCOUNT_JSON env variable:', error.message);
  }
} else if (serviceAccountPath && fs.existsSync(path.resolve(serviceAccountPath))) {
  try {
    serviceAccount = require(path.resolve(serviceAccountPath));
  } catch (error) {
    console.error('Failed to load Firebase service account file:', error.message);
  }
}

if (serviceAccount) {
  try {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
    console.log('Firebase Admin SDK initialized successfully.');
    firebaseInitialized = true;
  } catch (error) {
    console.error('Failed to initialize Firebase Admin with credentials:', error.message);
  }
} else {
  console.warn('WARNING: Firebase Service Account credentials not configured. Authentication fallback mock mode will be enabled for development.');
}

/**
 * Verifies a Firebase ID token. Fallbacks to parsing base64 if not initialized.
 * @param {string} idToken 
 * @returns {Promise<Object>} User data from token
 */
async function verifyFirebaseToken(idToken) {
  if (firebaseInitialized) {
    try {
      const decodedToken = await admin.auth().verifyIdToken(idToken);
      return {
        uid: decodedToken.uid,
        email: decodedToken.email,
        name: decodedToken.name || decodedToken.email.split('@')[0],
        avatar: decodedToken.picture || 'https://api.dicebear.com/7.x/pixel-art/svg'
      };
    } catch (error) {
      console.error('Firebase token verification failed:', error.message);
      throw new Error('Invalid Firebase Token');
    }
  } else {
    // Fallback Mock Mode: Decode JWT-like client tokens or return dummy profile.
    console.log('Using Mock Firebase Verification (Development Only)');
    if (idToken.startsWith('mock_')) {
      const parts = idToken.split('_');
      const email = `${parts[1] || 'user'}@example.com`;
      const name = parts[1] ? parts[1].charAt(0).toUpperCase() + parts[1].slice(1) : 'Mock User';
      return {
        uid: idToken,
        email: email,
        name: name,
        avatar: `https://api.dicebear.com/7.x/pixel-art/svg?seed=${name}`
      };
    }
    
    // Try to decode JWT for local development testing with real Google Account
    try {
      const decoded = jwt.decode(idToken);
      if (decoded && (decoded.email || decoded.sub)) {
        return {
          uid: decoded.sub || decoded.uid || decoded.user_id || 'mock_uid_' + Math.random().toString(36).substring(2, 9),
          email: decoded.email || 'mock_user@example.com',
          name: decoded.name || decoded.email?.split('@')[0] || 'Mock User',
          avatar: decoded.picture || `https://api.dicebear.com/7.x/pixel-art/svg?seed=${decoded.email || 'mock'}`
        };
      }
    } catch (e) {
      console.warn('Failed to decode JWT token in verifyFirebaseToken fallback:', e.message);
    }
    
    throw new Error('Firebase SDK not initialized and mock token prefix "mock_" not used.');
  }
}

module.exports = {
  verifyFirebaseToken,
  isFirebaseAvailable: () => firebaseInitialized
};
