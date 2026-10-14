"""Tests for the German ("Denglisch") module texts: build validation and the DE/EN toggle.

Run with: python3.12 -m unittest tests/test_i18n.py
"""

import glob
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent

try:
    import playwright
    from playwright.sync_api import sync_playwright
except ImportError:  # browser tests are skipped, build tests still run
    sync_playwright = None

if sync_playwright and "PLAYWRIGHT_NODEJS_PATH" not in os.environ and shutil.which("node"):
    # The pip wheel can ship a node binary for the wrong CPU (e.g. x86 on an ARM
    # host). Fall back to the system node when the bundled one cannot run.
    bundled = Path(playwright.__file__).parent / "driver" / "node"
    try:
        subprocess.run([str(bundled), "--version"], capture_output=True, check=True)
    except OSError:
        os.environ["PLAYWRIGHT_NODEJS_PATH"] = shutil.which("node")


def copy_repo(dst):
    """Copy just what build.py needs into dst."""
    shutil.copy2(REPO / "build.py", dst / "build.py")
    shutil.copytree(REPO / "app", dst / "app")
    shutil.copytree(REPO / "content", dst / "content")


def run_build(root):
    return subprocess.run([sys.executable, str(root / "build.py")], capture_output=True, text=True)


def jload(p):
    with open(p, encoding="utf-8") as f:
        return json.load(f)


def jsave(p, obj):
    with open(p, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=2)


