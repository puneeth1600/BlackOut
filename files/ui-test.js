#!/usr/bin/env node
'use strict';
/* Browser-level checks of the real page: review before covering, apply, download, the in-page test panel, and what the page sends over the network.
   Needs the "playwright" package and a Chromium it can launch. All external requests are blocked, so nothing leaves the machine while this runs.
   Usage: node tests/ui-test.js */
const path = require('path');
const fs = require('fs');
let pw;
try { pw = require('playwright'); } catch (e) { pw = require(path.join(require('child_process').execSync('npm root -g', { encoding: 'utf8' }).trim(), 'playwright')); }
const { loadEngine, defaultHtml } = require('./lib/engine');
const { api } = loadEngine(defaultHtml);

let pass = 0, fail = 0; const failures = [];
const ok = (c, m) => { if (c) pass++; else { fail++; failures.push(m); } };

(async () => {
  const browser = await pw.chromium.launch();
  const page = await browser.newPage({ acceptDownloads: true });
  const requests = [], errors = [];
  page.on('request', (r) => requests.push({ url: r.url(), method: r.method(), body: r.postData() }));
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route(/^https?:/, (route) => route.abort());          /* offline: libraries cannot load; the page must cope */
  await page.goto('file://' + defaultHtml);

  const sample = 'Name: Priya Sharma\nEmail: priya@example.com\nPhone: +91 98450 12345\nAadhaar: 2341 2341 2346\nRef 2341 2341 2345 is a work order code.\n';
  await page.click('#togglePaste');
  await page.fill('#pasteArea', sample);
  await page.click('#scanPaste');
  await page.waitForSelector('#result:not(.hidden)', { timeout: 15000 });

  /* 1. review: highlighted, nothing covered, no download yet */
  ok(await page.isVisible('#reviewBar'), 'review bar should be visible after analysis');
  ok(await page.isDisabled('#download'), 'download must be disabled while reviewing');
  ok(await page.isDisabled('#copy'), 'copy must be disabled while reviewing');
  const hl = await page.$$eval('#doc button.r.hl', (b) => b.map((x) => x.textContent));
  ok(JSON.stringify(hl) === JSON.stringify(['Priya Sharma', 'priya@example.com', '+91 98450 12345', '2341 2341 2346']), 'expected exactly the name, email, phone and valid Aadhaar to be highlighted, got ' + JSON.stringify(hl));
  ok(!hl.some((t) => t.includes('2341 2341 2345')), 'the invalid-checksum number must not be highlighted');
  const docText = await page.$eval('#doc', (d) => d.textContent);
  ok(docText === sample, 'the document text must be unchanged while reviewing');
  ok(await page.$$eval('#doc button.r:not(.hl)', (b) => b.length) === 0, 'nothing may be covered during review');
  ok(/detections will be covered/.test(await page.textContent('#count')), 'count line should describe the review');
  const tip = await page.$eval('#doc button.r.hl', (b) => b.title);
  ok(/\(/.test(tip), 'each highlight should say why it was flagged: ' + tip);

  /* 2. exclude one detection, then apply */
  await page.click('#doc button.r.hl:has-text("priya@example.com")');
  ok(await page.$eval('#doc button.r.hl:has-text("priya@example.com")', (b) => b.classList.contains('excl')), 'selected highlight should become excluded');
  await page.click('#applyBtn');
  ok(!(await page.isVisible('#reviewBar')), 'review bar should hide after applying');
  ok(await page.isEnabled('#download'), 'download should be enabled after applying');
  const covered = await page.$$eval('#doc button.r:not(.shown)', (b) => b.map((x) => x.textContent));
  ok(covered.includes('Name') && covered.includes('Phone') && covered.includes('ID number'), 'covered labels missing: ' + JSON.stringify(covered));
  ok(await page.$eval('#doc', (d) => d.textContent.includes('priya@example.com')), 'the excluded email must stay visible');

  /* 3. the downloaded file */
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#download')]);
  const file = await dl.path(); const out = fs.readFileSync(file, 'utf8');
  ok(/redacted\.txt$/.test(dl.suggestedFilename()), 'download keeps the text format: ' + dl.suggestedFilename());
  ok(out.includes('[NAME]') && out.includes('[PHONE]') && out.includes('[ID NUMBER]'), 'redaction labels missing: ' + out);
  ok(!/Priya|Sharma|98450|2341 2341 2346/.test(out), 'covered values must not appear in the file');
  ok(out.includes('priya@example.com') && out.includes('2341 2341 2345'), 'excluded and unflagged text must stay');

  /* 4. back to review */
  await page.click('#backReview');
  ok(await page.isVisible('#reviewBar') && await page.isDisabled('#download'), 'back to review should restore the review state');

  /* 5. the in-page test panel gives the same numbers as the Node runner */
  await page.click('#reset');
  await page.waitForSelector('#intake:not(.hidden)');
  await page.click('#devtest summary');
  await page.setInputFiles('#ttFile', path.join(__dirname, 'data', 'synthetic-sample.jsonl'));
  await page.waitForFunction(() => /test documents loaded/.test(document.getElementById('ttInfo').textContent));
  await page.click('#ttRunBtn');
  await page.waitForFunction(() => /Cover \(any type\)/.test(document.getElementById('ttOut').textContent), { timeout: 30000 });
  const panel = await page.$eval('#ttOut', (e) => e.innerText);
  const docs = api.parseTestFile(fs.readFileSync(path.join(__dirname, 'data', 'synthetic-sample.jsonl'), 'utf8')).docs;
  const sum = api.evSummarize(api.runEval(docs, (t) => api.detect(t)));
  const fmt = (x) => (x * 100).toFixed(1) + '%';
  ok(panel.includes(fmt(sum.relaxed.micro.p)) && panel.includes(fmt(sum.relaxed.micro.r)), 'panel precision/recall should match the Node runner (' + fmt(sum.relaxed.micro.p) + ', ' + fmt(sum.relaxed.micro.r) + ')');
  ok(/Missed detections \(\d+\)/.test(panel) && /False positives \(\d+\)/.test(panel), 'panel should list misses and false positives');
  ok(!/Zubaida|Hiremath|Kolhatkar/.test(panel), 'the panel must not show text excerpts unless asked');
  await page.check('#ttShow'); await page.click('#ttRunBtn');
  await page.waitForFunction(() => /“/.test(document.getElementById('ttOut').textContent), { timeout: 30000 });
  ok(true, 'excerpts appear when asked');

  /* 5b. images: review tint, drawing a box, solid cover and blur, and the downloaded PNG */
  const sharp = require(path.join(require('child_process').execSync('npm root -g', { encoding: 'utf8' }).trim(), 'sharp'));
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200"><defs><pattern id="p" width="16" height="16" patternUnits="userSpaceOnUse"><rect width="8" height="8" fill="#000"/><rect x="8" y="8" width="8" height="8" fill="#000"/></pattern></defs><rect x="50" y="50" width="100" height="40" fill="#888"/><rect x="240" y="40" width="120" height="120" fill="url(#p)"/></svg>';
  const png = await sharp({ create: { width: 400, height: 200, channels: 3, background: '#ffffff' } }).composite([{ input: Buffer.from(svg), top: 0, left: 0 }]).png().toBuffer();
  const tmp = path.join(require('os').tmpdir(), 'blackout-ui-test.png'); fs.writeFileSync(tmp, png);
  await page.setInputFiles('#file', tmp);
  await page.waitForSelector('#result:not(.hidden)', { timeout: 20000 });
  ok(await page.isVisible('#imgWrap') && /Apply redaction/.test(await page.textContent('#hint')), 'image result should open in review');
  if (!(await page.$eval('#drawToggle', (b) => b.getAttribute('aria-pressed') === 'true'))) await page.click('#drawToggle');
  const settle = async () => { let last = -1, same = 0; while (same < 3) { const y = await page.evaluate(() => window.scrollY); same = y === last ? same + 1 : 0; last = y; await page.waitForTimeout(120); } };
  const drag = async (x0, y0, x1, y1) => {
    await settle();
    /* the page scrolls smoothly to the result, so jump instantly and measure right before dragging */
    const cv = await page.$eval('#imgCanvas', (c) => { c.scrollIntoView({ block: 'center', behavior: 'instant' }); const r = c.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
    await page.mouse.move(cv.x + cv.w * x0 / 400, cv.y + cv.h * y0 / 200); await page.mouse.down();
    await page.mouse.move(cv.x + cv.w * x1 / 400, cv.y + cv.h * y1 / 200, { steps: 6 }); await page.mouse.up();
  };
  const px = (x, y) => page.$eval('#imgCanvas', (c, [x, y]) => Array.from(c.getContext('2d').getImageData(x, y, 1, 1).data), [x, y]);
  await drag(50, 50, 150, 90);                                    /* solid box over the grey rectangle */
  ok((await page.$$eval('#chips .chip', (c) => c.map((x) => x.textContent))).some((t) => /Added by you/.test(t)), 'a drawn box should appear as "Added by you"');
  const tint = await px(100, 70);
  ok(tint[0] > 150 && tint[0] < 200, 'during review a box must be a light tint (neither the original grey 136 nor a cover); pixel ' + tint);
  await page.click('#fxBlur');
  await drag(250, 50, 350, 150);                                  /* blur box over the checkerboard */
  await page.click('#applyBtn');
  const solid = await px(100, 70);
  ok(solid[0] < 10 && solid[1] < 10 && solid[2] < 10, 'applied solid cover should be black; pixel ' + solid);
  const [dlImg] = await Promise.all([page.waitForEvent('download'), page.click('#download')]);
  ok(/-redacted\.png$/.test(dlImg.suggestedFilename()), 'image keeps its format: ' + dlImg.suggestedFilename());
  const raw = await sharp(await dlImg.path()).raw().toBuffer({ resolveWithObject: true });
  const at = (x, y) => Array.from(raw.data.slice((y * raw.info.width + x) * raw.info.channels, (y * raw.info.width + x) * raw.info.channels + 3));
  ok(raw.info.width === 400 && raw.info.height === 200, 'size should be unchanged');
  ok(at(100, 70).every((v) => v < 10), 'file: solid box should be black');
  ok(at(10, 10).every((v) => v > 245), 'file: untouched area should be unchanged');
  const blurred = [at(300, 100), at(301, 101), at(280, 90), at(320, 120)];
  ok(blurred.every((p2) => p2[0] > 60 && p2[0] < 200), 'file: blur box should be mid-grey, not the original black/white pattern: ' + JSON.stringify(blurred));

  /* 6. privacy: only library fetches, nothing carries document content */
  const external = requests.filter((r) => /^https?:/.test(r.url));
  const allowed = /^https:\/\/(unpkg\.com|cdn\.jsdelivr\.net|cdnjs\.cloudflare\.com|storage\.googleapis\.com|tessdata\.projectnaptha\.com)\//;
  ok(external.every((r) => allowed.test(r.url)), 'unexpected host: ' + external.map((r) => r.url).filter((u) => !allowed.test(u)).join(', '));
  ok(requests.every((r) => r.method === 'GET' && !r.body), 'a non-GET request or a request body was sent');
  ok(!requests.some((r) => /Priya|priya|98450|2341/.test(decodeURIComponent(r.url))), 'document content appeared in a URL');
  ok(errors.length === 0, 'page errors: ' + errors.join(' | '));

  await browser.close();
  console.log('UI tests: ' + pass + ' checks passed, ' + fail + ' failed');
  failures.forEach((f) => console.log('  FAIL ' + f));
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('UI test crashed: ' + e.message); process.exit(1); });
