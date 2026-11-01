const fs = require('fs'), path = require('path');
const { handleApi } = require('../netlify/functions/lib/runtime');
const { FakeGoogle } = require('./fake-google');

let passed = 0, failed = 0;
const ok = (c, m) => { if (c) passed++; else { failed++; console.log('FAIL:', m); } };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), m + ' | got ' + JSON.stringify(a) + ' expected ' + JSON.stringify(b));

(async () => {
  const g = new FakeGoogle();
  const rows = fs.readFileSync(path.join(__dirname, '..', '..', 'scores.csv'), 'utf8').trim().split('\n').map((l) => l.split(',').map((v, j) => (j > 0 && j < 3 && /^\d+$/.test(v)) ? Number(v) : v));
  g.addSheet('Untitled', rows);
  const env = { TEACHER_PASSWORD: 'teacherpass1', PHOTO_FOLDER_ID: 'folderX' };
  const api = async (fn, ...args) => { const r = await handleApi({ fn, args }, { google: g, env }); if (r.status !== 200) throw new Error(fn + ' -> ' + r.status + ' ' + JSON.stringify(r.json)); return r.json; };

  /* ----- ครั้งแรก: ระบบสร้างชีตให้เอง ----- */
  const cfg = await api('getPublicConfig');
  eq(cfg.rooms, ['ม.4.1', 'ม.4.2', 'ม.4.3', 'ม.4.4', 'ม.4.5', 'ม.4.6'], 'rooms');
  eq(g.sheets.map((s) => s.title).filter((t) => t[0] !== '_').sort(), ['assignments', 'attendance', 'resetRequests', 'scores', 'students'], 'tabs after first request');
  const sc = g.get('scores');
  ok(sc && sc.values[0].length === 42 && sc.values[0][41] === 'updatedAt', 'scores renamed + header 42');
  eq(sc.values.length, 220, 'roster kept');
  eq(g.get('assignments').values.length, 38, 'assignments written');
  ok(g.get('students').values.length === 1, 'students header only');

  /* ----- ข้อมูลคงอยู่ข้ามคำขอ (แต่ละคำขอเริ่ม sandbox ใหม่) ----- */
  const list = await api('getRegisterNames', 'ม.4.1');
  eq(list.names.length, 35, 'names');
  const good = { classRoom: 'ม.4.1', studentNo: '15', studentId: '69981416', nickName: 'ก้อง', password: 'secret12', confirm: 'secret12' };
  let r = await api('registerStudent', Object.assign({}, good, { nickName: '' })); ok(!r.success, 'nickname required');
  r = await api('registerStudent', good); ok(r.success, 'register ' + r.message);
  r = await api('registerStudent', good); ok(!r.success && /ลงทะเบียนไว้แล้ว/.test(r.message), 'once only');
  eq((await api('getRegisterNames', 'ม.4.1')).names.length, 34, 'name removed');
  const st = g.get('students').values;
  eq(st.length, 2, 'student row stored'); ok(String(st[1][6]).length === 64, 'hash stored'); ok(!JSON.stringify(st).includes('secret12'), 'plain pw never stored');

  /* ----- ล็อกอิน + เซสชันอยู่ข้ามคำขอ ----- */
  r = await api('loginStudent', '69981416', 'wrong'); ok(!r.success, 'wrong pw');
  r = await api('loginStudent', '69981416', 'secret12'); ok(r.success && r.token, 'login');
  const tokS = r.token;
  let my = await api('getMyScores', tokS); ok(my.success && my.items.length === 37, 'scores via persisted session');
  ok(!JSON.stringify([...g.sheets.map((s) => s.values)]).includes(tokS), 'session token not stored in clear');
  r = await api('getMyScores', 'bogus'); ok(r.expired, 'bad token');

  /* ล็อกการเดา */
  for (let i = 0; i < 10; i++) await api('registerStudent', { classRoom: 'ม.4.3', studentNo: '1', studentId: '1111111' + i, nickName: 'x', password: 'abcdef12', confirm: 'abcdef12' });
  r = await api('registerStudent', { classRoom: 'ม.4.3', studentNo: '1', studentId: '69980037', nickName: 'ก', password: 'abcdef12', confirm: 'abcdef12' });
  ok(!r.success && /ล็อก/.test(r.message), 'lockout persists across requests: ' + r.message);

  /* ----- ลืมรหัส ----- */
  r = await api('requestPasswordReset', '69981416'); ok(r.success, 'forgot');

  /* ----- ครู (รหัสจาก environment) ----- */
  r = await api('teacherLogin', 'nope'); ok(!r.success, 'bad teacher pw');
  r = await api('teacherLogin', 'teacherpass1'); ok(r.success, 'teacher login via env pw');
  const T = r.token;
  const init = await api('teacherInit', T); eq([init.assignments.length, init.pendingResets], [37, 1], 'teacher init');
  ok((await api('teacherInit', tokS)).expired, 'student token rejected for teacher api');

  r = await api('teacherSetAttendanceBulk', T, 'ม.4.1', 1, 'มา', true); ok(r.success, 'bulk');
  r = await api('teacherSetAttendance', T, '69981416', 1, 'ไม่มา'); ok(r.success, 'absent');
  let a = await api('teacherGetAttendance', T, 'ม.4.1', 1);
  eq(a.summary, { present: 34, absent: 1, blank: 0, total: 35 }, 'attendance persisted');
  eq(a.students.find((s) => s.studentId === '69981416').nick, 'ก้อง', 'nickname in attendance');
  eq(a.photosReady, true, 'photos configured via env');
  let sg = await api('teacherGetScores', T, 'ม.4.1', 'ws1'); eq(sg.pendingAbsent, 1, 'absent flagged');

  r = await api('teacherSetScore', T, '69980020', 'ws1', 2, true); eq([r.score, r.status], [1, 'ส่งช้า'], 'late deduct');
  r = await api('teacherSetScore', T, '69980075', 'ws1', 'x', false); eq([r.score, r.status], ['x', 'แก้ไข'], 'x');
  r = await api('teacherSetScore', T, '69981416', 'lab1', 1, true); eq(r.score, 0, 'lab late');
  sg = await api('teacherGetScores', T, 'ม.4.1', 'ws1');
  eq(sg.students.find((s) => s.studentId === '69980020').raw, 2, 'raw recovered from sheet');
  const hdr = g.get('scores').values[0];
  eq(hdr[hdr.length - 1], 'updatedAt', 'updatedAt still last after on-demand status col'); ok(hdr.includes('ws1_status'), 'status col added');
  ok(g.get('scores').values.length === 220, 'no rows lost by structural rewrite');
  my = await api('getMyScores', tokS);
  eq([my.items.find((i) => i.key === 'lab1').score, my.items.find((i) => i.key === 'lab1').status], [0, 'ส่งช้า'], 'student sees late');
  ok(typeof my.updatedAt === 'string' && /\d+\/\d+\/\d{4} \d\d:\d\d/.test(my.updatedAt), 'updatedAt formatted: ' + my.updatedAt);

  /* ----- รีเซ็ต ----- */
  let sl = await api('teacherGetStudents', T, 'ม.4.1'); eq(sl.requests.length, 1, 'request visible');
  ok(/\d+\/\d+\/\d{4}/.test(sl.requests[0].requestedAt), 'request time formatted ' + sl.requests[0].requestedAt);
  r = await api('teacherResetPassword', T, '69981416'); ok(r.success, 'reset');
  ok(!(await api('loginStudent', '69981416', 'secret12')).success, 'old pw dead');
  r = await api('registerStudent', Object.assign({}, good, { password: 'newpass99', confirm: 'newpass99' })); ok(r.success, 're-register');
  ok((await api('loginStudent', '69981416', 'newpass99')).success, 'login new pw');
  eq(g.get('students').values.filter((x) => String(x[2]) === '69981416').length, 1, 'no duplicate student row');

  /* ----- รูป ----- */
  g.files = [{ id: 'f1', name: '69980020.jpg', thumbnailLink: 'L1=s220' }, { id: 'f2', name: '69981416.png', thumbnailLink: 'L2=s220' }, { id: 'f3', name: 'x.txt', thumbnailLink: '' }];
  g.thumbs['L1=s160'] = [1, 2, 3, 4, 5]; g.thumbs['L2=s160'] = [9, 8, 7];
  let p = await api('teacherGetPhotos', T, 'ม.4.1');
  eq(Object.keys(p.photos).sort(), ['69980020', '69981416'], 'photos matched');
  eq(p.photos['69980020'], 'data:image/jpeg;base64,' + Buffer.from([1, 2, 3, 4, 5]).toString('base64'), 'photo bytes round-trip');
  ok(!JSON.stringify(g.sheets.map((s) => s.values)).includes('base64,'), 'photos never written to sheet');
  p = await api('teacherGetPhotos', 'bad', 'ม.4.1'); ok(p.expired, 'photos need teacher');

  /* ----- ความปลอดภัยของ endpoint ----- */
  for (const bad of ['setupSheets', 'setTeacherPassword_', 'readObjects_', 'constructor', '__proto__', 'eval', 'onOpen']) {
    const x = await handleApi({ fn: bad, args: [] }, { google: g, env }); ok(x.status === 404, 'blocked ' + bad);
  }
  ok((await handleApi({ fn: 'getPublicConfig', args: 'x' }, { google: g, env })).status === 400, 'args must be array');

  /* ----- เปลี่ยนรหัสครูใน environment แล้วมีผลทันที ----- */
  env.TEACHER_PASSWORD = 'another-pass-2';
  ok(!(await api('teacherLogin', 'teacherpass1')).success, 'old teacher pw rejected after env change');
  ok((await api('teacherLogin', 'another-pass-2')).success, 'new teacher pw accepted');

  /* ----- คำขอพร้อมกัน: เซสชันที่ล็อกอินพร้อมกันต้องไม่หายกัน ----- */
  env.TEACHER_PASSWORD = 'another-pass-2';
  const [l1, l2] = await Promise.all([api('loginStudent', '69981416', 'newpass99'), api('teacherLogin', 'another-pass-2')]);
  ok(l1.success && l2.success, 'concurrent logins');
  ok((await api('getMyScores', l1.token)).success && (await api('teacherInit', l2.token)).success, 'both concurrent sessions survive');

  console.log('\nTabs:', g.sheets.map((s) => s.title).join(', '));
  console.log('passed', passed, 'failed', failed);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('CRASH', e); process.exit(1); });
