self.addEventListener("install", event => {
  console.log("Service Worker installiert");
});

self.addEventListener("fetch", event => {
  // Standard: einfach alles normal laden
});
