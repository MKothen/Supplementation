// firebase.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { getAuth, GoogleAuthProvider } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyB_3Efs19FZU4pT-WYP1H6x4FoVDgtYvHk",
  authDomain: "supplement-a264a.firebaseapp.com",
  projectId: "supplement-a264a",
  storageBucket: "supplement-a264a.firebasestorage.app",
  messagingSenderId: "514734516251",
  appId: "1:514734516251:web:65939f54a721170216f0be",
  measurementId: "G-SPE594DF8S",
};

export const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
