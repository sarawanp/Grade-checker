/* จำลองนักเรียน 40 คนเปิดหน้า + ล็อกอินพร้อมกัน โดย Google จำกัดโควตา (อ่าน/เขียนอย่างละ 60 ครั้ง/นาที) */
const { handleApi } = require('../netlify/functions/lib/runtime');
const { FakeGoogle } = require('./fake-google');
const fs = require('fs');
const src = fs.readFileSync(__dirname + '/e2e.js', 'utf8');
(async () => {
  const g = new FakeGoogle();
  const counts = { read: 0, write: 0 };
  ['getMeta', 'batchGet'].forEach((k) => { const f = g[k].bind(g); g[k] = async (...a) => { counts.read++; return f(...a); }; });
  ['batchUpdate', 'valuesBatchUpdate', 'valuesAppend', 'valuesClear'].forEach((k) => { const f = g[k].bind(g); g[k] = async (...a) => { counts.write++; return f(...a); }; });
  const env = { TEACHER_PASSWORD: 'Teacher2569' };
  const run = (fn, ...args) => handleApi({ fn, args }, { google: g, env, snapshotTtlMs: 15000 });
  await run('getPublicConfig'); // สร้างชีต
  counts.read = counts.write = 0;
  const N = 40;
  await Promise.all(Array.from({ length: N }, () => run('getRegisterNames', '4/1')));
  console.log('เปิดหน้าลงทะเบียน', N, 'คน → อ่าน', counts.read, 'ครั้ง เขียน', counts.write, 'ครั้ง');
  counts.read = counts.write = 0;
  await run('getRegisterNames', '4/1');
  console.log('อีกคนใน 15 วินาที → อ่าน', counts.read, 'เขียน', counts.write);
})();
