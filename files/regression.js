#!/usr/bin/env node
'use strict';
/* Regression tests: the detection and redaction behaviour that must keep working as the rules change.
   Usage: node tests/regression.js        (the Word test needs the "jszip" package; it is skipped with a note if it is missing) */
const { loadEngine, readHtml, slice, defaultHtml } = require('./lib/engine');
const { api, js } = loadEngine(defaultHtml);
let pass = 0, fail = 0, skipped = 0;
const failures = [];
function t(name, fn) { try { const r = fn(); if (r && typeof r.then === 'function') throw new Error('use tAsync for async tests'); pass++; } catch (e) { fail++; failures.push(name + ': ' + e.message); } }
async function tAsync(name, fn) { try { await fn(); pass++; } catch (e) { fail++; failures.push(name + ': ' + e.message); } }
const eq = (a, b, m) => { if (a !== b) throw new Error((m || 'expected') + ' ' + JSON.stringify(b) + ', got ' + JSON.stringify(a)); };
const ok = (c, m) => { if (!c) throw new Error(m || 'assertion failed'); };
const found = (text) => api.detect(text);
const covers = (text, sub, cat) => { const i = text.indexOf(sub); if (i < 0) throw new Error('bad test: "' + sub + '" not in text'); return found(text).some((r) => r.start <= i && r.end >= i + sub.length && (!cat || r.cat === cat)); };
const mustCover = (text, subs, cat) => subs.forEach((s) => ok(covers(text, s, cat), 'not covered: ' + s));
const mustSkip = (text, subs) => subs.forEach((s) => { const i = text.indexOf(s); ok(!found(text).some((r) => r.start < i + s.length && r.end > i), 'wrongly flagged: ' + s); });

/* ---------- detection that worked before this phase ---------- */
t('phones: Indian, landline, toll free, US, international', () => mustCover('Call +91 98765 43210 or 9876543210 or 098765-43210. Office 080-2345 6789, (080) 23456789, 1800-123-4567. US (415) 555-2671, +44 20 7946 0958.', ['+91 98765 43210', '9876543210', '098765-43210', '080-2345 6789', '(080) 23456789', '1800-123-4567', '(415) 555-2671', '+44 20 7946 0958'], 'Phone'));
t('emails incl. obfuscated', () => mustCover('mail priya.s@example.co.in, priya [at] example [dot] com, rahul at gmail dot com', ['priya.s@example.co.in', 'priya [at] example [dot] com', 'rahul at gmail dot com'], 'Email'));
t('cards and bank details', () => mustCover('Card 4111 1111 1111 1111 exp 08/27 CVV: 123. IBAN GB82 WEST 1234 5698 7654 32. A/c No: 123456789012, IFSC HDFC0001234', ['4111 1111 1111 1111', 'GB82 WEST 1234 5698 7654 32', '123456789012', 'HDFC0001234'], 'Financial'));
t('credentials', () => mustCover('password: hunter22\nAPI_KEY="abc123XYZ789" OTP is 482913, ATM PIN: 4321 postgres://admin:s3cret@db.example.com:5432/app AKIAIOSFODNN7EXAMPLE', ['hunter22', 'abc123XYZ789', '482913', '4321', 'postgres://admin:s3cret@db.example.com:5432/app', 'AKIAIOSFODNN7EXAMPLE'], 'Credential'));
t('names: labels, salutations, sign-offs, initials', () => mustCover('Name: Priya Sharma\nDear Anita,\n\nRegards,\nVikram Rao\nReviewed by John. D and K. Rajesh.', ['Priya Sharma', 'Anita', 'Vikram Rao', 'John. D', 'K. Rajesh'], 'Name'));
t('addresses: Indian, US, UK, multi-line', () => mustCover('House No. 45, 3rd Main, 2nd Cross, HSR Layout, Bengaluru, Karnataka 560102.\n123 Main St, Springfield, IL 62704\n10 Downing Street, London SW1A 2AA\nPriya\n12 MG Road\nBengaluru 560038', ['House No. 45, 3rd Main, 2nd Cross, HSR Layout, Bengaluru, Karnataka 560102', '123 Main St, Springfield, IL 62704', '10 Downing Street, London SW1A 2AA', '12 MG Road\nBengaluru 560038'], 'Address'));
t('dates of birth', () => mustCover('DOB: 14/03/1990, Date of Birth: 14 March 1990, born on March 14, 1990', ['14/03/1990', '14 March 1990', 'March 14, 1990'], 'Date of birth'));
t('plates', () => mustCover('Vehicle No: KA 01 AB 1234, car MH12DE1433', ['KA 01 AB 1234', 'MH12DE1433'], 'License plate'));
t('noise is left alone', () => mustSkip('Total 12345 and Invoice 560038. Part A and Section B. Vitamin D helps. Version 2.3.4 on 15 March 2024. Supreme Court, Washington. Hello World from the Green Park team.', ['12345', '560038', 'Part A', 'Section B', 'Vitamin D', '2.3.4', '15 March 2024', 'Supreme Court', 'Hello World']));
t('Kannada/Hindi labels and digits', () => { mustCover('ಹೆಸರು: ಪ್ರಿಯಾ ಶರ್ಮ\nनाम: प्रिया शर्मा\nमोबाइल: ९८७६५४३२१०', ['ಪ್ರಿಯಾ ಶರ್ಮ', 'प्रिया शर्मा', '९८७६५४३२१०']); });

