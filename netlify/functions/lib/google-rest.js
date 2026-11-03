/* เรียก Google Sheets / Drive REST API ด้วย service account (ใช้ fetch ในตัวของ Node 18+) */
const { JWT } = require('google-auth-library');

function createGoogle(env) {
  const sheetId = env.SHEET_ID;
  if (!sheetId) throw new Error('missing SHEET_ID');
  let creds;
  if (env.GOOGLE_SERVICE_ACCOUNT_JSON) creds = JSON.parse(env.GOOGLE_SERVICE_ACCOUNT_JSON);
  else creds = { client_email: env.GOOGLE_CLIENT_EMAIL, private_key: (env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n') };
  if (!creds.client_email || !creds.private_key) throw new Error('missing service account credentials');
  const jwt = new JWT({ email: creds.client_email, key: creds.private_key, scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive.readonly'] });
  const base = 'https://sheets.googleapis.com/v4/spreadsheets/' + encodeURIComponent(sheetId);
  let metaCache = null;
  const q = (t) => "'" + String(t).replace(/'/g, "''") + "'";

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  /* ลองใหม่เมื่อโดนจำกัดโควตา (429) หรือ Google ขัดข้องชั่วคราว (5xx) โดยรอแบบทวีคูณ + สุ่ม ไม่เกิน ~6 วินาที */
  async function call(url, opt) {
    const t0 = Date.now();
    for (let attempt = 0; ; attempt++) {
      let res, netErr;
      try {
        const { token } = await jwt.getAccessToken();
        res = await fetch(url, Object.assign({}, opt, { headers: Object.assign({ Authorization: 'Bearer ' + token }, (opt && opt.headers) || {}) }));
      } catch (e) { netErr = e; }
      if (res && res.ok) return res;
      const status = res ? res.status : 0;
      const retriable = netErr || status === 429 || status >= 500;
      const wait = Math.min(2500, 400 * Math.pow(2, attempt)) * (0.6 + Math.random() * 0.8);
      if (!retriable || attempt >= 5 || Date.now() - t0 + wait > 6000) {
        const t = res ? await res.text() : String(netErr && netErr.message);
        const err = new Error('Google API ' + status + ': ' + String(t).slice(0, 300));
        err.status = status;
        throw err;
      }
      if (res) await res.text().catch(() => '');
      await sleep(wait);
    }
  }
  const post = (url, body) => call(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());

  return {
    async getMeta(fresh) {
      if (!fresh && metaCache && Date.now() - metaCache.t < 60000) return metaCache.v;
      const r = await (await call(base + '?fields=sheets.properties(sheetId,title,index,gridProperties(rowCount,columnCount))')).json();
      const v = r.sheets.map((s) => ({ sheetId: s.properties.sheetId, title: s.properties.title, rows: s.properties.gridProperties.rowCount, cols: s.properties.gridProperties.columnCount }));
      metaCache = { t: Date.now(), v };
      return v;
    },
    async batchGet(titles) {
      const qs = titles.map((t) => 'ranges=' + encodeURIComponent(q(t))).join('&');
      const r = await (await call(base + '/values:batchGet?' + qs + '&valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=FORMATTED_STRING&majorDimension=ROWS')).json();
      const out = {};
      titles.forEach((t, i) => { out[t] = (r.valueRanges[i] && r.valueRanges[i].values) || []; });
      return out;
    },
    batchUpdate(requests) { metaCache = null; return post(base + ':batchUpdate', { requests }); },
    valuesBatchUpdate(data) { return post(base + '/values:batchUpdate', { valueInputOption: 'RAW', data }); },
    valuesClear(title) { return post(base + '/values/' + encodeURIComponent(q(title)) + ':clear', {}); },
    valuesAppend(title, rows) {
      return post(base + '/values/' + encodeURIComponent(q(title) + '!A1') + ':append?valueInputOption=RAW&insertDataOption=INSERT_ROWS', { values: rows });
    },
    async driveList(folderId) {
      const files = [];
      let pageToken = '';
      do {
        const url = 'https://www.googleapis.com/drive/v3/files?q=' + encodeURIComponent("'" + folderId + "' in parents and trashed=false") +
          '&fields=' + encodeURIComponent('nextPageToken,files(id,name,thumbnailLink)') + '&pageSize=1000&supportsAllDrives=true&includeItemsFromAllDrives=true' +
          (pageToken ? '&pageToken=' + encodeURIComponent(pageToken) : '');
        const r = await (await call(url)).json();
        (r.files || []).forEach((f) => files.push(f));
        pageToken = r.nextPageToken || '';
      } while (pageToken);
      return files;
    },
    async driveThumb(link) {
      const small = String(link).replace(/=s\d+$/, '=s160');
      const res = await call(small);
      return Buffer.from(await res.arrayBuffer());
    }
  };
}

module.exports = { createGoogle };
