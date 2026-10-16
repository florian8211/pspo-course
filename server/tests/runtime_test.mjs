// Unit test for server/runtime.js: loads it in a vm context with fake browser globals.
// Run: node server/tests/runtime_test.mjs   (node >= 22, no packages). Exits non-zero on failure.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import assert from "node:assert/strict";

const RUNTIME = fileURLToPath(new URL("../runtime.js", import.meta.url));
const SOURCE = readFileSync(RUNTIME, "utf8");
const KEY = "pspo.pending:progress/state";

function makeStorage() {
  const map = new Map();
  return {
    map,
    get length() { return map.size; },
    key(i) { return [...map.keys()][i] ?? null; },
    getItem(k) { return map.has(k) ? map.get(k) : null; },
    setItem(k, v) { map.set(k, String(v)); },
    removeItem(k) { map.delete(k); },
  };
}

function makeEnv() {
  const env = { online: true, server: new Map(), calls: [], listeners: {}, registered: [] };
  env.localStorage = makeStorage();
  env.fetch = async (url, opts = {}) => {
    const method = opts.method || "GET";
    env.calls.push({ url, method, body: opts.body });
    if (!env.online) throw new TypeError("Failed to fetch");
    const path = decodeURIComponent(String(url).split("path=")[1]);
    const json = (obj) => ({ ok: true, status: 200, json: async () => obj });
    if (method === "PUT") { env.server.set(path, JSON.parse(opts.body)); return json({ ok: true }); }
    return env.server.has(path) ? json({ exists: true, data: env.server.get(path) })
                                : json({ exists: false, data: null });
  };
  env.window = {
    localStorage: env.localStorage,
    addEventListener(type, fn) { (env.listeners[type] ||= []).push(fn); },
  };
  env.navigator = {
    serviceWorker: { register(url) { env.registered.push(url); return Promise.resolve(); } },
  };
  const context = vm.createContext({
    window: env.window, navigator: env.navigator, fetch: env.fetch,
    localStorage: env.localStorage, TextDecoder, Promise, JSON, setTimeout, clearTimeout,
  });
  vm.runInContext(SOURCE, context, { filename: RUNTIME });
  env.fire = (type) => (env.listeners[type] || []).forEach((fn) => fn({ type }));
  env.doc = async () => (await env.window.claude.use("db")).doc("progress/state");
  return env;
}

const settle = () => new Promise((r) => setTimeout(r, 10));
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test("window.claude contract is unchanged", async () => {
  const env = makeEnv();
  assert.equal(typeof (await env.window.claude.use("sample")), "function");
  const db = await env.window.claude.use("db");
  assert.equal(typeof db.doc, "function");
  assert.equal(await env.window.claude.use("downloads"), null);
});

test("service worker is registered with a relative URL after load", async () => {
  const env = makeEnv();
  assert.deepEqual(env.registered, []);
  env.fire("load");
  assert.deepEqual(env.registered, ["sw.js"]);
});

test("set() while fetch fails rejects and keeps the pending key", async () => {
  const env = makeEnv();
  env.online = false;
  const doc = await env.doc();
  await assert.rejects(doc.set({ done: { m1: true } }));
  assert.equal(env.localStorage.getItem(KEY), JSON.stringify({ done: { m1: true } }));
});

test("set() success stores on the server and removes the pending key", async () => {
  const env = makeEnv();
  const doc = await env.doc();
  await doc.set({ done: { m2: true } });
  assert.equal(env.localStorage.getItem(KEY), null);
  assert.deepEqual(env.server.get("progress/state"), { done: { m2: true } });
  const put = env.calls.find((c) => c.method === "PUT");
  assert.ok(!put.url.startsWith("/"), "db URL must be relative");
});

test("get() with pending PUTs it, resolves with the pending data and removes the key", async () => {
  const env = makeEnv();
  env.server.set("progress/state", { done: { old: true } });
  env.localStorage.setItem(KEY, JSON.stringify({ done: { offline: true } }));
  const snap = await (await env.doc()).get();
  assert.equal(snap.exists, true);
  assert.deepEqual(snap.data(), { done: { offline: true } });
  assert.equal(env.localStorage.getItem(KEY), null);
  assert.deepEqual(env.server.get("progress/state"), { done: { offline: true } });
  assert.deepEqual(env.calls.map((c) => c.method), ["PUT"]);
});

test("get() with pending while offline rejects and keeps the key", async () => {
  const env = makeEnv();
  env.online = false;
  env.localStorage.setItem(KEY, JSON.stringify({ done: { offline: true } }));
  await assert.rejects((await env.doc()).get());
  assert.equal(env.localStorage.getItem(KEY), JSON.stringify({ done: { offline: true } }));
});

test("get() without pending returns the server data", async () => {
  const env = makeEnv();
  env.server.set("progress/state", { done: { server: true } });
  const snap = await (await env.doc()).get();
  assert.equal(snap.exists, true);
  assert.deepEqual(snap.data(), { done: { server: true } });
  assert.deepEqual(env.calls.map((c) => c.method), ["GET"]);
  const missing = await (await env.window.claude.use("db")).doc("progress/none").get();
  assert.equal(missing.exists, false);
  assert.equal(missing.data(), null);
});

test("'online' event flushes every pending entry", async () => {
  const env = makeEnv();
  env.localStorage.setItem(KEY, JSON.stringify({ done: { a: true } }));
  env.localStorage.setItem("pspo.pending:progress/other", JSON.stringify({ b: 1 }));
  env.localStorage.setItem("unrelated", "x");
  env.fire("online");
  await settle();
  assert.equal(env.localStorage.getItem(KEY), null);
  assert.equal(env.localStorage.getItem("pspo.pending:progress/other"), null);
  assert.equal(env.localStorage.getItem("unrelated"), "x");
  assert.deepEqual(env.server.get("progress/state"), { done: { a: true } });
  assert.deepEqual(env.server.get("progress/other"), { b: 1 });
});

test("'online' while still unreachable keeps pending entries silently", async () => {
  const env = makeEnv();
  env.online = false;
  env.localStorage.setItem(KEY, JSON.stringify({ done: { a: true } }));
  env.fire("online");
  await settle();
  assert.equal(env.localStorage.getItem(KEY), JSON.stringify({ done: { a: true } }));
});

test("localStorage that throws (private mode) does not break set/get", async () => {
  const env = makeEnv();
  for (const m of ["getItem", "setItem", "removeItem", "key"]) {
    env.localStorage[m] = () => { throw new Error("SecurityError"); };
  }
  const doc = await env.doc();
  await doc.set({ x: 1 });
  assert.deepEqual((await doc.get()).data(), { x: 1 });
  env.fire("online");
});

let failed = 0;
for (const [name, fn] of tests) {
  try {
    await fn();
    console.log(`ok   ${name}`);
  } catch (err) {
    failed++;
    console.log(`FAIL ${name}\n     ${err && err.stack ? err.stack : err}`);
  }
}
console.log(`${tests.length - failed}/${tests.length} passed`);
process.exit(failed ? 1 : 0);