/* ---------- this phase: validation and the gaps that were found ---------- */
t('Aadhaar verhoeff + first digit + palindrome', () => { ok(api.aadhaarOk('234123412346')); ok(!api.aadhaarOk('234123412345')); ok(!api.aadhaarOk('123412341234')); ok(!api.aadhaarOk('222222222222')); });
t('Aadhaar: unlabelled needs a valid check digit', () => { mustCover('ref 2341 2341 2346 end', ['2341 2341 2346'], 'ID number'); mustSkip('ref 2341 2341 2345 end', ['2341 2341 2345']); mustSkip('ref 1234 1234 1234 end', ['1234 1234 1234']); });
t('Aadhaar: a label makes an invalid number reviewable, with a note', () => { const text = 'Aadhaar No: 2341 2341 2345'; const r = found(text).find((x) => x.cat === 'ID number'); ok(r, 'labelled number not found'); eq(r.why, 'chk'); });
t('PAN: holder type letter is checked unless labelled', () => { mustCover('tax ABCPE1234F here', ['ABCPE1234F'], 'ID number'); mustSkip('part ABCDE1234F here', ['ABCDE1234F']); mustCover('PAN: ABCDE1234F', ['ABCDE1234F'], 'ID number'); });
t('4-4-4 numbers and IP addresses are not phone numbers', () => { const r = found('ref 2345 6789 0123 and server 192.168.3.163'); ok(!r.some((x) => x.cat === 'Phone'), 'typed as Phone'); mustCover('server 192.168.3.163', ['192.168.3.163'], 'Other'); });
t('long unlabelled digit strings are not typed as phone numbers', () => { const r = found('Please credit 50100234567891 today'); ok(!r.some((x) => x.cat === 'Phone')); });
t('a/c without a separator is Financial', () => mustCover('Beneficiary a/c 004501234567 IFSC SBIN0001234', ['004501234567'], 'Financial'));
t('email in words is covered completely', () => mustCover('write to priya dot sharma at example dot com today', ['priya dot sharma at example dot com'], 'Email'));
t('passwords written as pass: and pw=', () => { mustCover('login pass: Zx9!kLm2 for the portal and pw=Zx9!kLm2', ['Zx9!kLm2'], 'Credential'); mustSkip('pass: yes', ['yes']); });
t('born in context, and 14th of March', () => mustCover('Patient (born 14th of March 1990, age 34) arrived.', ['14th of March 1990'], 'Date of birth'));

