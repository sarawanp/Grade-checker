/*
 * รัน Code.gs (ตรรกะเดิมที่ทดสอบแล้ว) ใน sandbox ต่อ 1 คำขอ โดยใช้ Google Sheets เป็นฐานข้อมูล
 * google = { getMeta, batchGet, batchUpdate, valuesBatchUpdate, valuesClear, valuesAppend, driveList, driveThumb }
 */
const vm = require('vm');
const crypto = require('crypto');

/* โค้ดถูกฝังเป็นสตริงโดย build.js (ไม่อ่านไฟล์ตอนรัน เพราะ Netlify รวมโค้ดเป็นไฟล์เดียว) */
const { MOCK_SRC, CODE_SRC } = require('./sources');
const MOCK = new vm.Script(MOCK_SRC, { filename: 'gas-mock.js' });
const CODE = new vm.Script(CODE_SRC, { filename: 'Code.gs' });

const CACHE_SHEET = '_cache';
const PROPS_SHEET = '_props';
const KV_HEAD = ['key', 'value', 'expiresAt'];

/* ฟังก์ชันที่เว็บเรียกได้ (ห้ามเรียกฟังก์ชันตั้งค่า/ภายในจากภายนอก) */
const ALLOWED = new Set([
  'getPublicConfig', 'getRegisterNames', 'registerStudent', 'loginStudent', 'logoutStudent',
  'requestPasswordReset', 'changePassword', 'getMyScores',
  'teacherLogin', 'teacherLogout', 'teacherInit', 'teacherGetAttendance', 'teacherSetAttendance',
  'teacherSetAttendanceBulk', 'teacherGetScores', 'teacherSetScore', 'teacherSetAssignmentWeek', 'teacherGetStudents',
  'teacherResetPassword', 'teacherDismissReset', 'teacherGetPhotos'
]);

