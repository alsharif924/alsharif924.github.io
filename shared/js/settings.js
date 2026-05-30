import { db } from './firebase-config.js';
import { doc, getDoc, setDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

const HOME_DOC = doc(db, 'settings', 'home');
const LS_KEY = 'homeSettings';
let cachedHome = null;

// Synchronous read of the last-known settings from localStorage. Lets the home
// page apply the correct cover images on first paint, avoiding the flash of the
// hardcoded placeholders while Firestore is still loading.
export function getCachedHomeSettings() {
  if (cachedHome) return cachedHome;
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) cachedHome = JSON.parse(raw);
  } catch (err) {
    /* ignore malformed/unavailable storage */
  }
  return cachedHome;
}

function persist(data) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(data));
  } catch (err) {
    /* storage may be full or unavailable; non-fatal */
  }
}

export async function getHomeSettings({ forceRefresh = false } = {}) {
  if (!forceRefresh && cachedHome) return cachedHome;
  try {
    const snap = await getDoc(HOME_DOC);
    cachedHome = snap.exists() ? snap.data() : {};
    persist(cachedHome);
  } catch (err) {
    console.error('getHomeSettings failed', err);
    cachedHome = {};
  }
  return cachedHome;
}

export async function setHomeCover(field, url) {
  if (!['cover_image', 'cover_video', 'cover_systems'].includes(field)) {
    throw new Error('Invalid cover field: ' + field);
  }
  await setDoc(HOME_DOC, { [field]: url, updatedAt: serverTimestamp() }, { merge: true });
  cachedHome = null;
  try { localStorage.removeItem(LS_KEY); } catch (err) { /* non-fatal */ }
}