/* ---------- merging ---------- */
t('resolve: partly overlapping detections are merged so nothing is left showing', () => { const r = api.resolve([{ start: 0, end: 10, cat: 'Name' }, { start: 6, end: 16, cat: 'Address' }]); eq(r.length, 1); eq(r[0].start, 0); eq(r[0].end, 16); });
t('resolve: higher-priority type wins an exact tie', () => { const r = api.resolve([{ start: 0, end: 5, cat: 'Phone' }, { start: 0, end: 5, cat: 'Financial' }]); eq(r.length, 1); eq(r[0].cat, 'Financial'); });
t('resolve keeps the reason a detection was made', () => eq(api.resolve([{ start: 0, end: 3, cat: 'Email', why: 'fmt' }])[0].why, 'fmt'));
t('detections carry a reason', () => ok(found('Name: Priya Sharma, priya@example.com').every((r) => r.why), 'a detection has no reason'));

/* ---------- scoring code ---------- */
t('scoring math on a hand-checked example', () => {
  const docs = [{ id: 'a', text: 'x'.repeat(40), spans: [{ start: 0, end: 5, label: 'Name' }, { start: 10, end: 15, label: 'Email' }, { start: 20, end: 25, label: 'Phone' }], ignore: [], tags: [] }];
  const detect = () => [{ start: 0, end: 5, cat: 'Name' }, { start: 10, end: 13, cat: 'Email' }, { start: 30, end: 35, cat: 'Name' }];
  const s = api.evSummarize(api.runEval(docs, detect));
  eq(s.strict.micro.tp, 1); eq(s.strict.micro.fp, 2); eq(s.strict.micro.fn, 2);
  eq(s.relaxed.micro.tp, 2); eq(s.relaxed.micro.fp, 1); eq(s.relaxed.micro.fn, 1);
  eq(Math.round(s.relaxed.micro.p * 1000), 667); eq(Math.round(s.relaxed.micro.r * 1000), 667);
  eq(s.cover.micro.tp, 1); eq(s.misses.length, 1); eq(s.fps.length, 1);
});
t('scoring: no labels means no recall, not a fake 100%', () => { const s = api.evSummarize(api.runEval([{ id: 'n', text: 'hello', spans: [], ignore: [], tags: [] }], () => [])); eq(s.relaxed.micro.r, null); eq(s.relaxed.micro.p, null); });
t('scoring: detections on spans marked to ignore are not false positives', () => { const s = api.evSummarize(api.runEval([{ id: 'i', text: 'Acme Ltd paid', spans: [], ignore: [{ start: 0, end: 8 }], tags: [] }], () => [{ start: 0, end: 8, cat: 'Name' }])); eq(s.fps.length, 0); eq(s.ignored, 1); });
t('parseTestFile rejects out-of-range spans and unscored labels', () => { const r = api.parseTestFile('{"id":"1","text":"abc","spans":[{"start":0,"end":9,"label":"Name"},{"start":0,"end":2,"label":"Company"},{"start":0,"end":2,"label":"Name"}]}'); eq(r.docs[0].spans.length, 1); ok(r.errors.length === 2); });

