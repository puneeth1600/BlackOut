'use strict';
/* Generates the hand-authored synthetic test files in tests/data/ (seeded, so the output is reproducible).
   Every person, address, number and key below is invented. Aadhaar numbers get a valid Verhoeff check digit, card numbers a valid
   Luhn check digit, and PANs a valid holder-type letter, so the labels are correct by construction rather than by trusting a detector.
   Run: node tests/tools/make-synthetic.js */
const fs = require('fs');
const path = require('path');

function rng(seed) { return function () { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const R = rng(20240607);
const pick = (a) => a[Math.floor(R() * a.length)];
const digs = (n) => { let s = ''; for (let i = 0; i < n; i++) s += Math.floor(R() * 10); return s; };
const letters = (n, set) => { set = set || 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'; let s = ''; for (let i = 0; i < n; i++) s += set[Math.floor(R() * set.length)]; return s; };
const alnum = (n) => letters(n, 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789');

/* --- checksums --- */
const D = [[0,1,2,3,4,5,6,7,8,9],[1,2,3,4,0,6,7,8,9,5],[2,3,4,0,1,7,8,9,5,6],[3,4,0,1,2,8,9,5,6,7],[4,0,1,2,3,9,5,6,7,8],[5,9,8,7,6,0,4,3,2,1],[6,5,9,8,7,1,0,4,3,2],[7,6,5,9,8,2,1,0,4,3],[8,7,6,5,9,3,2,1,0,4],[9,8,7,6,5,4,3,2,1,0]];
const P = [[0,1,2,3,4,5,6,7,8,9],[1,5,7,6,2,8,3,0,9,4],[5,8,0,3,7,9,6,1,4,2],[8,9,1,6,0,4,3,5,2,7],[9,4,5,3,1,2,6,8,7,0],[4,2,8,6,5,7,3,9,0,1],[2,7,9,3,8,0,6,4,1,5],[7,0,4,6,9,1,3,2,5,8]];
const verhoeffOk = (n) => { let c = 0; n.split('').reverse().forEach((x, i) => { c = D[c][P[i % 8][+x]]; }); return c === 0; };
function aadhaar(valid) {
  for (;;) {
    const base = String(2 + Math.floor(R() * 8)) + digs(10);
    for (let c = 0; c < 10; c++) {
      const n = base + c;
      if (valid ? verhoeffOk(n) : !verhoeffOk(n)) { if (n !== n.split('').reverse().join('')) return n; }
    }
  }
}
const grp = (n) => n.slice(0, 4) + ' ' + n.slice(4, 8) + ' ' + n.slice(8);
function luhnCard() {
  const base = '4' + digs(14); let s = 0, alt = true;
  for (let i = base.length - 1; i >= 0; i--) { let n = +base[i]; if (alt) { n *= 2; if (n > 9) n -= 9; } s += n; alt = !alt; }
  return base + ((10 - s % 10) % 10);
}
const cardFmt = (n) => n.replace(/(\d{4})(?=\d)/g, '$1 ');
const pan = (valid) => letters(3) + (valid ? pick('PCHFATBLJG'.split('')) : pick('DEIKMNOQRSUVWXYZ'.split(''))) + letters(1) + digs(4) + letters(1);

/* --- invented pools. "listed" first names and surnames are ones Blackout's built-in list contains, "unlisted" are not --- */
const FIRST_L = ['Priya', 'Rahul', 'Anil', 'Meera', 'Suresh', 'Divya', 'Vikram', 'Neha', 'Sarah', 'James', 'Emily', 'Daniel', 'Kavita', 'Rohit'];
const FIRST_U = ['Ravindra', 'Chinmay', 'Zubaida', 'Oluwaseun', 'Nandish', 'Tejaswini', 'Lakshmikanth', 'Brinda', 'Yamini', 'Kaveri', 'Thandiwe'];
const LAST_L = ['Sharma', 'Kumar', 'Reddy', 'Iyer', 'Patel', 'Nair', 'Gowda', 'Smith', 'Johnson', 'Garcia'];
const LAST_U = ['Hiremath', 'Kamalakar', 'Bhandarkar', 'Okonkwo', 'Shettigar', 'Kolhatkar', 'Patwardhan', 'Chinnaswamy', 'Venkataramanappa'];
const full = (unl) => unl ? pick(FIRST_U) + ' ' + pick(LAST_U) : pick(FIRST_L) + ' ' + pick(LAST_L);
const email = (n) => { const [f, l] = n.toLowerCase().split(' '); return pick([f + '.' + l, f + l[0], l + '.' + f]) + pick(['@example.com', '@example.org', '@mail.example.in']); };
const LOC = ['Indiranagar', 'Koramangala', 'Jayanagar', 'Malleshwaram', 'Whitefield', 'Basavanagudi'];
const phoneIN = () => pick(['+91 ', '+91-', '', '0']) + pick('6789'.split('')) + digs(4) + pick([' ', '-', '']) + digs(5);
const phoneUS = () => pick(['(415) 555-', '415-555-', '415.555.', '+1 415 555 ']) + digs(4);
const phoneLL = () => '080-' + pick('2345'.split('')) + digs(3) + ' ' + digs(4);
const addrIN = () => pick(['No. ' + (1 + Math.floor(R() * 99)) + ', ' + pick(['2nd', '3rd', '7th', '12th']) + ' Cross, ' + pick(LOC) + ', Bengaluru - 5600' + digs(2),
  (1 + Math.floor(R() * 300)) + ' ' + pick(['MG', 'Residency', 'Brigade', 'Church']) + ' Road, ' + pick(LOC) + ', Bengaluru 5600' + digs(2),
  'Flat ' + (1 + Math.floor(R() * 20)) + pick(['A', 'B', 'C']) + ', Rose Apartments, ' + pick(LOC) + ', Bengaluru, Karnataka 5600' + digs(2)]);
const addrUS = () => (100 + Math.floor(R() * 8900)) + ' ' + pick(['Maple', 'Oak', 'Cedar', 'Lakeview']) + ' ' + pick(['Street', 'Avenue', 'Road', 'Lane']) + ', ' + pick(['Springfield, IL', 'Columbus, OH', 'Austin, TX', 'Denver, CO']) + ' ' + pick(['62704', '43004', '78701', '80202']);
const dob = () => pick(['14/03', '02/11', '27/08', '09/01']) + '/' + (1960 + Math.floor(R() * 45));
const dobWords = () => pick(['14 March', '2 November', '27 August', '9 January']) + ' ' + (1960 + Math.floor(R() * 45));

/* --- document builder: parts are plain strings or [text, label] pairs; spans are computed from the parts --- */
const docs = [];
let counter = 0;
function add(parts, tags, file) {
  let text = ''; const spans = [];
  parts.forEach((p) => { if (typeof p === 'string') text += p; else { spans.push({ start: text.length, end: text.length + p[0].length, label: p[1] }); text += p[0]; } });
  (file || docs).push({ id: 'syn-' + String(++counter).padStart(3, '0'), text, spans, tags: tags || [] });
}
const N = (v) => [v, 'Name'], E = (v) => [v, 'Email'], PH = (v) => [v, 'Phone'], AD = (v) => [v, 'Address'], ID = (v) => [v, 'ID number'],
  FI = (v) => [v, 'Financial'], CR = (v) => [v, 'Credential'], DB = (v) => [v, 'Date of birth'], OT = (v) => [v, 'Other'];

/* contact blocks (labelled) */
for (let i = 0; i < 14; i++) { const n = full(i % 3 === 0); add(['Customer record\nName: ', N(n), '\nEmail: ', E(email(n)), '\nMobile: ', PH(i % 2 ? phoneIN() : phoneUS()), '\nAddress: ', AD(i % 2 ? addrIN() : addrUS()), '\nDOB: ', DB(dob()), '\n']); }
/* letters and emails with salutations and sign-offs */
for (let i = 0; i < 10; i++) { const n = full(false), f = n.split(' ')[0], m = full(false); add(['Dear ', N(f), ',\n\nThanks for your note about the delivery. Please call me on ', PH(phoneIN()), ' or write to ', E(email(n)), '.\n\nRegards,\n', N(m), '\n']); }
/* KYC style forms (Indian identifiers) */
for (let i = 0; i < 10; i++) { const n = full(i % 4 === 0); add(['KYC form\nApplicant: ', N(n), '\nPAN: ', ID(pan(true)), '\nAadhaar: ', ID(grp(aadhaar(true))), '\nContact: ', PH(phoneIN()), '\nAddress: ', AD(addrIN()), '\n']); }
/* financial */
for (let i = 0; i < 10; i++) { const c = luhnCard(); add(['Payment details\nCard number: ', FI(cardFmt(c)), '\nCVV: ', FI(digs(3)), '\nBank account no: ', FI(digs(12)), '\nIFSC: ', FI('HDFC0' + alnum(6).toUpperCase()), '\nUPI: ', FI(letters(6, 'abcdefghijklmnopqrstuvwxyz') + digs(2) + pick(['@okhdfcbank', '@oksbi', '@ybl', '@paytm'])), '\n']); }
for (let i = 0; i < 4; i++) add(['Wire to IBAN ', FI('GB' + digs(2) + ' ' + letters(4) + ' ' + digs(4) + ' ' + digs(4) + ' ' + digs(4) + ' ' + digs(2)), ' SWIFT: ', FI(letters(6) + 'XX'), ' routing number: ', FI(digs(9)), '.\n']);
/* credentials */
for (let i = 0; i < 10; i++) add(['Portal login\nusername: ', OT(pick(['svc_', 'user.', 'adm-']) + digs(3)), '\npassword: ', CR(alnum(6) + pick(['!', '#', '@']) + digs(2)), '\nOTP is ', CR(digs(6)), '\nATM PIN: ', CR(digs(4)), '\n']);
for (let i = 0; i < 4; i++) add(['export API_KEY="', CR('sk-' + alnum(32)), '"\naws key ', CR('AKIA' + letters(16, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567')), '\n']);
add(['my password is ', CR('Tr0ub4dor&3'), ' and pw=', CR('Zx9!kLm2'), '\n']);
add(['login pass: ', CR('Zx9!kLm2Qa'), '\n']);
/* HR records with ID numbers and dates of birth in context */
for (let i = 0; i < 8; i++) { const n = full(false); add(['Employee ID: ', ID('EMP-' + digs(5)), '\nName: ', N(n), '\nDate of Birth: ', DB(dobWords()), '\nPassport Number: ', ID(pick('KLMNPRSTW'.split('')) + digs(7)), '\nSSN ', ID(digs(3).replace(/^(000|666|9)/, '1$1').slice(0, 3) + '-' + digs(2).replace('00', '12') + '-' + digs(4)), '\n']); }
for (let i = 0; i < 4; i++) { add(['The patient (born ', DB('14th of March ' + (1960 + i * 7)), ', age ' + (30 + i) + ') arrived at noon.\n']); }
/* structured text */
for (let i = 0; i < 6; i++) { const n = full(false); add(['{"customer": {"name": "', N(n), '", "email": "', E(email(n)), '", "phone": "', PH(phoneIN()), '"}}\n']); }
for (let i = 0; i < 4; i++) { const n = full(false); add(['<contact>\n  <name>', N(n), '</name>\n  <email>', E(email(n)), '</email>\n</contact>\n']); }
/* obfuscated email, urls, network */
add(['Write to ', E('priya dot sharma at example dot com'), ' for the form.\n']);
add(['Server ', OT('192.168.' + digs(1) + '.' + (10 + Math.floor(R() * 200))), ' and handle ', OT('@priya_s' + digs(2)), '.\n']);
/* names with initials */
for (let i = 0; i < 8; i++) { const ini = pick([['John. D', 'John D'], ['Priya S.', 'Priya S'], ['K. Rajesh', 'K. Rajesh'], ['Rajesh K', 'Rajesh K'], ['A.P.J. Abdul Kalam', 'A.P.J. Abdul Kalam']]); add(['Reviewed by ', N(ini[0]), ' and approved.\n']); }
/* hard cases: Blackout is known to miss these (tagged so they can be reported separately) */
for (let i = 0; i < 6; i++) { const n = full(true); add(['The loan was approved by ', N(n), ' after review.\n'], ['hard']); }
for (let i = 0; i < 4; i++) add(['please send it to ', AD((10 + i) + ' mg road, bangalore 5600' + digs(2)), ' today\n'], ['hard']);
for (let i = 0; i < 4; i++) add(['Please credit ', FI(digs(14)), ' today.\n'], ['hard']);
/* negatives: no sensitive content */
const NEG = [
  'The quarterly report covers 2023 revenue of 1,234,567.89 USD across 12 regions; see Table 5 on page 12.\n',
  'Invoice #INV-2024-0042 Date: 15 Mar 2024\nQty 12  Unit price 1,250.00  Total 15,000.00\nPage 3 of 12\n',
  'const x = 192; // returns 3.14\nfunction add(a,b){return a+b}\nHTTP/1.1 200 OK\nSee RFC 2616 section 14.9 and ISO 8601\n',
  'The sample (n = 1,024) showed a mean of 12.5 ± 3.2 mg/L at 37 °C; p < 0.05 (see Fig. 3, Table 2).\n',
  'Part A and Section B. Vitamin D helps. Grade A. Plan B. Phase 2, Block A. Chapter 5, Section 3.\n',
  'The Supreme Court heard the appeal on Monday. Hello World from the Green Park team.\n',
  'Version 2.3.4 was released on 15 March 2024. Call it a day.\n',
  'Total 12345 and Invoice 560038, Order 560038 shipped, ref 123456.\n',
  'Meeting notes: discuss budget, hiring plan and the roadmap for Q3. Action items are listed below.\n',
  'Tower 3, Floor 2. The main hall holds 500 people. Doors open at 5 pm.\n',
  'Aadhaar numbers must be 12 digits. PAN has ten characters. Never share either one by email.\n',
];
NEG.forEach((t) => add([t], ['negative']));
for (let i = 0; i < 4; i++) add(['Reference ', aadhaar(false).replace(/(\d{4})(\d{4})(\d{4})/, '$1 $2 $3'), ' is a work order code, not a person.\n'], ['negative']);
for (let i = 0; i < 3; i++) add(['Code ', pan(false), ' appears in the inventory list.\n'], ['negative']);
add(['Order number 5551234567 was dispatched.\n'], ['negative', 'hard']);

/* --- Indian identifier file --- */
const idDocs = []; counter = 0;
for (let i = 0; i < 10; i++) add(['Customer ', ID(grp(aadhaar(true))), ' verified.\n'], ['unlabelled-valid'], idDocs);
for (let i = 0; i < 6; i++) add(['Number ', ID(aadhaar(true)), ' on file.\n'], ['unlabelled-valid', 'no-spaces'], idDocs);
for (let i = 0; i < 6; i++) add(['Aadhaar No: ', ID(grp(aadhaar(true))), '\n'], ['labelled-valid'], idDocs);
for (let i = 0; i < 6; i++) add(['UID: ', ID(grp(aadhaar(false))), ' (typo in last digit)\n'], ['labelled-invalid-checksum'], idDocs);
for (let i = 0; i < 8; i++) add(['Ref ', grp(aadhaar(false)), ' is an internal code.\n'], ['negative', 'unlabelled-invalid-checksum'], idDocs);
for (let i = 0; i < 3; i++) add(['Ref ', '1' + digs(3) + ' ' + digs(4) + ' ' + digs(4), ' and ', '0' + digs(3) + ' ' + digs(4) + ' ' + digs(4), ' are not Aadhaar numbers.\n'], ['negative', 'bad-first-digit'], idDocs);
for (let i = 0; i < 4; i++) add(['Tax ID ', ID(pan(true)), ' belongs to the vendor.\n'], ['pan-valid'], idDocs);
for (let i = 0; i < 4; i++) add(['PAN: ', ID(pan(false)), ' (as written on the form)\n'], ['pan-labelled-bad-type'], idDocs);
for (let i = 0; i < 6; i++) add(['Part code ', pan(false), ' in stock.\n'], ['negative', 'pan-unlabelled-bad-type'], idDocs);
for (let i = 0; i < 3; i++) add(['Aadhaar: ', ID(grp(aadhaar(true))), ', PAN ', ID(pan(true)), ', mobile ', PH(phoneIN()), '\n'], ['mixed'], idDocs);

const out = path.resolve(__dirname, '..', 'data');
const toJsonl = (a) => a.map((d) => JSON.stringify(d)).join('\n') + '\n';
fs.writeFileSync(path.join(out, 'synthetic-sample.jsonl'), toJsonl(docs));
fs.writeFileSync(path.join(out, 'indian-ids.jsonl'), toJsonl(idDocs));
console.log('synthetic-sample.jsonl: ' + docs.length + ' documents, ' + docs.reduce((n, d) => n + d.spans.length, 0) + ' labelled spans');
console.log('indian-ids.jsonl: ' + idDocs.length + ' documents, ' + idDocs.reduce((n, d) => n + d.spans.length, 0) + ' labelled spans');
