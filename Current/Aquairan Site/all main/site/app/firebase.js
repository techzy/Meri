import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";
// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyDGkS_POLB2we4fWnTf8ZA_M596pGTnyKs",
  authDomain: "site-annotator-56bf2.firebaseapp.com",
  projectId: "site-annotator-56bf2",
  storageBucket: "site-annotator-56bf2.firebasestorage.app",
  messagingSenderId: "449444077912",
  appId: "1:449444077912:web:78120bff30ce61220a052d",
  measurementId: "G-G56T98G2JK"
};


// firebase.js



const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const storage = getStorage(app);