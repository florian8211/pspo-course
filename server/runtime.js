/* Self-hosted runtime for the PSPO course. Loaded before the engine by serve.py.
   Provides window.claude.use(name) backed by /api/sample and /api/db, and registers sw.js. */
(function () {
  "use strict";

  function fail(message) {
    return { code: "error", message: message };
  }

  function sample(prompt, opts) {
    var onText = opts && typeof opts.onText === "function" ? opts.onText : null;
    var body = { prompt: prompt };
    if (opts && opts.modelTier != null) body.modelTier = opts.modelTier;

    return fetch("api/sample", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    }).then(function (res) {
      if (res.status === 429) throw { code: "rate_limited" };
      if (!res.ok || !res.body) throw fail("HTTP " + res.status);

      var reader = res.body.getReader();
      var decoder = new TextDecoder();
      var buffer = "";
      var text = "";

      function handle(line) {
        if (!line.trim()) return null;
        var msg;
        try { msg = JSON.parse(line); } catch (e) { throw fail("bad stream line"); }
        if (typeof msg.t === "string") {
          text += msg.t;
          if (onText) onText({ text: text });
          return null;
        }
        if (msg.error) throw fail(String(msg.error));
        if (msg.done) return { text: typeof msg.text === "string" ? msg.text : text };
        return null;
      }

      function pump() {
        return reader.read().then(function (chunk) {
          if (chunk.done) {
            buffer += decoder.decode();
            var last = handle(buffer);
            if (last) return last;
            throw fail("stream ended early");
          }
          buffer += decoder.decode(chunk.value, { stream: true });
          var nl;
          while ((nl = buffer.indexOf("\n")) >= 0) {
            var line = buffer.slice(0, nl);
            buffer = buffer.slice(nl + 1);
            var out = handle(line);
            if (out) {
              reader.cancel().catch(function () {});
              return out;
            }
          }
          return pump();
        });
      }
      return pump();
    }, function (err) {
      throw fail(err && err.message ? err.message : "network error");
    });
  }

  function dbUrl(path) {
    return "api/db?path=" + encodeURIComponent(path);
  }

  // Offline-safe progress: a doc is kept under PENDING + path until the server has
  // accepted it, so the engine's boot-time merge never reverts offline progress.
  var PENDING = "pspo.pending:";

  function readPending(path) {
    try { return window.localStorage.getItem(PENDING + path); } catch (e) { return null; }
  }

  function writePending(path, json) {
    try { window.localStorage.setItem(PENDING + path, json); } catch (e) { /* private mode */ }
  }

  function clearPending(path) {
    try { window.localStorage.removeItem(PENDING + path); } catch (e) { /* private mode */ }
  }

  function pendingPaths() {
    var paths = [];
    try {
      var store = window.localStorage;
      for (var i = 0; i < store.length; i++) {
        var key = store.key(i);
        if (key && key.indexOf(PENDING) === 0) paths.push(key.slice(PENDING.length));
      }
    } catch (e) { /* private mode */ }
    return paths;
  }

  // PUT a serialized doc; on 2xx the pending entry is removed, otherwise it stays and this rejects.
  function put(path, json) {
    return fetch(dbUrl(path), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: json
    }).then(function (res) {
      if (!res.ok) throw fail("HTTP " + res.status);
      clearPending(path);
    }, function (err) {
      throw fail(err && err.message ? err.message : "network error");
    });
  }

  function flushPending() {
    pendingPaths().forEach(function (path) {
      var json = readPending(path);
      if (json != null) put(path, json).catch(function () {});
    });
  }

  var db = {
    doc: function (path) {
      return {
        get: function () {
          var pending = readPending(path);
          if (pending != null) {
            // The unsynced local state is newer than the server copy: push it, then report it.
            return put(path, pending).then(function () {
              var data = JSON.parse(pending);
              return { exists: true, data: function () { return data; } };
            });
          }
          return fetch(dbUrl(path), { cache: "no-store" }).then(function (res) {
            if (!res.ok) throw fail("HTTP " + res.status);
            return res.json();
          }).then(function (j) {
            var data = j && j.exists ? j.data : null;
            return { exists: !!(j && j.exists), data: function () { return data; } };
          });
        },
        set: function (obj) {
          var json = JSON.stringify(obj);
          writePending(path, json);
          return put(path, json);
        }
      };
    }
  };

  window.addEventListener("online", flushPending);

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", function () {
      try {
        navigator.serviceWorker.register("sw.js").catch(function () {});
      } catch (e) { /* unsupported or blocked */ }
    });
  }

  window.claude = {
    use: function (name) {
      if (name === "sample") return Promise.resolve(sample);
      if (name === "db") return Promise.resolve(db);
      return Promise.resolve(null);
    }
  };
})();
