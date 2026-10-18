#!/usr/bin/env node
'use strict';
/* Scores Blackout's detection rules against labelled test files and prints precision, recall and F1.
   Usage:  node tests/run-tests.js [file.jsonl ...] [--skip-hard] [--show-text] [--json]
   With no files it runs everything in tests/data/*.jsonl except converted dataset files you add yourself (they are picked up too).
   This evaluates rules; nothing here trains a model. Output lists record ids and character offsets only; --show-text adds the
   matched text (the bundled data is synthetic, but converted datasets may contain more). Nothing is written to disk or sent anywhere. */
const fs = require('fs');
const path = require('path');
const { loadEngine, defaultHtml } = require('./lib/engine');

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith('--')));
const htmlArg = args.find((a) => a.startsWith('--html='));
const { api } = loadEngine(htmlArg ? htmlArg.slice(7) : defaultHtml);
const dataDir = path.join(__dirname, 'data');
let files = args.filter((a) => !a.startsWith('--'));
if (!files.length) files = fs.readdirSync(dataDir).filter((f) => f.endsWith('.jsonl')).map((f) => path.join(dataDir, f));

const pct = (x) => (x === null ? '  n/a ' : (x * 100).toFixed(1).padStart(5) + '%');
function table(title, m) {
  console.log('\n  ' + title);
  console.log('  ' + 'Type'.padEnd(16) + 'Found'.padStart(7) + 'False+'.padStart(8) + 'Missed'.padStart(8) + 'Precision'.padStart(11) + 'Recall'.padStart(9) + 'F1'.padStart(9));
  const row = (n, r) => console.log('  ' + n.padEnd(16) + String(r.tp).padStart(7) + String(r.fp).padStart(8) + String(r.fn).padStart(8) + pct(r.p).padStart(11) + pct(r.r).padStart(9) + pct(r.f).padStart(9));
  Object.keys(m.byType).sort().forEach((t) => row(t, m.byType[t]));
  row('All (micro)', m.micro);
  console.log('  Macro F1 over types with labels: ' + pct(m.macroF).trim());
}

/* checks that the bundled labels are correct by construction (independent of the detector) */
function checkAuthoredLabels(docs) {
  const problems = [];
  const panOk = (s) => /^[A-Z]{3}[PCHFATBLJG][A-Z]\d{4}[A-Z]$/.test(s);
  docs.forEach((d) => {
    d.spans.forEach((s) => {
      const t = d.text.slice(s.start, s.end), digits = t.replace(/\D/g, '');
      if (s.label === 'ID number' && /^[\d ]+$/.test(t) && digits.length === 12) {
        const valid = api.aadhaarOk(t), wantInvalid = d.tags.includes('labelled-invalid-checksum');
        if (valid === wantInvalid) problems.push(d.id + ': Aadhaar checksum does not match its tag');
      }
      if (s.label === 'ID number' && /^[A-Z]{5}\d{4}[A-Z]$/.test(t)) {
        const wantBad = d.tags.includes('pan-labelled-bad-type');
        if (panOk(t) === wantBad) problems.push(d.id + ': PAN holder type does not match its tag');
      }
      if (s.label === 'Financial' && /^[\d ]+$/.test(t) && digits.length >= 13 && digits.length <= 19 && /Card number/.test(d.text) && !api.luhn(digits)) problems.push(d.id + ': card number fails Luhn');
    });
    d.text.split('\n').forEach(() => {});
  });
  return problems;
}

let exitCode = 0;
const report = [];
files.forEach((file) => {
  const parsed = api.parseTestFile(fs.readFileSync(file, 'utf8'));
  let docs = parsed.docs;
  if (flags.has('--skip-hard')) docs = docs.filter((d) => !d.tags.includes('hard'));
  console.log('\n==== ' + path.basename(file) + ' (' + docs.length + ' documents' + (flags.has('--skip-hard') ? ', hard cases skipped' : '') + ') ====');
  parsed.errors.forEach((e) => console.log('  note: ' + e));
  const authored = /synthetic-sample|indian-ids/.test(file);
  if (authored) {
    const problems = checkAuthoredLabels(docs);
    if (problems.length) { exitCode = 1; problems.forEach((p) => console.log('  LABEL ERROR ' + p)); } else console.log('  Label check: bundled labels verified by construction (checksums, holder types).');
  }
  const sus = []; docs.forEach((d) => api.evSanity(d).forEach((x) => sus.push(x)));
  console.log('  Label sanity: ' + sus.length + ' span(s) look suspicious' + (sus.length ? ' (first 5: ' + sus.slice(0, 5).map((x) => x.doc + ' ' + x.label + ' ' + x.reason).join('; ') + ')' : ''));
  const res = api.runEval(docs, (t) => api.detect(t));
  const sum = api.evSummarize(res);
  console.log('  ' + sum.gold + ' labelled spans, ' + sum.pred + ' detections' + (sum.ignored ? ', ' + sum.ignored + ' on spans marked to ignore' : ''));
  if (!sum.gold) console.log('  No labelled spans: precision and recall cannot be calculated for this file.');
  table('Strict (exact span and type)', sum.strict);
  table('Relaxed (same type, at least half the span)', sum.relaxed);
  table('Cover (any type; found = 95% of the span covered)', sum.cover);
  const show = (arr, title) => {
    console.log('\n  ' + title + ' (' + arr.length + (arr.length > 25 ? ', first 25' : '') + ')');
    const byId = {}; docs.forEach((d) => { byId[d.id] = d; });
    arr.slice(0, 25).forEach((x) => console.log('   ' + x.doc + '  ' + x.type.padEnd(14) + (x.start + '-' + x.end).padEnd(10) + (x.covered ? ' covered as another type' : '') + (x.overlapsGold ? ' overlaps another labelled span' : '') + (flags.has('--show-text') ? '  "' + byId[x.doc].text.slice(x.start, x.end) + '"' : '')));
  };
  show(sum.misses, 'Missed detections'); show(sum.fps, 'False positives');
  const tags = [...new Set(docs.flatMap((d) => d.tags))].filter((t) => !['negative'].includes(t));
  if (tags.length > 1) {
    console.log('\n  By tag (relaxed micro)');
    tags.forEach((tg) => { const sub = docs.filter((d) => d.tags.includes(tg)); const s2 = api.evSummarize(api.runEval(sub, (t) => api.detect(t))).relaxed.micro; console.log('   ' + tg.padEnd(28) + String(sub.length).padStart(3) + ' docs  P ' + pct(s2.p) + '  R ' + pct(s2.r) + '  FP ' + s2.fp + '  FN ' + s2.fn); });
  }
  report.push({ file: path.basename(file), docs: docs.length, gold: sum.gold, pred: sum.pred, relaxed: sum.relaxed.micro, strict: sum.strict.micro, cover: sum.cover.micro });
});
if (flags.has('--json')) console.log('\n' + JSON.stringify(report, null, 2));
process.exit(exitCode);
