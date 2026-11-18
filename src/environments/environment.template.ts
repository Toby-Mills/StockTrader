// Copy this file to environment.ts and environment.prod.ts and fill in your Firebase project values.
// Do NOT commit environment.ts or environment.prod.ts (they are gitignored).
export const environment = {
  production: false,
  // reCAPTCHA Enterprise site key for Firebase App Check (required if App Check is enforced for Firebase AI)
  appCheckSiteKey: '',
  firebase: {
    apiKey: 'YOUR_API_KEY',
    authDomain: 'YOUR_PROJECT.firebaseapp.com',
    projectId: 'YOUR_PROJECT_ID',
    storageBucket: 'YOUR_PROJECT.appspot.com',
    messagingSenderId: 'YOUR_SENDER_ID',
    appId: 'YOUR_APP_ID',
  },
};
