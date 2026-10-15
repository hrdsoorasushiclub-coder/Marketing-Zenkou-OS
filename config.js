// Tempel konfigurasi Firebase kamu di sini (lihat TUTORIAL-FIREBASE.md, langkah 4).
// Selama apiKey masih "ISI_DI_SINI", web berjalan dalam MODE DEMO:
// data tersimpan di browser saja, tanpa login sungguhan.

export const firebaseConfig = {
  apiKey: "AIzaSyCZoUUNtqL18la85zuAgKtPZRE7VM8pQBk",
  authDomain: "supervisi-medsos.firebaseapp.com",
  projectId: "supervisi-medsos",
  storageBucket: "supervisi-medsos.firebasestorage.app",
  messagingSenderId: "835443367080",
  appId: "1:835443367080:web:a8a855053663a40cf1f69d",
};

// Kunci publik Web Push: Firebase Console > Project settings > Cloud Messaging > Web Push certificates > Generate key pair.
// Selama masih kosong, tombol "Aktifkan pengingat" tidak muncul.
export const vapidKey = "BPD5h90CTV1F2w4ZzP8uRfUZ3S0W9cqM8DHbcaZww-2g_pIIpgua1FcctgryN8aHHXUDXMvItI8jZMm_ow_5FYc";

export const isConfigured = () =>
  !!firebaseConfig.apiKey && !String(firebaseConfig.apiKey).startsWith("ISI");