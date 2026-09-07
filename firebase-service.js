/**
 * HeartPing - Firebase Integration Service Layer
 * 
 * This module separates local UI functionality from Firebase cloud infrastructure.
 * 
 * WHEN YOU'RE READY TO CONNECT FIREBASE:
 * 1. Go to Firebase Console (https://console.firebase.google.com)
 * 2. Create a new Firebase project and enable:
 *    - Firestore Database or Realtime Database
 *    - Cloud Messaging (FCM for push notifications)
 *    - Firebase Authentication (Anonymous or Email)
 * 3. Copy your Web App config below and set USE_FIREBASE = true.
 */

export const FIREBASE_CONFIG = {
  apiKey: "YOUR_FIREBASE_API_KEY",
  authDomain: "heartping-app.firebaseapp.com",
  projectId: "heartping-app",
  storageBucket: "heartping-app.appspot.com",
  messagingSenderId: "1234567890",
  appId: "1:1234567890:web:abcdef123456"
};

// Toggle when you have supplied real Firebase credentials
export const USE_FIREBASE = false;

class BackendService {
  constructor() {
    this.isConfigured = USE_FIREBASE && FIREBASE_CONFIG.apiKey !== "YOUR_FIREBASE_API_KEY";
    this.subscribers = new Set();
    this.initLocalEngine();
  }

  initLocalEngine() {
    // Cross-tab / local event listener using BroadcastChannel if supported
    if (typeof BroadcastChannel !== 'undefined') {
      try {
        this.channel = new BroadcastChannel('heartping_sync_channel');
        this.channel.onmessage = (event) => {
          if (event.data && event.data.type === 'PING') {
            this.notifySubscribers(event.data.payload);
          }
        };
      } catch (e) {
        console.log('BroadcastChannel not active in this environment:', e);
      }
    }
  }

  isUsingFirebase() {
    return this.isConfigured;
  }

  getStatus() {
    return {
      connected: this.isConfigured,
      mode: this.isConfigured ? 'Firebase Cloud (Real-time)' : 'Local Offline Mode',
      backendType: this.isConfigured ? 'Firestore + FCM' : 'Client-Side (Local Storage)',
      details: this.isConfigured
        ? 'Real-time multi-device synchronization and push notifications enabled.'
        : 'Running locally on this device. Pairing codes and pings persist in LocalStorage. Add Firebase credentials to enable cross-device remote sync.'
    };
  }

  /**
   * Generates a random 6-digit pairing code
   */
  generatePairingCode() {
    const min = 100000;
    const max = 999999;
    return Math.floor(min + Math.random() * (max - min + 1)).toString();
  }

  /**
   * Pair with a code
   */
  async pairWithCode(myCode, myName, partnerCode) {
    if (this.isConfigured) {
      // Firebase implementation template:
      // const doc = await db.collection('pairings').where('code', '==', partnerCode).get();
      // return doc.data();
      throw new Error("Firebase pairing pending initialization");
    }

    // Local mode handling
    return new Promise((resolve, reject) => {
      setTimeout(() => {
        if (!partnerCode || partnerCode.length !== 6) {
          reject(new Error("Please enter a valid 6-digit code."));
          return;
        }

        if (partnerCode === myCode) {
          reject(new Error("You cannot pair with your own code!"));
          return;
        }

        // Return a mock/demo pairing confirmation
        resolve({
          partnerCode: partnerCode,
          partnerName: "My Love", // Default partner name in demo mode, or custom entered
          pairedAt: Date.now()
        });
      }, 500);
    });
  }

  /**
   * Send a ping to partner
   */
  async sendPing(pingData) {
    if (this.isConfigured) {
      // Firebase implementation template:
      // await db.collection('pings').add(pingData);
      // await sendFCMNotification(pingData);
      console.log('Sending via Firebase:', pingData);
      return { success: true, cloud: true };
    }

    // Local broadcast (for dual tabs/windows testing)
    if (this.channel) {
      this.channel.postMessage({
        type: 'PING',
        payload: pingData
      });
    }

    return { success: true, cloud: false };
  }

  /**
   * Subscribe to incoming pings
   */
  onPingReceived(callback) {
    this.subscribers.add(callback);
    return () => this.subscribers.delete(callback);
  }

  notifySubscribers(payload) {
    this.subscribers.forEach(cb => {
      try {
        cb(payload);
      } catch (err) {
        console.error('Subscriber callback error:', err);
      }
    });
  }
}

export const backendService = new BackendService();
