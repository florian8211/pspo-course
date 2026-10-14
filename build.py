#!/usr/bin/env python
# Assembles Owner's Manual into one artifact HTML file.
import json, os, sys, glob, re

ROOT = os.path.dirname(os.path.abspath(__file__))
APP  = os.path.join(ROOT, "app")
CON  = os.path.join(ROOT, "content")
OUT  = os.path.join(ROOT, "index.html")   # index.html so GitHub Pages serves it at the repo root

# This repo is public. The course was originally authored against a real
# company's internal material, and these strings are the tripwire that proves
# none of it survived. A hit fails the build rather than warning, because a
# warning in a build log is not a safety mechanism.
# Word-boundary anchored on purpose. Plain substring matching produces false
# positives that are worse than useless: "MMA" hits inside "summary" and
# "commas", "NOW-" hits inside "know-how". A check that cries wolf gets worked
# around by rewriting innocent prose, which is exactly the wrong outcome.
BANNED = [
    r"Civic[\s-]?Chain",
    r"\bTyler\s+Munis\b", r"\bMunis\b",
    r"\bLevesque\b", r"\bOuellette\b", r"\bThibodeau\b", r"\bOkafor\b", r"\bGagnon\b",
    r"\bBaltimore\b", r"\bOpen\s+Checkbook\b", r"\bBoard\s+of\s+Estimates\b", r"\bTopsham\b",
    r"\bFOAA\b", r"\bMMA\b", r"\b30-A\b", r"\b5603\b",
    r"\bAnomaly\s+Center\b", r"\bQuery\s+Terminal\b", r"\bHarbor\s+and\s+Waterfront\b",
    r"\b(?:NOW|NEXT|LATER)-\d+\b",
]

EXPECTED = ["m%02d" % i for i in range(1, 15)]

def load(p):
    with open(p, encoding="utf-8") as f:
        return f.read()

def jload(p):
    with open(p, encoding="utf-8") as f:
        return json.load(f)

problems = []
modules = []
for mid in EXPECTED:
    p = os.path.join(CON, mid + ".json")
    if not os.path.exists(p):
        problems.append("MISSING module " + mid)
        continue
    try:
        modules.append(jload(p))
    except Exception as e:
        problems.append("BAD JSON %s: %s" % (mid, e))

exams = []
for p in sorted(glob.glob(os.path.join(CON, "exam?.json"))):
    try:
        exams.append(jload(p))
    except Exception as e:
        problems.append("BAD JSON %s: %s" % (os.path.basename(p), e))

# Extra question batches, e.g. exam1-more-1.json, merged into their parent exam.
# Written as bare JSON arrays so a partial batch never invalidates the whole exam.
for p in sorted(glob.glob(os.path.join(CON, "exam?-more-*.json"))):
    base = os.path.basename(p).split("-more-")[0]          # "exam1"
    parent = next((e for e in exams if e["id"] == "x" + base[-1]), None)
    if parent is None:
        problems.append("orphan batch %s (no parent exam)" % os.path.basename(p))
        continue
    try:
        batch = jload(p)
        if not isinstance(batch, list):
            problems.append("%s is not a JSON array" % os.path.basename(p))
            continue
        have = {q["id"] for q in parent["questions"]}
        added = [q for q in batch if q.get("id") not in have]
        parent["questions"].extend(added)
    except Exception as e:
        problems.append("BAD JSON %s: %s" % (os.path.basename(p), e))

# A half-written exam must never ship looking like a full one.
keep = []
for e in exams:
    n = len(e.get("questions", []))
    if n < 40:
        problems.append("DROPPED %s: only %d questions, too few to ship" % (e.get("title", e["id"]), n))
        continue
    if n < 80:
        problems.append("%s has %d questions (want 80)" % (e.get("title", e["id"]), n))
    keep.append(e)
exams = keep

glossary = []
gp = os.path.join(CON, "glossary.json")
if os.path.exists(gp):
    try:
        glossary = jload(gp)
    except Exception as e:
        problems.append("BAD JSON glossary: %s" % e)

# ---- German ("Denglisch") module texts ----
# content/de/<mid>.json is a full copy of the EN module where only the text
# fields below are translated. Everything else must match EN exactly, so the
# engine can swap texts without touching progress keys, quizzes or cards.
DE = os.path.join(CON, "de")
MOD_TEXT = ["title", "subtitle", "why", "objectives"]
BEAT_TEXT = {
    "hook":      ["body"],
    "teach":     ["title", "body", "callout.text"],
    "analogy":   ["title", "body", "callout.text"],
    "guide":     ["gloss"],
    "trap":      ["myth", "truth", "why"],
    "civic":     ["title", "body"],
    "sim":       ["title", "setup", "choices[].label", "choices[].outcome", "choices[].lesson"],
    "keypoints": ["points"],
    "write":     ["prompt", "starter", "rubric", "model"],
}
MARKERS = ["[[PRACTICE]]", "______"]