/* ---------- redaction output (text) ---------- */
t('text redaction: labels, blocks, excluded items and off categories', () => {
  const code = slice(js, 'function coverText', 'function outExt');
  const mk = (state) => new Function('state', 'CAT_MANUAL', "function isCovered(r){ return !state.off.has(r.cat) && !r.revealed; }\n" + code + ';return outputText;')(state, 'Added by you');
  const base = { text: 'Hi Priya, mail priya@x.com now', off: new Set(), mode: 'labels', ranges: [{ start: 3, end: 8, cat: 'Name', revealed: false }, { start: 15, end: 26, cat: 'Email', revealed: false }] };
  eq(mk(base)(), 'Hi [NAME], mail [EMAIL] now');
  eq(mk(Object.assign({}, base, { mode: 'blocks' }))(), 'Hi \u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588, mail \u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588 now');
  eq(mk(Object.assign({}, base, { ranges: [{ start: 3, end: 8, cat: 'Name', revealed: true }, base.ranges[1]] }))(), 'Hi Priya, mail [EMAIL] now');
  eq(mk(Object.assign({}, base, { off: new Set(['Email']) }))(), 'Hi [NAME], mail priya@x.com now');
  eq(mk(Object.assign({}, base, { ranges: [{ start: 3, end: 8, cat: 'Added by you', revealed: false }] }))(), 'Hi [REDACTED], mail priya@x.com now');
});

/* ---------- privacy: static checks on the page itself ---------- */
t('privacy: no upload or storage APIs in the page', () => {
  const { html } = readHtml(defaultHtml);
  ['api.anthropic.com', 'localStorage', 'sessionStorage', 'XMLHttpRequest', 'sendBeacon', 'indexedDB', 'document.cookie', 'WebSocket'].forEach((w) => ok(!html.includes(w), 'found ' + w));
  ok(!/method\s*:\s*['"]POST['"]/i.test(html), 'a POST request is present');
  const fetches = [...js.matchAll(/fetch\(([^)]*)\)/g)].map((m) => m[1]);
  ok(fetches.length === 1 && /pdf\.worker/.test(fetches[0]), 'unexpected fetch: ' + fetches.join(' ; '));
});
t('privacy: console calls only ever receive an error object', () => { const calls = [...js.matchAll(/console\.\w+\(([^)]*)\)/g)].map((m) => m[1].trim()); ok(calls.length > 0); calls.forEach((c) => eq(c, 'e', 'console argument')); });

/* ---------- baselines on the bundled synthetic data: scores must not drop ---------- */
t('baseline: synthetic sample (hard cases excluded) stays high', () => {
  const fs = require('fs'), path = require('path');
  const docs = api.parseTestFile(fs.readFileSync(path.join(__dirname, 'data', 'synthetic-sample.jsonl'), 'utf8')).docs.filter((d) => !d.tags.includes('hard'));
  const m = api.evSummarize(api.runEval(docs, (x) => api.detect(x))).relaxed.micro;
  ok(m.p >= 0.98, 'precision ' + m.p); ok(m.r >= 0.98, 'recall ' + m.r);
});
t('baseline: Indian identifier file is exact', () => {
  const fs = require('fs'), path = require('path');
  const docs = api.parseTestFile(fs.readFileSync(path.join(__dirname, 'data', 'indian-ids.jsonl'), 'utf8')).docs;
  const m = api.evSummarize(api.runEval(docs, (x) => api.detect(x))).strict.micro;
  eq(m.fp, 0, 'false positives'); eq(m.fn, 0, 'missed');
});

