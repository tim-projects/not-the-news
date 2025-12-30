import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

// Firebase configuration using Vite environment variables.
// Fallback to known working development project credentials if env vars are missing.
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "AIzaSyBcKNWG09QeEAg-TjUXH32hijqIJ06LHcc",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "not-the-news.firebaseapp.com",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "not-the-news",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "not-the-news.firebasestorage.app",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "601666204920",
  appId: import.meta.env.VITE_FIREBASE_APP_ID || "1:601666204920:web:30d37e587bed980087370d"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize Firebase services
export const auth = getAuth(app);
export const db = getFirestore(app);

export default app;
