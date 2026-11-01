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
  const q = (t) => "'" + String(t).replace(/'/g, "''") + "'";

  async function call(url, opt) {
    const { token } = await jwt.getAccessToken();
    const res = await fetch(url, Object.assign({}, opt, { headers: Object.assign({ Authorization: 'Bearer ' + token }, (opt && opt.headers) || {}) }));
    if (!res.ok) { const t = await res.text(); throw new Error('Google API ' + res.status + ': ' + t.slice(0, 300)); }
    return res;
  }
  const post = (url, body) => call(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());

  return {
    async getMeta() {
      const r = await (await call(base + '?fields=sheets.properties(sheetId,title,index,gridProperties(rowCount,columnCount))')).json();
      return r.sheets.map((s) => ({ sheetId: s.properties.sheetId, title: s.properties.title, rows: s.properties.gridProperties.rowCount, cols: s.properties.gridProperties.columnCount }));
    },
    async batchGet(titles) {
      const qs = titles.map((t) => 'ranges=' + encodeURIComponent(q(t))).join('&');
      const r = await (await call(base + '/values:batchGet?' + qs + '&valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=FORMATTED_STRING&majorDimension=ROWS')).json();
      const out = {};
      titles.forEach((t, i) => { out[t] = (r.valueRanges[i] && r.valueRanges[i].values) || []; });
      return out;
    },
    batchUpdate(requests) { return post(base + ':batchUpdate', { requests }); },
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
