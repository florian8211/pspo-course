/* Self-hosted runtime for the PSPO course. Loaded before the engine by serve.py.
   Provides window.claude.use(name) backed by /api/sample and /api/db. */
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

  var db = {
    doc: function (path) {
      return {
        get: function () {
          return fetch(dbUrl(path), { cache: "no-store" }).then(function (res) {
            if (!res.ok) throw fail("HTTP " + res.status);
            return res.json();
          }).then(function (j) {
            var data = j && j.exists ? j.data : null;
            return { exists: !!(j && j.exists), data: function () { return data; } };
          });
        },
        set: function (obj) {
          return fetch(dbUrl(path), {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(obj)
          }).then(function (res) {
            if (!res.ok) throw fail("HTTP " + res.status);
          });
        }
      };
    }
  };

  window.claude = {
    use: function (name) {
      if (name === "sample") return Promise.resolve(sample);
      if (name === "db") return Promise.resolve(db);
      return Promise.resolve(null);
    }
  };
})();
