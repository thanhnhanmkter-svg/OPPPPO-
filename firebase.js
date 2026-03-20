// ═══════════════════════════════════════════════════════════════
//  firebase.js  —  OPPO Birthday Mosaic
//  Khởi tạo Firebase App, export các helpers để App.jsx sử dụng
// ═══════════════════════════════════════════════════════════════

import { initializeApp }                          from "firebase/app";
import { getFirestore, doc, setDoc,
         onSnapshot, collection,
         serverTimestamp }                         from "firebase/firestore";
import { getStorage, ref,
         uploadBytesResumable, getDownloadURL }    from "firebase/storage";

// ── 1. Firebase project config ───────────────────────────────
const firebaseConfig = {
  apiKey:            "AIzaSyDDOUlBnZfaX96amF5I69Yw-r-bOWjoUpg",
  authDomain:        "appo-93547.firebaseapp.com",
  projectId:         "appo-93547",
  storageBucket:     "appo-93547.firebasestorage.app",
  messagingSenderId: "1076518997279",
  appId:             "1:1076518997279:web:34a2d4a8fbb9e7fdf6b42a",
  measurementId:     "G-T757P7VBNH",
};

// ── 2. Init ───────────────────────────────────────────────────
const app     = initializeApp(firebaseConfig);
const db      = getFirestore(app);
const storage = getStorage(app);

// ── 3. Firestore helpers ──────────────────────────────────────

/**
 * Tên collection chứa toàn bộ pixels.
 * Mỗi document = 1 pixel, id = "row-col" (vd: "3-7")
 */
export const PIXELS_COLLECTION = "oppo_pixels";

/**
 * Lắng nghe realtime toàn bộ collection pixels.
 * Trả về unsubscribe function để cleanup.
 *
 * @param {(pixels: Object) => void} onUpdate  — callback nhận map { "r-c": pixelData }
 * @returns {Function} unsubscribe
 */
export function subscribeToPixels(onUpdate) {
  const colRef = collection(db, PIXELS_COLLECTION);
  return onSnapshot(colRef, (snapshot) => {
    const map = {};
    snapshot.forEach((docSnap) => {
      map[docSnap.id] = docSnap.data();
    });
    onUpdate(map);
  });
}

/**
 * Lưu/cập nhật metadata của một pixel vào Firestore.
 *
 * @param {string} key      — "row-col"  vd "3-7"
 * @param {Object} payload  — { state, imageUrl, name, wish, uploadedAt }
 */
export async function savePixelToFirestore(key, payload) {
  const docRef = doc(db, PIXELS_COLLECTION, key);
  await setDoc(docRef, {
    ...payload,
    uploadedAt: serverTimestamp(),
  }, { merge: true });
}

// ── 4. Storage helpers ────────────────────────────────────────

/**
 * Upload ảnh (dataURL) lên Firebase Storage.
 * Path: mosaic_images/{key}_{timestamp}.jpg
 *
 * @param {string} key        — pixel key "row-col"
 * @param {string} dataURL    — base64 data URL từ FileReader
 * @param {(pct: number) => void} onProgress  — callback % tiến độ upload (0-100)
 * @returns {Promise<string>} downloadURL
 */
export async function uploadImageToStorage(key, dataURL, onProgress) {
  // Chuyển dataURL → Blob
  const res   = await fetch(dataURL);
  const blob  = await res.blob();

  const ext       = blob.type === "image/png" ? "png" : "jpg";
  const timestamp = Date.now();
  const path      = `mosaic_images/${key}_${timestamp}.${ext}`;
  const storageRef = ref(storage, path);

  return new Promise((resolve, reject) => {
    const task = uploadBytesResumable(storageRef, blob, {
      contentType: blob.type,
      customMetadata: { pixelKey: key },
    });

    task.on(
      "state_changed",
      (snap) => {
        const pct = Math.round((snap.bytesTransferred / snap.totalBytes) * 100);
        onProgress?.(pct);
      },
      (err) => reject(err),
      async () => {
        const url = await getDownloadURL(task.snapshot.ref);
        resolve(url);
      }
    );
  });
}

export { db, storage };
