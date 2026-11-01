/* Google Sheets/Drive จำลองในหน่วยความจำ (ทำตามพฤติกรรม API จริงเท่าที่ใช้) */
function colNum(s) { let n = 0; for (const ch of s) n = n * 26 + ch.charCodeAt(0) - 64; return n; }
function parseRange(r) {
  const m = r.match(/^'((?:[^']|'')*)'(?:!([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?)?$/);
  if (!m) throw new Error('bad range ' + r);
  const title = m[1].replace(/''/g, "'");
  if (!m[2]) return { title };
  return { title, c1: colNum(m[2]), r1: +m[3], c2: m[4] ? colNum(m[4]) : colNum(m[2]), r2: m[5] ? +m[5] : +m[3] };
}
class FakeGoogle {
  constructor() { this.sheets = []; this.nextId = 1; this.files = []; this.thumbs = {}; this.calls = []; }
  addSheet(title, values) { const s = { sheetId: this.nextId++, title, values: values || [], rows: Math.max(1000, (values || []).length), cols: 26 }; this.sheets.push(s); return s; }
  get(title) { return this.sheets.find((s) => s.title === title); }
  async getMeta() { this.calls.push('getMeta'); return this.sheets.map((s) => ({ sheetId: s.sheetId, title: s.title, rows: s.rows, cols: s.cols })); }
  async batchGet(titles) {
    this.calls.push('batchGet');
    const out = {};
    titles.forEach((t) => {
      const s = this.get(t); const rows = JSON.parse(JSON.stringify(s.values));
      /* API จริงตัดเซลล์ว่างท้ายแถวและแถวว่างท้ายตาราง */
      rows.forEach((r) => { while (r.length && (r[r.length - 1] === '' || r[r.length - 1] === null)) r.pop(); });
      while (rows.length && !rows[rows.length - 1].length) rows.pop();
      out[t] = rows;
    });
    return out;
  }
  async batchUpdate(reqs) {
    this.calls.push('batchUpdate');
    reqs.forEach((r) => {
      if (r.addSheet) { const p = r.addSheet.properties; if (this.get(p.title)) throw new Error('duplicate sheet ' + p.title); const s = this.addSheet(p.title); s.rows = p.gridProperties.rowCount; s.cols = p.gridProperties.columnCount; }
      else if (r.updateSheetProperties) {
        const p = r.updateSheetProperties.properties; const s = this.sheets.find((x) => x.sheetId === p.sheetId);
        if (p.title) { if (this.get(p.title)) throw new Error('duplicate title'); s.title = p.title; }
        if (p.gridProperties) { s.rows = p.gridProperties.rowCount; s.cols = p.gridProperties.columnCount; }
      }
    });
    return {};
  }
  _write(s, r, c, v) {
    if (r > s.rows || c > s.cols) throw new Error('write outside grid ' + s.title + ' r' + r + ' c' + c + ' grid ' + s.rows + 'x' + s.cols);
    while (s.values.length < r) s.values.push([]);
    const row = s.values[r - 1]; while (row.length < c) row.push('');
    if (typeof v === 'object' && v !== null) throw new Error('non-scalar value written');
    row[c - 1] = v;
  }
  async valuesBatchUpdate(data) {
    this.calls.push('valuesBatchUpdate');
    data.forEach((d) => {
      const p = parseRange(d.range), s = this.get(p.title); if (!s) throw new Error('no sheet ' + p.title);
      const h = p.r2 - p.r1 + 1, w = p.c2 - p.c1 + 1;
      if (d.values.length > h || d.values.some((r) => r.length > w)) throw new Error('values exceed range ' + d.range);
      d.values.forEach((row, i) => row.forEach((v, j) => this._write(s, p.r1 + i, p.c1 + j, v)));
    });
    return {};
  }
  async valuesClear(title) { this.calls.push('valuesClear'); this.get(title).values = []; return {}; }
  async valuesAppend(title, rows) {
    this.calls.push('valuesAppend');
    const s = this.get(title);
    let last = s.values.length; while (last > 0 && s.values[last - 1].every((v) => v === '' || v === null)) last--;
    rows.forEach((row, i) => { if (last + i + 1 > s.rows) s.rows = last + i + 1; row.forEach((v, j) => this._write(s, last + i + 1, j + 1, v)); });
    return {};
  }
  async driveList() { this.calls.push('driveList'); return this.files; }
  async driveThumb(link) { this.calls.push('driveThumb'); const b = this.thumbs[String(link).replace(/=s\d+$/, '=s160')]; if (!b) throw new Error('no thumb'); return Buffer.from(b); }
}
module.exports = { FakeGoogle };