def text_slots(obj, path):
    """Yield (container, key, label) for every string a text path points at.
    "a.b" walks dicts, "a[].b" walks every list item, a list leaf yields each item."""
    head, _, rest = path.partition(".")
    if head.endswith("[]"):
        for i, it in enumerate(obj.get(head[:-2]) or []):
            if isinstance(it, dict):
                for c, k, lab in text_slots(it, rest):
                    yield c, k, "%s[%d].%s" % (head[:-2], i, lab)
        return
    if head not in obj:
        return
    if rest:
        if isinstance(obj[head], dict):
            for c, k, lab in text_slots(obj[head], rest):
                yield c, k, head + "." + lab
    elif isinstance(obj[head], list):
        for i in range(len(obj[head])):
            yield obj[head], i, "%s[%d]" % (head, i)
    else:
        yield obj, head, head

def module_slots(m):
    for p in MOD_TEXT:
        for c, k, lab in text_slots(m, p):
            yield c, k, lab
    for i, b in enumerate(m.get("beats") or []):
        if not isinstance(b, dict):
            continue
        for p in BEAT_TEXT.get(b.get("type"), []):
            for c, k, lab in text_slots(b, p):
                yield c, k, "beats[%d].%s" % (i, lab)

def masked(m):
    m = json.loads(json.dumps(m))
    for c, k, _ in module_slots(m):
        c[k] = "<text>"
    return m

def validate_de(en, de):
    out = []
    if masked(de) != masked(en):
        out.append("structure differs from EN once text fields are masked")
    for k in ("quiz", "cards"):
        if de.get(k) != en.get(k):
            out.append("%s differs from EN" % k)
    eb, db = en.get("beats") or [], de.get("beats") or []
    if len(eb) != len(db):
        out.append("beat count %d, EN has %d" % (len(db), len(eb)))
    for i, b in enumerate(eb):
        if b.get("type") == "check" and (i >= len(db) or db[i] != b):
            out.append("check beat %d differs from EN" % i)
    de_text = {lab: c[k] for c, k, lab in module_slots(de)}
    for c, k, lab in module_slots(en):
        if not isinstance(c[k], str):
            continue
        d = de_text.get(lab)
        d = d if isinstance(d, str) else ""
        for mk in MARKERS:
            if c[k].count(mk) != d.count(mk):
                out.append("%s: %r count %d, EN has %d" % (lab, mk, d.count(mk), c[k].count(mk)))
    return out

modules_de = {}
de_errs = []
for m in modules:
    p = os.path.join(DE, m["id"] + ".json")
    if not os.path.exists(p):
        continue
    try:
        de = jload(p)
    except Exception as e:
        de_errs.append("BAD JSON de/%s: %s" % (m["id"], e))
        continue
    errs_m = validate_de(m, de)
    if errs_m:
        de_errs.extend("de/%s: %s" % (m["id"], e) for e in errs_m)
        continue
    modules_de[m["id"]] = {k: de[k] for k in ("title", "subtitle", "why", "objectives", "beats") if k in de}

data = {"modules": modules, "exams": exams, "glossary": glossary, "modules_de": modules_de}
blob = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
# keep the JSON safe inside a <script> tag
blob = blob.replace("</script", "<\\/script").replace("<!--", "<\\!--")

parts = [
    load(os.path.join(APP, "01-head.html")),
    load(os.path.join(APP, "02-beats.html")),
    load(os.path.join(APP, "03-body.html")),
    load(os.path.join(APP, "06-mobile.html")),   # after the desktop styles so it wins ties
    "<script>window.__COURSE__=" + blob + ";</script>",
    load(os.path.join(APP, "04-engine.js")),
    load(os.path.join(APP, "05-tools.js")),
]
html = "\n".join(parts)
with open(OUT, "w", encoding="utf-8") as f:
    f.write(html)

# ---- report ----
nq = sum(len(m.get("quiz", []))  for m in modules)
nc = sum(len(m.get("cards", [])) for m in modules)
nb = sum(len(m.get("beats", [])) for m in modules)
ne = sum(len(x.get("questions", [])) for x in exams)
size = os.path.getsize(OUT)

print("built %s" % OUT)
print("  %.2f MB  (artifact limit is 16 MB)" % (size / 1048576.0))
print("  modules: %d of %d" % (len(modules), len(EXPECTED)))
print("  german modules: %d of %d" % (len(modules_de), len(EXPECTED)))
print("  beats: %d | module questions: %d" % (nb, nq))
print("  exams: %d  (%d questions)" % (len(exams), ne))
print("  flashcards: %d | glossary: %d" % (nc, len(glossary)))
print("  total questions in app: %d" % (nq + ne))

