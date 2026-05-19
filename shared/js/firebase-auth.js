import { auth } from './firebase-config.js';
import {
  onAuthStateChanged,
  signOut as fbSignOut,
  GoogleAuthProvider,
  signInWithPopup,
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';

export const ALLOWED  = ['ali.s23ultra.1@gmail.com', 'faresayman12316@gmail.com', 'ali.d.sh.2001@gmail.com'];
export const LOGIN_URL = '/pages/manager/login/';
export const DASH_URL  = '/pages/manager/dashboard/';

export function requireAuth(onReady) {
  document.body.style.visibility = 'hidden';
  onAuthStateChanged(auth, user => {
    if (!user || !ALLOWED.includes(user.email)) {
      window.location.replace(LOGIN_URL);
    } else {
      document.body.style.visibility = '';
      onReady?.();
    }
  });
}

export async function signOut() {
  await fbSignOut(auth);
  window.location.replace(LOGIN_URL);
}

export async function signInWithGoogle() {
  const provider = new GoogleAuthProvider();
  const { user } = await signInWithPopup(auth, provider);
  return user;
}

export { auth, onAuthStateChanged };
