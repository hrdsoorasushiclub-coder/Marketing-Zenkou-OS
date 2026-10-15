// Service worker pengingat. Menerima pesan dari FCM saat web ditutup, lalu menampilkan notifikasi + getar.
// Pesan dikirim data-only (lihat netlify/functions/lib/push.mjs) supaya tampilannya dikendalikan di sini.
importScripts("https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js");

// Sama dengan js/config.js (kunci web Firebase memang publik).
firebase.initializeApp({
  apiKey: "AIzaSyCZoUUNtqL18la85zuAgKtPZRE7VM8pQBk",
  authDomain: "supervisi-medsos.firebaseapp.com",
  projectId: "supervisi-medsos",
  storageBucket: "supervisi-medsos.firebasestorage.app",
  messagingSenderId: "835443367080",
  appId: "1:835443367080:web:a8a855053663a40cf1f69d",
});

const VIBRATE = [300, 120, 300, 120, 500];

firebase.messaging().onBackgroundMessage((payload) => {
  const d = payload.data || {};
  return self.registration.showNotification(d.title || "Zenkou Marketing OS", {
    body: d.body || "",
    icon: "/icons/icon-192.png",
    badge: "/icons/badge-96.png",
    tag: d.tag || "zenkou-reminder",
    renotify: true,          // tag sama tetap bunyi/getar lagi
    requireInteraction: true,
    vibrate: VIBRATE,
    timestamp: Date.now(),
    data: { url: d.url || "/#/jobs" },
  });
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || "/#/jobs", self.location.origin).href;
  event.waitUntil((async () => {
    const wins = await clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const w of wins) {
      if (new URL(w.url).origin === self.location.origin) { await w.focus(); if ("navigate" in w) await w.navigate(url).catch(() => {}); return; }
    }
    await clients.openWindow(url);
  })());
});
