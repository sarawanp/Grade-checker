/*
 * ตัวจำลอง Google Apps Script สำหรับรัน Code.gs บน Netlify Functions
 * - ชีตถูกโหลดมาไว้ในหน่วยความจำก่อนทุกคำขอ แล้วบันทึกเฉพาะส่วนที่เปลี่ยนกลับไปที่ Google Sheets (ดู runtime.js)
 * - CacheService / PropertiesService เก็บในหน่วยความจำ แล้ว runtime.js บันทึกลงชีต _cache และ _props
 */
(function (root) {
  /* ---------- SHA-256 ---------- */
  function sha256(bytes) {
    var K = [0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
    var H = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
    var bitLen = bytes.length * 8;
    var m = bytes.slice(); m.push(0x80);
    while (m.length % 64 !== 56) m.push(0);
    var hi = Math.floor(bitLen / 0x100000000), lo = bitLen >>> 0;
    [hi, lo].forEach(function (x) { m.push((x >>> 24) & 255, (x >>> 16) & 255, (x >>> 8) & 255, x & 255); });
    var rotr = function (x, n) { return (x >>> n) | (x << (32 - n)); };
    for (var off = 0; off < m.length; off += 64) {
      var w = new Array(64), i;
      for (i = 0; i < 16; i++) w[i] = (m[off + 4*i] << 24) | (m[off + 4*i + 1] << 16) | (m[off + 4*i + 2] << 8) | m[off + 4*i + 3];
      for (i = 16; i < 64; i++) {
        var s0 = rotr(w[i-15], 7) ^ rotr(w[i-15], 18) ^ (w[i-15] >>> 3);
        var s1 = rotr(w[i-2], 17) ^ rotr(w[i-2], 19) ^ (w[i-2] >>> 10);
        w[i] = (w[i-16] + s0 + w[i-7] + s1) | 0;
      }
      var a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
      for (i = 0; i < 64; i++) {
        var S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25), ch = (e & f) ^ (~e & g);
        var t1 = (h + S1 + ch + K[i] + w[i]) | 0;
        var S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22), mj = (a & b) ^ (a & c) ^ (b & c);
        var t2 = (S0 + mj) | 0;
        h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
      }
      H[0] = (H[0] + a) | 0; H[1] = (H[1] + b) | 0; H[2] = (H[2] + c) | 0; H[3] = (H[3] + d) | 0;
      H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0; H[6] = (H[6] + g) | 0; H[7] = (H[7] + h) | 0;
    }
    var out = [];
    H.forEach(function (x) { out.push((x >> 24) & 255, (x >> 16) & 255, (x >> 8) & 255, x & 255); });
    return out;
  }
  function utf8(str) {
    var out = [], enc = unescape(encodeURIComponent(str));
    for (var i = 0; i < enc.length; i++) out.push(enc.charCodeAt(i));
    return out;
  }
  function hex(bytes) { return bytes.map(function (b) { return ('0' + (b & 255).toString(16)).slice(-2); }).join(''); }

  var B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  function b64enc(bytes) {
    var out = '';
    for (var i = 0; i < bytes.length; i += 3) {
      var a = bytes[i] & 255, b = i + 1 < bytes.length ? bytes[i + 1] & 255 : NaN, c = i + 2 < bytes.length ? bytes[i + 2] & 255 : NaN;
      out += B64[a >> 2] + B64[((a & 3) << 4) | ((isNaN(b) ? 0 : b) >> 4)] + (isNaN(b) ? '=' : B64[((b & 15) << 2) | ((isNaN(c) ? 0 : c) >> 6)]) + (isNaN(c) ? '=' : B64[c & 63]);
    }
    return out;
  }
  function b64dec(s) {
    var out = [], buf = 0, bits = 0;
    for (var i = 0; i < s.length; i++) {
      var v = B64.indexOf(s[i]); if (v < 0) continue;
      buf = (buf << 6) | v; bits += 6;
      if (bits >= 8) { bits -= 8; out.push((buf >> bits) & 255); }
    }
    return out;
  }

  /* ---------- เวลาไทย ---------- */
  var BKK = 7 * 3600 * 1000;
  function pad(n) { return ('0' + n).slice(-2); }
  function fmtBkk(d, pattern) {
    var t = new Date(d.getTime() + BKK);
    var map = { yyyy: t.getUTCFullYear(), MM: pad(t.getUTCMonth() + 1), dd: pad(t.getUTCDate()), HH: pad(t.getUTCHours()), mm: pad(t.getUTCMinutes()), ss: pad(t.getUTCSeconds()), d: t.getUTCDate(), M: t.getUTCMonth() + 1 };
    return pattern.replace(/yyyy|MM|dd|HH|mm|ss|d|M/g, function (k) { return map[k]; });
  }

  /* ---------- Utilities / Session ---------- */
  root.Utilities = {
    DigestAlgorithm: { SHA_256: 'SHA_256' },
    Charset: { UTF_8: 'UTF_8' },
    computeDigest: function (alg, str) { return sha256(utf8(str)).map(function (b) { return b > 127 ? b - 256 : b; }); },
    getUuid: function () {
      var r = function (n) { var s = ''; for (var i = 0; i < n; i++) s += Math.floor(root.__rand() * 16).toString(16); return s; };
      return r(8) + '-' + r(4) + '-4' + r(3) + '-a' + r(3) + '-' + r(12);
    },
    formatDate: function (d, tz, pattern) { return fmtBkk(d, pattern || 'd/M/yyyy HH:mm'); },
    base64Encode: b64enc
  };
  root.Session = { getScriptTimeZone: function () { return 'Asia/Bangkok'; } };
  /* ตัวสุ่มที่ปลอดภัย: runtime.js ส่ง crypto.randomBytes เข้ามาทาง __rand */
  root.__rand = function () { return Math.random(); };

  /* ---------- Cache (คีย์ถูกแฮชก่อนเก็บ เพื่อไม่ให้โทเคนอ่านได้จากชีต) ---------- */
  var cstore = {}, cchanged = {};
  var hk = function (k) { return hex(sha256(utf8('c|' + k))); };
  root.CacheService = { getScriptCache: function () { return {
    get: function (k) { var e = cstore[hk(k)]; return e && e.exp > Date.now() ? e.v : null; },
    put: function (k, v, sec) {
      var s = String(v); if (s.length > 40000 || /^ph_/.test(k)) return; /* รูปไม่เก็บในชีต (ใหญ่เกินไป) */ /* เซลล์ชีตจุได้ ~50,000 ตัวอักษร */
      var h = hk(k); cstore[h] = { v: s, exp: Date.now() + (sec || 600) * 1000 }; cchanged[h] = 1;
    },
    remove: function (k) { var h = hk(k); if (cstore[h]) { cstore[h] = { v: '', exp: 0 }; cchanged[h] = 1; } }
  }; } };
  root.__cacheSeed = function (json) { cstore = JSON.parse(json); cchanged = {}; };
  root.__cacheExport = function () { return JSON.stringify(Object.keys(cchanged).map(function (h) { return { h: h, v: cstore[h].v, exp: cstore[h].exp }; })); };

  /* ---------- Properties ---------- */
  var pstore = {}, pchanged = {};
  root.PropertiesService = { getScriptProperties: function () { return {
    getProperty: function (k) { return Object.prototype.hasOwnProperty.call(pstore, k) && pstore[k] !== '' ? pstore[k] : null; },
    setProperty: function (k, v) { pstore[k] = String(v); pchanged[k] = 1; },
    setProperties: function (o) { Object.keys(o).forEach(function (k) { pstore[k] = String(o[k]); pchanged[k] = 1; }); }
  }; } };
  root.__propsSeed = function (json, silent) { var o = JSON.parse(json); Object.keys(o).forEach(function (k) { pstore[k] = o[k]; if (!silent) pchanged[k] = 1; }); };
  root.__propsExport = function () { return JSON.stringify(Object.keys(pchanged).map(function (k) { return { k: k, v: pstore[k] }; })); };

  root.LockService = { getScriptLock: function () { return { waitLock: function () {}, releaseLock: function () {} }; } };
  root.HtmlService = {};

  /* ---------- Drive (ข้อมูลถูกดึงมาล่วงหน้าโดย runtime.js) ---------- */
  var driveFiles = [], driveThumbs = {};
  root.__driveSeed = function (json) { var o = JSON.parse(json); driveFiles = o.files; driveThumbs = o.thumbs; };
  root.DriveApp = {
    getFolderById: function () {
      return { getName: function () { return 'โฟลเดอร์รูป'; }, getFiles: function () {
        var i = 0; return { hasNext: function () { return i < driveFiles.length; }, next: function () { var f = driveFiles[i++]; return { getName: function () { return f.name; }, getId: function () { return f.id; } }; } };
      } };
    },
    getFileById: function (id) {
      return { getThumbnail: function () {
        var b = driveThumbs[id]; if (!b) return null;
        var bytes = b64dec(b);
        return { getContentType: function () { return 'image/jpeg'; }, getBytes: function () { return bytes; } };
      } };
    }
  };

  /* ---------- Spreadsheet (ติดตาม cell ที่เปลี่ยน) ---------- */
  function Sheet(name) { this.name = name; this.origName = name; this.data = []; this.tracking = false; this.isNew = false; this.struct = false; this.dirty = {}; this.appended = {}; }
  Sheet.prototype.getName = function () { return this.name; };
  Sheet.prototype.setName = function (n) { this.name = n; return this; };
  Sheet.prototype.setFrozenRows = function () {};
  Sheet.prototype._get = function (r, c) { var row = this.data[r - 1]; var v = row ? row[c - 1] : undefined; return v === undefined || v === null ? '' : v; };
  Sheet.prototype._set = function (r, c, v) {
    while (this.data.length < r) this.data.push([]);
    var row = this.data[r - 1];
    while (row.length < c) row.push('');
    row[c - 1] = v === undefined || v === null ? '' : v;
    if (this.tracking) this.dirty[r + ',' + c] = 1;
  };
  Sheet.prototype._nonEmpty = function (v) { return v !== '' && v !== null && v !== undefined; };
  Sheet.prototype.getLastRow = function () {
    for (var r = this.data.length; r >= 1; r--) { var row = this.data[r - 1]; for (var c = 0; c < row.length; c++) if (this._nonEmpty(row[c])) return r; }
    return 0;
  };
  Sheet.prototype.getLastColumn = function () {
    var max = 0, self = this;
    this.data.forEach(function (row) { for (var c = row.length; c >= 1; c--) if (self._nonEmpty(row[c - 1])) { if (c > max) max = c; break; } });
    return max;
  };
  Sheet.prototype.getRange = function (r, c, nr, nc) {
    var sh = this; nr = nr || 1; nc = nc || 1;
    var rng = {
      getValues: function () { var out = []; for (var i = 0; i < nr; i++) { var row = []; for (var j = 0; j < nc; j++) row.push(sh._get(r + i, c + j)); out.push(row); } return out; },
      getValue: function () { return sh._get(r, c); },
      setValues: function (vals) {
        if (vals.length !== nr || (vals[0] && vals[0].length !== nc)) throw new Error('setValues size mismatch');
        for (var i = 0; i < nr; i++) for (var j = 0; j < nc; j++) sh._set(r + i, c + j, vals[i][j]);
        return rng;
      },
      setValue: function (v) { for (var i = 0; i < nr; i++) for (var j = 0; j < nc; j++) sh._set(r + i, c + j, v); return rng; },
      clearContent: function () { for (var i = 0; i < nr; i++) for (var j = 0; j < nc; j++) sh._set(r + i, c + j, ''); return rng; },
      setFontWeight: function () { return rng; }
    };
    return rng;
  };
  Sheet.prototype.getDataRange = function () { return this.getRange(1, 1, Math.max(1, this.getLastRow()), Math.max(1, this.getLastColumn())); };
  Sheet.prototype.appendRow = function (arr) {
    var r = this.getLastRow() + 1, was = this.tracking;
    this.tracking = false;
    for (var i = 0; i < arr.length; i++) this._set(r, i + 1, arr[i]);
    this.tracking = was;
    if (was && !this.isNew) this.appended[r] = 1;
  };
  Sheet.prototype.insertColumnBefore = function (col) { this.struct = true; this.data.forEach(function (row) { if (row.length >= col) row.splice(col - 1, 0, ''); }); };
  Sheet.prototype.deleteColumn = function (col) { this.struct = true; this.data.forEach(function (row) { if (row.length >= col) row.splice(col - 1, 1); }); };

  var sheets = [];
  var ss = {
    getSheetByName: function (n) { return sheets.filter(function (s) { return s.name === n; })[0] || null; },
    insertSheet: function (n) { var s = new Sheet(n); s.isNew = true; s.tracking = true; sheets.push(s); return s; },
    getSheets: function () { return sheets.slice(); },
    getId: function () { return 'netlify'; }
  };
  root.SpreadsheetApp = {
    getActiveSpreadsheet: function () { return ss; },
    openById: function () { return ss; },
    getUi: function () { return { Button: { OK: 'OK' }, ButtonSet: { OK_CANCEL: 'OK_CANCEL' }, alert: function () {}, createMenu: function () { return { addItem: function () { return this; }, addToUi: function () {} }; } }; }
  };

  root.__loadSheets = function (json) {
    sheets = JSON.parse(json).map(function (o) {
      var s = new Sheet(o.name); s.data = o.values.map(function (r) { return r.slice(); }); s.tracking = true; return s;
    });
  };

  function plain(v) { return Object.prototype.toString.call(v) === '[object Date]' ? fmtBkk(v, 'd/M/yyyy HH:mm') : v; }
  /** สรุปสิ่งที่เปลี่ยน เพื่อให้ runtime.js เขียนกลับไปที่ Google Sheets */
  root.__sheetExport = function () {
    var out = [];
    sheets.forEach(function (s) {
      var rows = s.data.length, cols = 0;
      s.data.forEach(function (r) { if (r.length > cols) cols = r.length; });
      var o = { name: s.name, origName: s.origName, isNew: s.isNew, struct: s.struct, rows: rows, cols: cols, dirty: [], appended: [], full: null };
      if (s.isNew || s.struct) {
        o.full = s.data.map(function (r) { var x = []; for (var c = 0; c < cols; c++) x.push(plain(r[c] === undefined ? '' : r[c])); return x; });
      } else {
        Object.keys(s.dirty).forEach(function (k) {
          var p = k.split(','), r = +p[0], c = +p[1];
          if (s.appended[r]) return;
          o.dirty.push([r, c, plain(s._get(r, c))]);
        });
        Object.keys(s.appended).forEach(function (r) {
          var row = s.data[r - 1] || [], x = [];
          for (var c = 0; c < row.length; c++) x.push(plain(row[c]));
          o.appended.push([+r, x]);
        });
      }
      var changed = o.isNew || o.struct || o.dirty.length || o.appended.length || o.origName !== o.name;
      if (changed) out.push(o);
    });
    return JSON.stringify(out);
  };
})(typeof window !== 'undefined' ? window : globalThis);
