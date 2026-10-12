# Owner's Manual

An interactive course that teaches the Scrum Product Owner accountability and prepares you for **PSPO I**, built as a single self-contained HTML file with no framework and no dependencies.

**[Open the live demo](https://bigsupe55.github.io/pspo-course/)**

I built it while founding a govtech startup, because I needed the certification and could not find a course that taught the *why* instead of drilling definitions. It is a real product I use, not a portfolio exercise, which is why the engineering around the content is the interesting part.

---

## What it is

| | |
|---|---|
| **14 modules** | 356 content beats across five weeks, from empiricism to a full Sprint simulation |
| **317 questions** | 157 in-module, plus two complete 80-question mock exams |
| **164 flashcards** | Leitner spaced repetition, unlocking as you finish modules |
| **20 decision simulations** | Branching scenarios where most outcomes are honestly "mixed" |
| **32-term glossary** | Plus a quick-reference of every timebox and accountability |

Content is **data, not markup**. Every module is a JSON file of typed "beats", and the engine renders each type as a visually distinct object: a verbatim Scrum Guide quote gets a ledger rule and a citation, a common misconception gets a myth-versus-truth split, an applied scenario gets its own panel. That separation is why the course never reads as one long wall of text, and why content can be validated mechanically.

## The problem it actually solves

PSPO I is graded strictly against the Scrum Guide 2020. Most study material blends the Guide with widely-taught practice, and learners fail because they answer with what their team does rather than what Scrum says.

So the course tracks the distinction explicitly. Anything that is common practice but **not** in the Guide (user stories, story points, velocity, Definition of Ready, the three Daily Scrum questions) renders with a visible **"Practice, not Scrum"** badge. There is a 24-entry trap catalogue built entirely around this, including the changes between the 2017 and 2020 Guide that make older practice questions actively wrong.

Claims of absence are verified, not asserted. The build greps the Guide's own text to confirm that "story point", "velocity", "user story", "Sprint 0", "hardening", "Definition of Ready" and "grooming" each appear exactly zero times.

## Engineering notes

Three documents cover how this was made and why you can trust it:

- **[How it was built](docs/how-it-was-built.md)** — orchestrating parallel authoring agents against a shared spec, and the durability lesson learned when six agents were killed mid-run by a usage limit.
- **[Verification](docs/verification.md)** — what the build refuses to ship, including the sanitization tripwire, plus an honest list of what is *not* verified.
- **[COURSE-SPEC.md](COURSE-SPEC.md)** — the authoring contract that kept 14 modules from 7 independent authors consistent in voice and schema.

Highlights, if you only read one thing:

- **The build is the test suite.** `python build.py` validates every answer index, catches duplicate ids across 317 questions, rejects unexplained answers, enforces two content invariants, and **deletes its own output** if a sanitization check fails, so a bad build cannot be served by accident.
- **Durability beat cleverness.** Long agent runs die. Writing each unit to disk the moment it is finished turned a total loss into a one-file loss, which is the only reason this finished.
- **Accessibility was measured, not assumed.** Contrast was computed in both themes; two real WCAG failures at 2.8:1 and 2.97:1 were found and fixed. Horizontal overflow was checked on every view at 265px, which surfaced a genuine `minmax(268px, 1fr)` bug.

## Run it

```bash
python build.py        # writes index.html
```

No dependencies, no bundler, no install step. Open `index.html`.

To change content, edit a file in `content/` and rebuild. You never touch the engine to change what the course says.

## About the demo

The hosted version runs the entire course: every module, question, flashcard and mock exam. Progress saves in your browser.

Two features are switched off here because they need a model behind them, and the page says so where they appear rather than failing silently:

- an **AI coach** that answers Scrum questions grounded in the Guide, and flags when something is practice rather than Scrum
- **grading of written answers**, where you draft a real Product Goal or Sprint Goal and get feedback against a rubric

In the full version these run on Claude through the host page's runtime, alongside cross-device progress sync.

## A note on the scenarios

Every concept lands on a concrete product decision, because abstract Scrum advice is forgettable. The running example is **Ledgerline**, a budget transparency platform sold to **Northfield**, a small New England town.

Northfield is fictional. The course was originally written against my own company's internal material, and this public version replaces all of it with an invented town, product, and cast, specified in [`WORLD.md`](WORLD.md) so the world stays consistent across all 14 modules. The situations are real product-management problems (a data feed that failed silently, two screens disagreeing because of rounding order, a feature four stakeholders want four different things from). The specifics are invented.

## License

Code and course content: [MIT](LICENSE). See [NOTICE.md](NOTICE.md) for how third-party material is handled. Not affiliated with Scrum.org or Scrum Alliance.

## Self-hosting the full version

`server/serve.py` serves the course together with a small runtime (`server/runtime.js`) that switches on the AI coach, grading of written answers and progress sync across devices. It needs Python 3.12+ (standard library only) and a logged-in [`claude` CLI](https://docs.claude.com/en/docs/claude-code) on the `PATH`; the course files themselves are not changed.

```sh
python3 server/serve.py        # then open http://127.0.0.1:3140
```

| Variable | Default | Meaning |
|---|---|---|
| `PSPO_PORT` | `3140` | Port to listen on |
| `PSPO_BIND` | `127.0.0.1` | Address to bind |
| `PSPO_DATA_DIR` | `~/.local/share/pspo-course` | Where progress is stored (one JSON file per document) |
| `PSPO_CLAUDE_MODEL` | `sonnet` | Model passed to `claude -p --model` |
| `PSPO_TIMEOUT` | `180` | Seconds before a model call is killed |
| `PSPO_MAX_CONCURRENT` | `2` | Parallel model calls; more get HTTP 429 |
| `PSPO_MODEL_CMD` | unset | Replace the whole model command (used by the tests) |

`server/pspo-course.service` is a `systemd --user` unit for running it permanently. Tests: `python3 -m unittest discover -s server/tests -v`.

**Only expose this server on a private network** (loopback, a VPN, Tailscale). There is no login: anyone who can reach it can spend the operator's model quota and overwrite the stored progress.