function colLetter(n) { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; }
const q = (t) => "'" + String(t).replace(/'/g, "''") + "'";
const sha = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');

function newContext(env) {
  const ctx = vm.createContext({ console });
  MOCK.runInContext(ctx);
  ctx.__rand = () => crypto.randomBytes(4).readUInt32BE(0) / 4294967296;
  CODE.runInContext(ctx);
  return ctx;
}

function readKv(values) {
  const rows = [];            // เก็บตำแหน่งแถวไว้ใช้อัปเดต
  const map = {};
  (values || []).slice(1).forEach((r, i) => {
    const k = String(r[0] === undefined ? '' : r[0]);
    if (!k) return;
    rows.push(k);
    map[k] = { row: i + 2, v: r[1] === undefined ? '' : String(r[1]), exp: Number(r[2]) || 0 };
  });
  return map;
}

/* ฟังก์ชันอ่านอย่างเดียวของนักเรียน: ใช้ข้อมูลที่โหลดไว้ในเครื่องเดียวกันได้ไม่เกิน snapshotTtlMs (ลดจำนวนครั้งที่เรียก Google) */
const SNAP_FNS = new Set(['getPublicConfig', 'getRegisterNames', 'getMyScores']);
let SNAP = null;
let SNAP_LOADING = null;

async function loadSnap(google) {
  const meta = await google.getMeta();
  const titles = meta.map((m) => m.title);
  let raw;
  try { raw = titles.length ? await google.batchGet(titles) : {}; }
  catch (e) {
    /* รายชื่อชีตในแคชอาจเก่า (มีเครื่องอื่นเพิ่ม/ลบชีต) → ดึงใหม่แล้วลองอีกครั้ง */
    if (!/Google API 400/.test(String(e && e.message))) throw e;
    const m2 = await google.getMeta(true);
    return { t: Date.now(), meta: m2, raw: await google.batchGet(m2.map((m) => m.title)) };
  }
  return { t: Date.now(), meta, raw };
}

async function handleApi(body, deps) {
  const { google } = deps;
  const fn = body && body.fn;
  const args = body && body.args;
  if (typeof fn !== 'string' || !ALLOWED.has(fn)) return { status: 404, json: { success: false, message: 'ไม่พบคำสั่ง' } };
  if (!Array.isArray(args) || args.length > 8) return { status: 400, json: { success: false, message: 'คำขอไม่ถูกต้อง' } };
  const ttl = deps.snapshotTtlMs || 0;
  if (ttl > 0 && SNAP_FNS.has(fn) && SNAP && Date.now() - SNAP.t < ttl) {
    const r = await execute(fn, args, deps, SNAP, true);
    if (r) return r;           /* null = ต้องใช้ข้อมูลล่าสุดจริง ๆ */
  }
  /* คำขออ่านที่มาพร้อมกันรอโหลดชุดเดียวกัน (ไม่ยิง Google คนละครั้ง) */
  const shareable = ttl > 0 && SNAP_FNS.has(fn);
  let snap;
  if (shareable) {
    if (!SNAP_LOADING) SNAP_LOADING = loadSnap(google).then((x) => { SNAP = x; SNAP_LOADING = null; return x; }, (e) => { SNAP_LOADING = null; throw e; });
    snap = await SNAP_LOADING;
    const r = await execute(fn, args, deps, snap, true);
    if (r) return r;
  }
  snap = await loadSnap(google);
  SNAP = shareable ? snap : null;
  return execute(fn, args, deps, snap, false);
}

async function execute(fn, args, deps, snap, dry) {
  const { google, env } = deps;
  const meta = snap.meta;
  const raw = snap.raw;
  const titles = meta.map((m) => m.title);
  const ctx = newContext(env);

  const sheetsForGas = titles.filter((t) => t !== CACHE_SHEET && t !== PROPS_SHEET).map((t) => ({ name: t, values: raw[t] || [] }));
  ctx.__loadSheetsJson = JSON.stringify(sheetsForGas);
  vm.runInContext('__loadSheets(__loadSheetsJson)', ctx);

  const cacheKv = readKv(raw[CACHE_SHEET]);
  const propsKv = readKv(raw[PROPS_SHEET]);
  const now = Date.now();
  const cacheSeed = {};
  Object.keys(cacheKv).forEach((k) => { if (cacheKv[k].exp > now) cacheSeed[k] = { v: cacheKv[k].v, exp: cacheKv[k].exp }; });
  ctx.__seedJson = JSON.stringify(cacheSeed);
  vm.runInContext('__cacheSeed(__seedJson)', ctx);
  const propSeed = {};
  Object.keys(propsKv).forEach((k) => { propSeed[k] = propsKv[k].v; });
  ctx.__seedJson = JSON.stringify(propSeed);
  vm.runInContext('__propsSeed(__seedJson, true)', ctx);

  /* 2) ค่าจาก environment: รหัสผ่านครู และโฟลเดอร์รูป */
  const tpw = env.TEACHER_PASSWORD || '';
  if (tpw.length >= 8) {
    const marker = sha('tpw|' + tpw);
    if (propSeed.T_SRC !== marker) {
      ctx.__tpw = tpw; ctx.__marker = marker;
      vm.runInContext("setTeacherPassword_(__tpw); PropertiesService.getScriptProperties().setProperty('T_SRC', __marker);", ctx);
    }
  }
  if (env.PHOTO_FOLDER_ID) {
    ctx.__seedJson = JSON.stringify({ PHOTO_FOLDER_ID: env.PHOTO_FOLDER_ID });
    vm.runInContext('__propsSeed(__seedJson, true)', ctx);
  }

  /* 3) สร้างชีตที่ยังไม่มีในครั้งแรกที่มีคนเข้า */
  if (!titles.includes('students') || !titles.includes('assignments')) {
    vm.runInContext('setupSheets()', ctx);
  }

  /* 4) รูปนักเรียน: ดึงจาก Drive ล่วงหน้า (โค้ดฝั่ง GAS เรียก DriveApp แบบ synchronous) */
  if (fn === 'teacherGetPhotos' && env.PHOTO_FOLDER_ID && google.driveList) {
    try {
      ctx.__room = String(args[1] === undefined ? '' : args[1]);
      const ids = JSON.parse(vm.runInContext(
        'JSON.stringify(readObjects_(getSheet_(SHEET_SCORES)).filter(r => normRoom_(r.classRoom) === normRoom_(__room)).map(r => normId_(r.studentId)))', ctx));
      const want = new Set(ids);
      const files = await google.driveList(env.PHOTO_FOLDER_ID);
      const thumbs = {};
      const todo = files.filter((f) => want.has(String(f.name).replace(/\.[A-Za-z0-9]+$/, '').trim()) && f.thumbnailLink);
      let next = 0;
      const worker = async () => {
        while (next < todo.length) {
          const f = todo[next++];
          try { thumbs[f.id] = (await google.driveThumb(f.thumbnailLink)).toString('base64'); } catch (_) { /* ข้ามรูปที่ดึงไม่ได้ */ }
        }
      };
      await Promise.all(Array.from({ length: 8 }, worker));
      ctx.__seedJson = JSON.stringify({ files: files.map((f) => ({ id: f.id, name: f.name })), thumbs });
      vm.runInContext('__driveSeed(__seedJson)', ctx);
    } catch (e) {
      console.error('drive prefetch failed', e.message);
      ctx.__seedJson = JSON.stringify({ files: [], thumbs: {} });
      vm.runInContext('__driveSeed(__seedJson)', ctx);
    }
  }

  /* 5) เรียกฟังก์ชันจริง */
  ctx.__fn = fn;
  ctx.__argsJson = JSON.stringify(args);
  let resultJson;
  try {
    resultJson = vm.runInContext('JSON.stringify(globalThis[__fn].apply(null, JSON.parse(__argsJson)))', ctx, { timeout: 8000 });
  } catch (e) {
    console.error('function error', fn, e && e.stack || e);
    if (dry) return null;
    return { status: 500, json: { success: false, message: 'ระบบขัดข้อง ลองใหม่อีกครั้ง' } };
  }

  /* 6) บันทึกสิ่งที่เปลี่ยนกลับไปที่ Google Sheets */
  const sheetChanges = JSON.parse(vm.runInContext('__sheetExport()', ctx));
  const cacheChanges = JSON.parse(vm.runInContext('__cacheExport()', ctx));
  const propChanges = JSON.parse(vm.runInContext('__propsExport()', ctx));
  const hasChanges = sheetChanges.length || cacheChanges.length || propChanges.length;
  if (dry) {
    let ok = true;
    try { const j = JSON.parse(resultJson === undefined ? 'null' : resultJson); ok = !(j && j.success === false); } catch (_) { ok = false; }
    if (hasChanges || !ok) return null;
  }
  if (hasChanges) SNAP = null;
  await flush(google, meta, sheetChanges, cacheChanges, propChanges, cacheKv, propsKv, raw);

  return { status: 200, json: resultJson === undefined ? null : JSON.parse(resultJson) };
}

async function flush(google, meta, sheetChanges, cacheChanges, propChanges, cacheKv, propsKv, raw) {
  /* meta อาจมาจากแคช: ถ้าจะสร้างชีต/ขยายตาราง ให้ดึงข้อมูลล่าสุดก่อน เพื่อไม่ให้สร้างซ้ำหรือทำตารางเล็กลง */
  {
    const t0 = {}; meta.forEach((m) => { t0[m.title] = m; });
    let need = (cacheChanges.length && !t0[CACHE_SHEET]) || (propChanges.length && !t0[PROPS_SHEET]);
    sheetChanges.forEach((s) => {
      if (s.isNew || s.origName !== s.name) need = true;
      const m = t0[s.name];
      if (m && !s.isNew) s.dirty.forEach((d) => { if (d[0] > m.rows || d[1] > m.cols) need = true; });
    });
    if (need && google.getMeta) meta = await google.getMeta(true);
  }
  const byTitle = {};
  meta.forEach((m) => { byTitle[m.title] = m; });
  const structural = [];
  const gridNeeds = [];
  const newKv = [];
  const hasCache = !!byTitle[CACHE_SHEET];
  const hasProps = !!byTitle[PROPS_SHEET];
  if ((cacheChanges.length && !hasCache)) newKv.push(CACHE_SHEET);
  if ((propChanges.length && !hasProps)) newKv.push(PROPS_SHEET);

  sheetChanges.forEach((s) => {
    if (s.origName !== s.name && byTitle[s.origName]) {
      structural.push({ updateSheetProperties: { properties: { sheetId: byTitle[s.origName].sheetId, title: s.name }, fields: 'title' } });
      byTitle[s.name] = Object.assign({}, byTitle[s.origName], { title: s.name });
      delete byTitle[s.origName];
    }
  });
  sheetChanges.forEach((s) => {
    if (s.isNew && !byTitle[s.name]) {
      structural.push({ addSheet: { properties: { title: s.name, gridProperties: { rowCount: Math.max(s.rows + 20, 100), columnCount: Math.max(s.cols + 2, 10) } } } });
    }
  });
  newKv.forEach((t) => {
    structural.push({ addSheet: { properties: { title: t, gridProperties: { rowCount: 500, columnCount: 4 } } } });
  });
  sheetChanges.forEach((s) => {
    const m = byTitle[s.name];
    if (!m || s.isNew) return;
    let needRows = s.rows, needCols = s.cols;
    s.dirty.forEach((d) => { if (d[0] > needRows) needRows = d[0]; if (d[1] > needCols) needCols = d[1]; });
    if (needRows > m.rows || needCols > m.cols) {
      gridNeeds.push({ updateSheetProperties: { properties: { sheetId: m.sheetId, gridProperties: { rowCount: Math.max(m.rows, needRows), columnCount: Math.max(m.cols, needCols) } }, fields: 'gridProperties(rowCount,columnCount)' } });
    }
  });
  if (structural.length || gridNeeds.length) await google.batchUpdate(structural.concat(gridNeeds));

  /* เขียนค่า */
  const data = [];
  const appends = [];
  for (const s of sheetChanges) {
    if (s.full) {
      if (!s.isNew) await google.valuesClear(s.name);
      if (s.rows && s.cols) data.push({ range: q(s.name) + '!A1:' + colLetter(s.cols) + s.rows, values: s.full });
      continue;
    }
    const byRow = {};
    s.dirty.forEach((d) => { (byRow[d[0]] = byRow[d[0]] || []).push([d[1], d[2]]); });
    Object.keys(byRow).forEach((r) => {
      const cells = byRow[r].sort((a, b) => a[0] - b[0]);
      let i = 0;
      while (i < cells.length) {
        let j = i;
        while (j + 1 < cells.length && cells[j + 1][0] === cells[j][0] + 1) j++;
        const vals = cells.slice(i, j + 1).map((c) => c[1]);
        data.push({ range: q(s.name) + '!' + colLetter(cells[i][0]) + r + (j > i ? ':' + colLetter(cells[j][0]) + r : ''), values: [vals] });
        i = j + 1;
      }
    });
    s.appended.forEach((a) => appends.push({ title: s.name, row: a[1] }));
  }

  /* cache / props: เพิ่มคีย์ใหม่ด้วย append (ปลอดภัยเมื่อมีหลายคำขอพร้อมกัน), คีย์เดิมอัปเดตที่แถวเดิม */
  const kvWrite = (title, changes, kv, isProps) => {
    if (!changes.length) return;
    if (newKv.includes(title)) data.push({ range: q(title) + '!A1:C1', values: [KV_HEAD] });
    changes.forEach((c) => {
      const key = isProps ? c.k : c.h;
      const val = c.v, exp = isProps ? 0 : c.exp;
      if (kv[key]) data.push({ range: q(title) + '!B' + kv[key].row + ':C' + kv[key].row, values: [[val, exp]] });
      else appends.push({ title, row: [key, val, exp] });
    });
  };
  kvWrite(CACHE_SHEET, cacheChanges, cacheKv, false);
  kvWrite(PROPS_SHEET, propChanges, propsKv, true);

  /* ตัดคีย์ที่หมดอายุเมื่อชีต _cache โตเกินไป (ทำนาน ๆ ครั้ง) */
  const cacheRows = Object.keys(cacheKv).length;
  let prune = null;
  if (hasCache && cacheRows > 1500) {
    const now = Date.now();
    const live = Object.keys(cacheKv).filter((k) => cacheKv[k].exp > now).map((k) => [k, cacheKv[k].v, cacheKv[k].exp]);
    prune = [KV_HEAD].concat(live);
  }

  const grouped = {};
  appends.forEach((a) => { (grouped[a.title] = grouped[a.title] || []).push(a.row); });
  const jobs = [];
  if (data.length) jobs.push(google.valuesBatchUpdate(data));
  Object.keys(grouped).forEach((t) => jobs.push(google.valuesAppend(t, grouped[t])));
  await Promise.all(jobs);
  if (prune) { await google.valuesClear(CACHE_SHEET); await google.valuesBatchUpdate([{ range: q(CACHE_SHEET) + '!A1:C' + prune.length, values: prune }]); }
}

module.exports = { handleApi, ALLOWED, colLetter };
