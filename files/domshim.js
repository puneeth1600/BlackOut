'use strict';
/* A tiny XML DOM, just enough for the Word (.docx) code path, so it can be tested in plain Node without a browser. */
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
class Node_ {
  constructor(t, name) { this.nodeType = t; this.parentNode = null; this.childNodes = []; this.attrs = {}; this.name = name;
    if (name) { const i = name.indexOf(':'); this.localName = i < 0 ? name : name.slice(i + 1); this.namespaceURI = name.startsWith('w:') ? W : null; } }
  get firstChild() { return this.childNodes[0] || null; }
  get nextSibling() { const s = this.parentNode.childNodes; return s[s.indexOf(this) + 1] || null; }
  get textContent() { return this.nodeType === 3 ? this.data : this.childNodes.map((c) => c.textContent).join(''); }
  set textContent(v) { this.childNodes = []; const t = new Node_(3); t.data = v; t.parentNode = this; this.childNodes.push(t); }
  removeChild(c) { this.childNodes.splice(this.childNodes.indexOf(c), 1); }
  setAttributeNS(ns, n, v) { this.attrs[n] = v; }
  getElementsByTagNameNS(ns, l) { const o = []; (function w(n) { for (const c of n.childNodes) { if (c.nodeType === 1) { if (c.localName === l) o.push(c); w(c); } } })(this); return o; }
  getElementsByTagName() { return []; }
}
class DOMParser_ {
  parseFromString(x) {
    const root = new Node_(9); let cur = root;
    for (const tok of x.match(/<[^>]+>|[^<]+/g)) {
      if (tok.startsWith('<?')) continue;
      if (tok.startsWith('</')) { cur = cur.parentNode; continue; }
      if (tok[0] === '<') {
        const m = tok.match(/^<([^\s/>]+)([^>]*?)(\/?)>$/); const e = new Node_(1, m[1]);
        (m[2].match(/[\w:]+="[^"]*"/g) || []).forEach((a) => { const i = a.indexOf('='); e.attrs[a.slice(0, i)] = a.slice(i + 2, -1); });
        e.parentNode = cur; cur.childNodes.push(e); if (!m[3]) cur = e;
      } else { const t = new Node_(3); t.data = tok; t.parentNode = cur; cur.childNodes.push(t); }
    }
    root.getElementsByTagName = () => []; return root;
  }
}
class XMLSerializer_ {
  serializeToString(n) {
    const s = (n) => n.nodeType === 3 ? n.data : '<' + n.name + Object.entries(n.attrs).map(([k, v]) => ' ' + k + '="' + v + '"').join('') + '>' + n.childNodes.map(s).join('') + '</' + n.name + '>';
    return n.childNodes.map(s).join('');
  }
}
module.exports = { DOMParser: DOMParser_, XMLSerializer: XMLSerializer_ };