/* ---------- Word (.docx): formatting kept, split runs handled, tracked deletions and author removed ---------- */
(async () => {
  let JSZip = null;
  try { JSZip = require('jszip'); } catch (e) {
    try { const root = require('child_process').execSync('npm root -g', { encoding: 'utf8' }).trim(); JSZip = require(require('path').join(root, 'docx', 'node_modules', 'jszip')); } catch (e2) { /* not available */ }
  }
  if (!JSZip) { skipped++; console.log('SKIPPED Word tests (install the "jszip" package to run them)'); }
  else {
    const shim = require('./lib/domshim');
    const code = slice(js, '/* ---------- Word (.docx)', 'async function readFile');
    const state = { off: new Set(), mode: 'labels', ranges: [], fmt: null };
    const env = new Function('state', 'window', 'DOMParser', 'XMLSerializer', 'loadScript', 'CAT_MANUAL', "function isCovered(r){ return !state.off.has(r.cat) && !r.revealed; }\n" + slice(js, 'function coverText', 'function outExt') + code + ';return {loadDocx,buildDocx};')
      (state, { JSZip }, shim.DOMParser, shim.XMLSerializer, async () => {}, 'Added by you');
    const fixed = JSZip;
    const build = async () => {
      const zip = new fixed();
      zip.file('word/document.xml', '<?xml version="1.0"?><w:document><w:body><w:p><w:r><w:t xml:space="preserve">Name: Priya </w:t></w:r><w:r><w:t>Sharma</w:t></w:r></w:p><w:p><w:r><w:t xml:space="preserve">Call +91 98765 </w:t></w:r><w:r><w:tab/><w:t>43210 now, mail priya@example.com.</w:t></w:r></w:p><w:p><w:del><w:r><w:delText>secret 4111 1111 1111 1111</w:delText></w:r></w:del><w:r><w:t>Address: 12 MG Road</w:t></w:r></w:p><w:p><w:r><w:t>Bengaluru 560001</w:t></w:r></w:p></w:body></w:document>');
      zip.file('docProps/core.xml', '<cp:coreProperties><dc:creator>Jane Doe</dc:creator><cp:lastModifiedBy>J Smith</cp:lastModifiedBy></cp:coreProperties>');
      const buf = await zip.generateAsync({ type: 'nodebuffer' });
      return { arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length) };
    };
    await tAsync('docx: redaction across split runs, deleted text and author removed', async () => {
      const dx = await env.loadDocx(await build());
      ok(!dx.text.includes('4111'), 'deleted tracked text should not be read');
      state.ranges = api.detect(dx.text).map((r) => ({ start: r.start, end: r.end, cat: r.cat, revealed: false }));
      state.fmt = { kind: 'docx', ext: 'docx', zip: dx.zip, parts: dx.parts, paras: dx.paras };
      const sink = { generateAsync: dx.zip.generateAsync.bind(dx.zip) };
      dx.zip.generateAsync = (o) => sink.generateAsync(Object.assign({}, o, { type: 'nodebuffer' }));
      const out = await JSZip.loadAsync(await env.buildDocx());
      const xml = await out.file('word/document.xml').async('string');
      ok(xml.includes('[NAME]') && xml.includes('[PHONE]') && xml.includes('[EMAIL]') && xml.includes('[ADDRESS]'), 'labels missing: ' + xml);
      ok(!/Priya|Sharma|98765|43210|priya@|MG Road|560001/.test(xml), 'original text still present');
      const core = await out.file('docProps/core.xml').async('string');
      ok(!/Jane|Smith/.test(core), 'author still present');
    });
    await tAsync('docx: building twice after un-covering an item is idempotent', async () => {
      const dx = await env.loadDocx(await build());
      state.ranges = api.detect(dx.text).map((r) => ({ start: r.start, end: r.end, cat: r.cat, revealed: false }));
      state.fmt = { kind: 'docx', ext: 'docx', zip: dx.zip, parts: dx.parts, paras: dx.paras };
      dx.zip.generateAsync = ((orig) => (o) => orig(Object.assign({}, o, { type: 'nodebuffer' })))(dx.zip.generateAsync.bind(dx.zip));
      await env.buildDocx(); state.ranges[0].revealed = true;
      const xml = await (await JSZip.loadAsync(await env.buildDocx())).file('word/document.xml').async('string');
      ok(xml.includes('Priya Sharma') || (xml.includes('Priya') && xml.includes('Sharma')), 'revealed item not restored');
      ok(!xml.includes('priya@example.com'), 'other items must stay covered');
    });
  }
  console.log('\nRegression: ' + pass + ' passed, ' + fail + ' failed' + (skipped ? ', ' + skipped + ' skipped' : ''));
  failures.forEach((f) => console.log('  FAIL ' + f));
  process.exit(fail ? 1 : 0);
})();