# ---- integrity checks ----
errs = []
seen_q, seen_c = {}, {}
for m in modules:
    qs = list(m.get("quiz", []))
    for b in m.get("beats", []):
        if b.get("type") == "check" and b.get("q"):
            qs.append(b["q"])
    for q in qs:
        qid = q.get("id")
        if qid in seen_q:
            errs.append("duplicate question id %s (%s and %s)" % (qid, seen_q[qid], m["id"]))
        seen_q[qid] = m["id"]
        k = q.get("kind", "mcq")
        opts = q.get("options", [])
        a = q.get("answer")
        if k == "mcq":
            if not isinstance(a, int) or not (0 <= a < len(opts)):
                errs.append("%s: mcq answer out of range (%r, %d options)" % (qid, a, len(opts)))
        elif k == "multi":
            if not isinstance(a, list) or not a or any((not isinstance(i, int)) or i < 0 or i >= len(opts) for i in a):
                errs.append("%s: multi answer bad (%r, %d options)" % (qid, a, len(opts)))
        elif k == "tf":
            if not isinstance(a, bool):
                errs.append("%s: tf answer must be true/false, got %r" % (qid, a))
        elif k == "order":
            if not q.get("items"):
                errs.append("%s: order question has no items" % qid)
        elif k == "sort":
            bl = q.get("buckets", [])
            for it in q.get("items", []):
                if it.get("bucket") not in bl:
                    errs.append("%s: sort item bucket %r not in buckets" % (qid, it.get("bucket")))
        if not q.get("explain"):
            errs.append("%s: no explanation" % qid)
    for c in m.get("cards", []):
        if c.get("id") in seen_c:
            errs.append("duplicate card id %s" % c.get("id"))
        seen_c[c.get("id")] = 1

for x in exams:
    for q in x.get("questions", []):
        qid = q.get("id")
        if qid in seen_q:
            errs.append("exam question id collides with module question: %s" % qid)
        seen_q[qid] = x["id"]
        k = q.get("kind", "mcq")
        opts = q.get("options", [])
        a = q.get("answer")
        if k == "mcq" and (not isinstance(a, int) or not (0 <= a < len(opts))):
            errs.append("%s: mcq answer out of range" % qid)
        if k == "multi" and (not isinstance(a, list) or any(i >= len(opts) for i in a)):
            errs.append("%s: multi answer out of range" % qid)
        if k == "tf" and not isinstance(a, bool):
            errs.append("%s: tf answer not boolean" % qid)

# em dash / timer sweep across everything shipped
bad_dash = blob.count("—") + blob.count("–")
timers = re.findall(r"(?i)\b(countdown|time limit|timer|seconds remaining|beat the clock)\b", blob)
# "no time limit" and "untimed" are fine; only flag if not negated
timers = [t for t in timers if True]

# ---- sanitization tripwire ----
# Scan the BUILT page, not the sources, so anything that sneaks in through any
# path is caught at the only point that matters: what actually ships.
leaks = []
for pat in BANNED:
    hits = re.findall(pat, html, re.I)
    if hits:
        leaks.append((pat, len(hits), sorted(set(hits))[:3]))

print()
if problems:
    print("BUILD PROBLEMS:")
    for p in problems: print("  ! " + p)
print("em/en dashes in content: %d %s" % (bad_dash, "OK" if bad_dash == 0 else "<-- FIX"))
print("timer-ish words in content: %d %s" % (len(timers), ("(" + ", ".join(sorted(set(timers))) + ")") if timers else ""))
if errs:
    print("CONTENT ERRORS (%d):" % len(errs))
    for e in errs[:40]: print("  ! " + e)
    if len(errs) > 40: print("  ... and %d more" % (len(errs) - 40))
else:
    print("content integrity: all questions well formed")

if de_errs:
    print()
    print("!!! GERMAN MODULE ERRORS (%d):" % len(de_errs))
    for e in de_errs[:40]: print("  ! " + e)
    if len(de_errs) > 40: print("  ... and %d more" % (len(de_errs) - 40))
    os.remove(OUT)
    print("    %s deleted so a build with a broken German module cannot be served." % os.path.basename(OUT))
    sys.exit(1)

if leaks:
    print()
    print("!!! SANITIZATION FAILURE: %d banned pattern(s) in the built page" % len(leaks))
    for pat, n, samples in leaks:
        print("    %-34s x%-4d %s" % (pat, n, ", ".join(repr(s) for s in samples)))
    print("    This repo is public. Fix the content before publishing.")
    os.remove(OUT)
    print("    %s deleted so a leaking build cannot be served." % os.path.basename(OUT))
    sys.exit(1)
print("sanitization: clean, no banned terms in the built page")
