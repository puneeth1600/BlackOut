# Blackout tests

Everything here runs on your machine. Nothing is uploaded, nothing is written to disk by the runners, and no real personal data is used (see `DATASET.md`).

| Command | What it does | Needs |
|---|---|---|
| `node tests/run-tests.js` | Scores the detection rules on every `tests/data/*.jsonl` and prints precision, recall, F1, false positives and misses per type | Node 18+ |
| `node tests/regression.js` | 35 checks that existing detection, merging, text redaction, Word (.docx) redaction and the privacy rules keep working, plus score floors on the bundled data | Node 18+, `jszip` for the Word checks (skipped if missing) |
| `node tests/ui-test.js` | Drives the real page in Chromium: review, exclude, apply, download, the in-page test panel, and a check of every network request | `playwright` and a Chromium |
| `node tests/tools/make-synthetic.js` | Regenerates the two bundled data files (seeded) | Node |
| `python3 tests/convert-gretel.py <file>` | Converts a downloaded public dataset file into the test format (see `DATASET.md`) | Python 3, pandas (+ pyarrow for parquet) |

Options for `run-tests.js`: `--skip-hard` leaves out cases tagged `hard`, `--show-text` prints the matched text next to offsets (off by default), `--json` adds a machine-readable summary, `--html=path` tests another copy of the page.

## In the page

Expand **Detection test (advanced)** at the bottom of the upload card, choose a test file, and press Run. It runs the same engine as the page in your browser and shows the same tables. Options: include the name dictionary (downloads a library; off by default), include `hard` cases, show text excerpts (off by default). Results are drawn on the page only; nothing is stored, logged or sent.

## How scores are counted

- **Strict**: the detection has the exact start, end and type of a labelled span.
- **Relaxed**: same type and at least half of the longer of the two spans overlaps.
- **Cover**: type ignored. A labelled span counts as found when at least 95% of it is covered by detections; a detection counts as correct when it overlaps any labelled span. This is the number that matters most for redaction, because a wrong label is far less harmful than a missed value.
- Precision = found / (found + false positives); recall = found / (found + missed); F1 is their harmonic mean. If a file has no labelled spans, recall is shown as n/a rather than 100%.
- Detections that fall on spans marked `ignore` (types Blackout does not score, or labels that failed a check) are tallied separately.

## Where the engine code lives

The detection engine and the scoring code are inside `blackout.html`, between the `ENGINE:BEGIN/END` and `EVAL:BEGIN/END` comments. The Node runners load exactly that text, so the tests cannot drift from the page.
