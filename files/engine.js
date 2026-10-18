'use strict';
/* Loads the detection engine and the scoring code straight out of blackout.html (between the ENGINE and EVAL markers),
   so the tests always exercise exactly what the page runs. No network, no files written. */
const fs = require('fs');
const path = require('path');

function readHtml(htmlPath) {
  const html = fs.readFileSync(htmlPath, 'utf8');
  const js = html.split('<script>')[1].split('</script>')[0];
  return { html, js };
}
function slice(js, from, to) {
  const a = js.indexOf(from), b = js.indexOf(to, a);
  if (a < 0 || b < 0) throw new Error('Could not find "' + from + '" ... "' + to + '" in blackout.html');
  return js.slice(a, b);
}
function loadEngine(htmlPath) {
  const { html, js } = readHtml(htmlPath);
  const code = slice(js, '/* ENGINE:BEGIN', '/* EVAL:END */') + '/* EVAL:END */';
  const names = ['detectCore', 'resolve', 'runEval', 'evSummarize', 'parseTestFile', 'evSanity', 'patternScan', 'ruleScan',
    'nameScan', 'expandItems', 'normalizeForScan', 'fixOcrDigits', 'aadhaarOk', 'verhoeffOk', 'luhn', 'EVAL_TYPES'];
  const api = new Function('loadScript', 'window', code + ';return {' + names.join(',') + '};')(async () => {}, {});
  api.detect = (text) => api.resolve(api.detectCore(text).cands);
  return { api, html, js };
}
const defaultHtml = path.resolve(__dirname, '..', '..', 'blackout.html');
module.exports = { loadEngine, readHtml, slice, defaultHtml };
