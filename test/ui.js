const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const { handleApi } = require('../netlify/functions/lib/runtime');
const { FakeGoogle } = require('./fake-google');
const g = new FakeGoogle();
const rows = fs.readFileSync(path.join(__dirname, '..', '..', 'scores.csv'), 'utf8').trim().split('\n').map((l) => l.split(',').map((v, j) => (j > 0 && j < 3 && /^\d+$/.test(v)) ? Number(v) : v));
g.addSheet('Untitled', rows);
const env = { TEACHER_PASSWORD: 'teacherpass1' };
const pub = path.join(__dirname, '..', 'public');
const srv = http.createServer((q, r) => {
  if (q.url === '/api') { let b = ''; q.on('data', (c) => b += c); q.on('end', async () => { const x = await handleApi(JSON.parse(b), { google: g, env }); r.writeHead(x.status, { 'content-type': 'application/json; charset=utf-8' }); r.end(JSON.stringify(x.json)); }); return; }
  const f = q.url === '/' ? 'index.html' : q.url === '/teacher' ? 'teacher.html' : q.url.slice(1);
  try { const t = fs.readFileSync(path.join(pub, f)); r.writeHead(200, { 'content-type': f.endsWith('.js') ? 'application/javascript; charset=utf-8' : 'text/html; charset=utf-8' }); r.end(t); } catch (_) { r.writeHead(404); r.end(); }
}).listen(8770, async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 420, height: 900 } });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto('http://localhost:8770/'); await p.waitForTimeout(2500);
  await p.click('#tabReg'); await p.selectOption('#rRoom', { index: 1 }); await p.waitForTimeout(2000);
  console.log('names loaded:', (await p.locator('#rName option').count()) - 1);
  await p.selectOption('#rName', { index: 15 }); await p.fill('#rId', '69981416'); await p.fill('#rNick', 'ก้อง');
  await p.fill('#rPw', 'secret12'); await p.fill('#rPw2', 'secret12'); await p.click('#rBtn'); await p.waitForTimeout(3000);
  console.log('register msg:', (await p.locator('#lErr, .ok, #rErr').allTextContents()).join('|'));
  await p.fill('#lId', '69981416'); await p.fill('#lPw', 'secret12'); await p.click('#lBtn'); await p.waitForTimeout(3500);
  console.log('dash visible:', await p.locator('#dash').isVisible(), '| hello:', await p.locator('#hello').textContent());
  await p.screenshot({ path: 'test/s1.png' });
  const t = await ctx.newPage(); t.on('pageerror', (e) => errs.push(e.message));
  await t.setViewportSize({ width: 800, height: 700 });
  await t.goto('http://localhost:8770/teacher'); await t.waitForTimeout(1500);
  await t.fill('#tPw', 'teacherpass1'); await t.click('#lBtn'); await t.waitForTimeout(4000);
  await t.screenshot({ path: 'test/s2.png' });
  console.log('teacher rows:', await t.locator('#attList .row').count(), 'errs', JSON.stringify(errs));
  await b.close(); srv.close();
});
