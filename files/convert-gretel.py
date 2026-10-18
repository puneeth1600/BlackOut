#!/usr/bin/env python3
"""Turn files downloaded from gretelai/synthetic_pii_finance_multilingual into Blackout's test format (JSONL).

Run it on your own machine after downloading the dataset files (parquet, csv or jsonl). It never uploads anything.

    python3 tests/convert-gretel.py path/to/test-00000-of-00001.parquet --limit 500 --out tests/data/gretel-english.jsonl

What it does (it does not assume the labels are right):
  * keeps English documents only (--language to change);
  * maps the dataset's types to Blackout categories using data/label-mapping.json;
  * sets types Blackout does not score (company, date, time) aside as "ignore" spans;
  * checks every span (inside the text, format plausible for its type, name does not look like an organisation, card number passes Luhn);
    spans that fail are written to the rejected file and also become "ignore" spans, so they are neither rewarded nor penalised;
  * drops nested duplicates (for example a first_name inside a name span).
It prints counts only, never document text. Requires pandas (and pyarrow for parquet).
"""
import argparse, json, os, random, re, sys
from collections import Counter

try:
    import pandas as pd
except ImportError:
    sys.exit("This script needs pandas (pip install pandas pyarrow).")

HERE = os.path.dirname(os.path.abspath(__file__))
MAPPING = json.load(open(os.path.join(HERE, "data", "label-mapping.json"), encoding="utf-8"))
MAP = MAPPING["map"]
EXCLUDED = set(MAPPING["excluded"].keys())
ORG = re.compile(r"\b(Ltd|Limited|Inc|LLC|GmbH|Corp|Corporation|Co\.|PLC|Bank|Group|Holdings|Partners|Capital|Trust|Fund|Services|AG|SA|BV|AB)\b|&")


def luhn_ok(digits):
    s, alt = 0, False
    for ch in reversed(digits):
        n = int(ch)
        if alt:
            n *= 2
            if n > 9:
                n -= 9
        s += n
        alt = not alt
    return s % 10 == 0


def sanity(label, mapped, t):
    """Return a reason if the span looks wrong for its type, else None."""
    digits = re.sub(r"\D", "", t)
    if mapped == "Email" and "@" not in t:
        return "email without @"
    if mapped == "Phone" and not (7 <= len(digits) <= 15):
        return "phone with %d digits" % len(digits)
    if mapped == "Date of birth" and not digits:
        return "date of birth without digits"
    if mapped == "Name" and (re.search(r"[@\d]", t) or len(t.strip()) < 2):
        return "name containing digits or @"
    if mapped == "Name" and label == "name" and ORG.search(t):
        return "name label looks like an organisation"
    if mapped == "Address" and label == "street_address" and len(t.strip()) < 5:
        return "very short address"
    if mapped == "Credential" and len(t.strip()) < 3:
        return "very short credential"
    if label == "credit_card_number" and not (13 <= len(digits) <= 19 and luhn_ok(digits)):
        return "card number fails the Luhn check"
    return None


def load(path):
    ext = os.path.splitext(path)[1].lower()
    if ext == ".parquet":
        return pd.read_parquet(path)
    if ext == ".csv":
        return pd.read_csv(path)
    return pd.read_json(path, lines=ext in (".jsonl", ".ndjson"))


def spans_of(cell):
    if isinstance(cell, str):
        try:
            cell = json.loads(cell)
        except ValueError:
            return []
    out = []
    for s in cell or []:
        if isinstance(s, str):
            try:
                s = json.loads(s)
            except ValueError:
                continue
        label = s.get("label") or s.get("type") or s.get("entity")
        if label is None or "start" not in s or "end" not in s:
            continue
        out.append({"start": s["start"], "end": s["end"], "label": str(label).lower()})
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("input")
    ap.add_argument("--out", default=os.path.join(HERE, "data", "gretel-english.jsonl"))
    ap.add_argument("--rejected", default=None, help="audit file for spans that failed the checks (default: <out>.rejected.jsonl)")
    ap.add_argument("--language", default="English")
    ap.add_argument("--limit", type=int, default=500)
    ap.add_argument("--seed", type=int, default=1)
    a = ap.parse_args()
    rejected_path = a.rejected or a.out + ".rejected.jsonl"

    df = load(a.input)
    for col in ("generated_text", "pii_spans"):
        if col not in df.columns:
            sys.exit("Column '%s' not found. Expected the dataset's own columns." % col)
    if "language" in df.columns:
        df = df[df["language"].astype(str).str.lower() == a.language.lower()]
    rows = list(df.itertuples(index=False))
    random.Random(a.seed).shuffle(rows)
    rows = rows[: a.limit]

    kept, ignored, rejected_reasons, kept_by_type = 0, Counter(), Counter(), Counter()
    with open(a.out, "w", encoding="utf-8") as fo, open(rejected_path, "w", encoding="utf-8") as fr:
        for i, row in enumerate(rows):
            d = row._asdict()
            text = str(d["generated_text"])
            spans, ignore = [], []
            for s in spans_of(d["pii_spans"]):
                st, en, label = s["start"], s["end"], s["label"]
                if not (isinstance(st, int) and isinstance(en, int) and 0 <= st < en <= len(text)):
                    rejected_reasons["span outside the text"] += 1
                    continue
                t = text[st:en]
                if not t.strip():
                    rejected_reasons["empty span"] += 1
                    continue
                if label in EXCLUDED:
                    ignore.append({"start": st, "end": en})
                    ignored[label] += 1
                    continue
                if label not in MAP:
                    rejected_reasons["unknown type: " + label] += 1
                    ignore.append({"start": st, "end": en})
                    continue
                why = sanity(label, MAP[label], t)
                if why:
                    rejected_reasons[why] += 1
                    ignore.append({"start": st, "end": en})
                    fr.write(json.dumps({"doc": "gretel-%d" % i, "start": st, "end": en, "type": label, "reason": why}) + "\n")
                    continue
                spans.append({"start": st, "end": en, "label": MAP[label], "source": label})
            # drop nested duplicates, keeping the longer span
            spans.sort(key=lambda x: (x["start"], -(x["end"] - x["start"])))
            clean = []
            for s in spans:
                if clean and s["start"] < clean[-1]["end"]:
                    continue
                clean.append(s)
            for s in clean:
                kept_by_type[s["label"]] += 1
                s.pop("source", None)
            rec = {"id": "gretel-%d" % i, "text": text, "spans": clean, "ignore": ignore,
                   "tags": [str(d.get("language", "")), str(d.get("document_type", ""))]}
            fo.write(json.dumps(rec, ensure_ascii=False) + "\n")
            kept += 1

    print("documents written: %d (language: %s)" % (kept, a.language))
    print("spans kept by Blackout type: %s" % dict(kept_by_type))
    print("set aside as not scored: %s" % dict(ignored))
    print("rejected by the label checks: %s" % dict(rejected_reasons))
    print("output: %s\nrejected-span audit (offsets and reasons only): %s" % (a.out, rejected_path))


if __name__ == "__main__":
    main()