class BuildTest(unittest.TestCase):
    def test_build_is_green_and_reports_german_modules(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            copy_repo(root)
            r = run_build(root)
            self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
            n = len(glob.glob(str(REPO / "content" / "de" / "*.json")))
            self.assertIn("  german modules: %d of 14" % n, r.stdout)
            html = (root / "index.html").read_text(encoding="utf-8")
            blob = html.split("window.__COURSE__=", 1)[1].split(";</script>", 1)[0]
            data = json.loads(blob.replace("<\\/script", "</script").replace("<\\!--", "<!--"))
            self.assertEqual(len(data["modules_de"]), n)
            for mid, de in data["modules_de"].items():
                self.assertEqual(set(de), {"title", "subtitle", "why", "objectives", "beats"}, mid)


class TamperTest(unittest.TestCase):
    """Every kind of drift between a DE file and its EN module must fail the build."""

    def assert_tamper_fails(self, mutate):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            copy_repo(root)
            p = root / "content" / "de" / "m01.json"
            de = jload(p)
            mutate(de)
            jsave(p, de)
            r = run_build(root)
            self.assertNotEqual(r.returncode, 0, r.stdout)
            self.assertIn("GERMAN MODULE ERRORS", r.stdout)
            self.assertFalse((root / "index.html").exists(), "a failed build must not leave index.html")

    def test_changed_quiz_id_fails(self):
        def m(de):
            de["quiz"][0]["id"] += "x"
        self.assert_tamper_fails(m)

    def test_removed_beat_fails(self):
        def m(de):
            del de["beats"][1]
        self.assert_tamper_fails(m)

    def test_dropped_practice_marker_or_changed_check_beat_fails(self):
        en = jload(REPO / "content" / "m01.json")
        has_practice = "[[PRACTICE]]" in json.dumps(en, ensure_ascii=False)

        def m(de):
            if has_practice:
                # drop the first marker inside a translated (non-check) beat
                i, b = next((i, b) for i, b in enumerate(de["beats"])
                            if b["type"] != "check" and "[[PRACTICE]]" in json.dumps(b, ensure_ascii=False))
                de["beats"][i] = json.loads(json.dumps(b, ensure_ascii=False).replace("[[PRACTICE]]", "", 1))
            else:
                b = next(b for b in de["beats"] if b["type"] == "check")
                b["q"]["explain"] += " (changed)"
        self.assert_tamper_fails(m)

    def test_changed_check_beat_fails(self):
        def m(de):
            b = next(b for b in de["beats"] if b["type"] == "check")
            b["q"]["answer"] = 0 if b["q"].get("answer") != 0 else 1
        self.assert_tamper_fails(m)


@unittest.skipIf(sync_playwright is None, "playwright not installed")
class BrowserTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        root = Path(cls.tmp.name)
        # full build, the same as the repo
        cls.full = root / "full"
        cls.full.mkdir()
        copy_repo(cls.full)
        r = run_build(cls.full)
        assert r.returncode == 0, r.stdout
        # build without content/de/m02.json, to test the English fallback
        cls.nom02 = root / "nom02"
        cls.nom02.mkdir()
        copy_repo(cls.nom02)
        (cls.nom02 / "content" / "de" / "m02.json").unlink()
        r = run_build(cls.nom02)
        assert r.returncode == 0, r.stdout
        cls.pw = sync_playwright().start()
        cls.browser = cls.pw.chromium.launch()

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.pw.stop()
        cls.tmp.cleanup()

    def open(self, root):
        ctx = self.browser.new_context()
        page = ctx.new_page()
        errors = []
        page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.goto((root / "index.html").as_uri())
        self.addCleanup(ctx.close)
        return page, errors

    def open_module(self, page, mid):
        page.click('.navitem[data-go="module"][data-arg="%s"]' % mid)
        page.wait_for_selector(".mhead h1")

    def wait_saved(self, page, pred):
        page.wait_for_function(
            "(pred) => { try { const p = JSON.parse(localStorage.getItem('orderedlist.v1')); return !!p && eval(pred); } catch(e) { return false; } }",
            arg=pred,
        )

    def test_toggle_defaults_to_german_switches_and_persists(self):
        de = jload(REPO / "content" / "de" / "m01.json")
        en = jload(REPO / "content" / "m01.json")
        self.assertNotEqual(de["title"], en["title"])
        page, errors = self.open(self.full)
        self.open_module(page, "m01")
        self.assertEqual(page.inner_text(".mhead h1"), de["title"])
        self.assertEqual(page.inner_text("#langbtn"), "English")
        self.assertIn("Warum das zählt", page.text_content(".mhead"))
        page.click("#langbtn")
        page.wait_for_function("(t) => document.querySelector('.mhead h1').textContent === t", arg=en["title"])
        self.assertEqual(page.inner_text("#langbtn"), "Deutsch")
        self.assertIn("Why this matters", page.text_content(".mhead"))
        self.wait_saved(page, "p.settings.lang === 'en'")
        page.reload()
        self.open_module(page, "m01")
        self.assertEqual(page.inner_text(".mhead h1"), en["title"])
        # the header toggle does the same thing
        page.click(".mhead .langtoggle")
        page.wait_for_function("(t) => document.querySelector('.mhead h1').textContent === t", arg=de["title"])
        self.assertEqual(errors, [])

    def test_quiz_stays_english_in_german_mode(self):
        en = jload(REPO / "content" / "m01.json")
        page, errors = self.open(self.full)
        self.open_module(page, "m01")
        self.assertIn("Check yourself", page.inner_text(".quizwrap"))
        self.assertIn(en["quiz"][0]["stem"][:40], page.inner_text(".quizwrap"))
        self.assertEqual(errors, [])

    def test_sim_choice_is_shared_between_languages(self):
        en = jload(REPO / "content" / "m01.json")
        de = jload(REPO / "content" / "de" / "m01.json")
        i = next(i for i, b in enumerate(en["beats"]) if b["type"] == "sim")
        key = "m01_b%d" % i
        page, errors = self.open(self.full)
        self.open_module(page, "m01")
        sim = '[data-sim="%s"]' % key
        page.click(sim + ' .simchoice[data-i="1"]')
        self.assertIn(de["beats"][i]["choices"][1]["outcome"][:20], page.inner_text(sim + " .simout"))
        self.wait_saved(page, "p.sim['%s'] === 1" % key)
        page.click("#langbtn")
        page.wait_for_function("(t) => document.querySelector('.mhead h1').textContent === t", arg=en["title"])
        self.assertEqual(page.get_attribute(sim + ' .simchoice[data-i="1"]', "data-picked"), "1")
        self.assertIn(en["beats"][i]["choices"][1]["outcome"][:20], page.inner_text(sim + " .simout"))
        self.assertEqual(errors, [])

    def test_missing_german_file_falls_back_to_english(self):
        en = jload(REPO / "content" / "m02.json")
        de1 = jload(REPO / "content" / "de" / "m01.json")
        page, errors = self.open(self.nom02)
        self.open_module(page, "m01")
        self.assertEqual(page.inner_text(".mhead h1"), de1["title"])
        self.open_module(page, "m02")
        self.assertEqual(page.inner_text(".mhead h1"), en["title"])
        self.assertEqual(errors, [])


if __name__ == "__main__":
    unittest.main()
