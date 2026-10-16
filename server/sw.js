/* Service worker for the self-hosted PSPO course: offline shell + Google Fonts cache.
   Every URL is resolved against the registration scope, so the site works under a path prefix. */
"use strict";

var CACHE = "pspo-v1";
var NETWORK_TIMEOUT_MS = 4000;
var PRECACHE = ["./", "runtime.js", "manifest.webmanifest",
                "icon-192.png", "icon-512.png", "icon-maskable-512.png"];
var FONT_HOSTS = ["fonts.googleapis.com", "fonts.gstatic.com"];

function scoped(path) {
  return new URL(path, self.registration.scope).href;
}

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE)
      .then(function (cache) { return cache.addAll(PRECACHE.map(scoped)); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys()
      .then(function (keys) {
        return Promise.all(keys.filter(function (k) { return k !== CACHE; })
                               .map(function (k) { return caches.delete(k); }));
      })
      .then(function () { return self.clients.claim(); })
  );
});

function cacheFirst(request) {
  return caches.open(CACHE).then(function (cache) {
    return cache.match(request).then(function (hit) {
      if (hit) return hit;
      return fetch(request).then(function (res) {
        // Cross-origin font responses may be opaque (status 0); cache them anyway.
        if (res.ok || res.type === "opaque") cache.put(request, res.clone());
        return res;
      });
    });
  });
}

function withTimeout(promise, ms) {
  return new Promise(function (resolve, reject) {
    var timer = setTimeout(function () { reject(new Error("timeout")); }, ms);
    promise.then(function (v) { clearTimeout(timer); resolve(v); },
                 function (e) { clearTimeout(timer); reject(e); });
  });
}

function networkFirst(request) {
  var navigate = request.mode === "navigate";
  return caches.open(CACHE).then(function (cache) {
    return withTimeout(fetch(request), NETWORK_TIMEOUT_MS).then(function (res) {
      if (res.ok) cache.put(request, res.clone());
      return res;
    }).catch(function (err) {
      return cache.match(request, { ignoreSearch: navigate }).then(function (hit) {
        if (hit) return hit;
        if (navigate) {
          return cache.match(scoped("./"), { ignoreSearch: true }).then(function (shell) {
            if (shell) return shell;
            throw err;
          });
        }
        throw err;
      });
    });
  });
}

self.addEventListener("fetch", function (event) {
  var request = event.request;
  if (request.method !== "GET") return;
  var url = new URL(request.url);

  if (url.origin === self.location.origin) {
    if (url.pathname.indexOf("/api/") !== -1) return; // network only, never cached
    event.respondWith(networkFirst(request));
  } else if (FONT_HOSTS.indexOf(url.hostname) !== -1) {
    event.respondWith(cacheFirst(request));
  }
});
