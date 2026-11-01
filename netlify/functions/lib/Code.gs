/**
 * GradeChecker ฟิสิกส์ ม.4 (ภาคเรียนที่ 2/2569)
 *
 * ชีตที่ใช้ (สร้างอัตโนมัติด้วย setupSheets):
 *  - scores        : ทะเบียนรายชื่อ (A-D) + คะแนนทุกช่อง <รหัสงาน>_score (และ <รหัสงาน>_status เมื่อมีสถานะพิเศษ)
 *  - assignments   : รายการงาน/คะแนนเต็ม/สัปดาห์
 *  - students      : บัญชีที่นักเรียนลงทะเบียนเอง (รหัสผ่านเข้ารหัส ครูอ่านรหัสจริงไม่ได้)
 *  - attendance    : เช็คชื่อรายสัปดาห์ (w1-w16)
 *  - resetRequests : คำขอรีเซ็ตรหัสผ่านจากนักเรียน
 *
 * หน้าเว็บ:  <URL>        = นักเรียน
 *            <URL>?page=teacher = แดชบอร์ดครู (ต้องใช้รหัสผ่านครู ตั้งจากเมนู GradeChecker)
 */

const CONFIG = {
  SPREADSHEET_ID: '',          // เว้นว่างได้ถ้าสร้างสคริปต์จากเมนู ส่วนขยาย > Apps Script ของชีตนั้น
  SCHOOL: 'โรงเรียนมัธยมสาธิตมหาวิทยาลัยนเรศวร',
  SUBJECT: 'วิทยาศาสตร์กายภาพ 2 (ฟิสิกส์) ม.4',
  SUBJECT_GROUP: 'กลุ่มสาระการเรียนรู้วิทยาศาสตร์และเทคโนโลยี',
  MIN_PASSWORD_LENGTH: 6,
  MAX_NICKNAME_LENGTH: 30,
  WEEKS: 16,
  SESSION_SECONDS: 21600,      // 6 ชั่วโมง (สูงสุดที่ CacheService อนุญาต)
  MAX_FAILED_LOGINS: 8,
  MAX_FAILED_REGISTER: 10,     // ลองเลขประจำตัวผิดเกินนี้ต่อชื่อหนึ่งคน จะถูกล็อกชั่วคราว
  LOCKOUT_SECONDS: 900,        // 15 นาที
  HASH_ROUNDS: 300,
  LATE_PENALTY: 1,             // ส่งช้าหักกี่คะแนน
  LATE_TYPES: ['แลป', 'แบบฝึกหัด'],   // ประเภทงานที่มีตัวเลือก "ส่งช้า"
  QUIZ_WEEKS: { quiz1: 3, quiz2: 7, quiz3: 11, quiz4: 13, quiz5: 16 }   // ใช้เมื่อชีต assignments ไม่มีคอลัมน์ week
};

const SHEET_STUDENTS = 'students';
const SHEET_ASSIGNMENTS = 'assignments';
const SHEET_SCORES = 'scores';
const SHEET_ATTENDANCE = 'attendance';
const SHEET_RESETS = 'resetRequests';

const STUDENT_HEADERS = ['classRoom', 'studentNo', 'studentId', 'fullName', 'nickName', 'salt', 'passwordHash', 'registeredAt', 'status'];
const ASSIGNMENT_HEADERS = ['assignmentKey', 'chapter', 'section', 'assignmentName', 'type', 'dueDate', 'fullScore', 'sortOrder', 'semester', 'subjectName', 'visible', 'week'];
const SCORE_BASE_HEADERS = ['classRoom', 'studentNo', 'studentId', 'fullName'];
const RESET_HEADERS = ['requestedAt', 'studentId', 'classRoom', 'fullName', 'status', 'handledAt'];

const MARK_PRESENT = 'มา';
const MARK_ABSENT = 'ไม่มา';
const STATUS_LATE = 'ส่งช้า';
const REQ_PENDING = 'รอดำเนินการ';
const REQ_DONE = 'อนุญาตแล้ว';
const REQ_REJECTED = 'ปฏิเสธ';

/* ====================== Web app ====================== */

function doGet(e) {
  const page = e && e.parameter && e.parameter.page;
  const file = page === 'teacher' ? 'teacher' : 'index';
  const title = page === 'teacher' ? 'GradeChecker - แดชบอร์ดครู' : 'GradeChecker - ตรวจสอบคะแนนฟิสิกส์ ม.4';
  return HtmlService.createHtmlOutputFromFile(file)
    .setTitle(title)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/* ====================== Helpers ====================== */

function getSS_() {
  return CONFIG.SPREADSHEET_ID
    ? SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID)
    : SpreadsheetApp.getActiveSpreadsheet();
}

function getSheet_(name) {
  const sh = getSS_().getSheetByName(name);
  if (!sh) throw new Error('ไม่พบชีตชื่อ: ' + name + ' (ให้รัน setupSheets ก่อน)');
  return sh;
}

function str_(v) {
  return String(v == null ? '' : v).trim();
}

function normId_(v) {
  return str_(v).replace(/\s+/g, '');
}

function normRoom_(v) {
  return str_(v).replace(/\s+/g, '').replace(/\//g, '.');
}

function sameNumber_(a, b) {
  const x = Number(str_(a)), y = Number(str_(b));
  return Number.isFinite(x) && Number.isFinite(y) && x === y;
}

function toNum_(v) {
  const s = str_(v);
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function round2_(n) {
  return Math.round(n * 100) / 100;
}

function isScoreX_(v) {
  return str_(v).toLowerCase() === 'x';
}

/** กันข้อความที่ขึ้นต้นด้วย = + - @ ถูกตีเป็นสูตรเมื่อเขียนลงชีต */
function safeText_(v) {
  const s = str_(v);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

function readObjects_(sheet) {
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return [];
  const headers = data[0].map(h => str_(h));
  const out = [];
  for (let r = 1; r < data.length; r++) {
    const o = { _row: r + 1 };
    headers.forEach((h, i) => { if (h) o[h] = data[r][i]; });
    out.push(o);
  }
  return out;
}

function headerIndex_(sheet) {
  const lastCol = Math.max(1, sheet.getLastColumn());
  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(h => str_(h));
  const idx = {};
  headers.forEach((h, i) => { if (h) idx[h] = i + 1; });
  return idx;
}

/** หาแถวของ studentId (เลขแถวในชีต) โดยอ่านเฉพาะคอลัมน์ studentId */
function findRowById_(sheet, idx, studentId) {
  const last = sheet.getLastRow();
  if (last < 2 || !idx.studentId) return 0;
  const vals = sheet.getRange(2, idx.studentId, last - 1, 1).getValues();
  const want = normId_(studentId);
  for (let i = 0; i < vals.length; i++) {
    if (normId_(vals[i][0]) === want) return i + 2;
  }
  return 0;
}

/** คืนเลขคอลัมน์ของหัวตาราง ถ้ายังไม่มีให้สร้างก่อน updatedAt (หรือท้ายตาราง) */
function getOrCreateCol_(sheet, header) {
  let idx = headerIndex_(sheet);
  if (idx[header]) return idx[header];
  let col;
  if (idx.updatedAt) {
    col = idx.updatedAt;
    sheet.insertColumnBefore(col);
  } else {
    col = Math.max(1, sheet.getLastColumn()) + 1;
  }
  sheet.getRange(1, col).setValue(header).setFontWeight('bold');
  return col;
}

function fmtDate_(v) {
  if (!v) return '';
  if (Object.prototype.toString.call(v) === '[object Date]' && !isNaN(v)) {
    return Utilities.formatDate(v, Session.getScriptTimeZone(), 'd/M/yyyy HH:mm');
  }
  return str_(v);
}

function fail_(message, extra) {
  return Object.assign({ success: false, message: message }, extra || {});
}

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    return fn();
  } finally {
    try { lock.releaseLock(); } catch (_) {}
  }
}

/* ---------- password hashing (SHA-256 + salt, หลายรอบ) ---------- */

function hashPassword_(password, salt) {
  let h = salt + ':' + password;
  for (let i = 0; i < CONFIG.HASH_ROUNDS; i++) {
    const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, h + salt, Utilities.Charset.UTF_8);
    h = bytes.map(b => ('0' + (b & 0xff).toString(16)).slice(-2)).join('');
  }
  return h;
}

function newSalt_() {
  return Utilities.getUuid().replace(/-/g, '');
}

/* ---------- session ---------- */

function newToken_() {
  return Utilities.getUuid() + Utilities.getUuid().replace(/-/g, '');
}

function createSession_(studentId) {
  const token = newToken_();
  CacheService.getScriptCache().put('sess_' + token, studentId, CONFIG.SESSION_SECONDS);
  return token;
}

function sessionStudentId_(token) {
  if (!token) return null;
  return CacheService.getScriptCache().get('sess_' + token) || null;
}

/* ---------- roster / assignments ---------- */

function loadRoster_() {
  return readObjects_(getSheet_(SHEET_SCORES)).filter(r => normId_(r.studentId));
}

function roomsFromRoster_(roster) {
  const rooms = {};
  roster.forEach(r => { const room = str_(r.classRoom); if (room) rooms[room] = true; });
  return Object.keys(rooms).sort((a, b) => a.localeCompare(b, 'th', { numeric: true }));
}

function byStudentNo_(a, b) {
  return Number(a.studentNo) - Number(b.studentNo);
}

const HIDDEN_WORDS = ['false', 'no', 'n', '0', 'ไม่', 'ซ่อน'];

function isHidden_(a) {
  return HIDDEN_WORDS.indexOf(str_(a.visible).toLowerCase()) !== -1;
}

function loadAssignments_(includeHidden) {
  return readObjects_(getSheet_(SHEET_ASSIGNMENTS))
    .filter(a => str_(a.assignmentKey))
    .filter(a => includeHidden || !isHidden_(a))
    .sort((a, b) => Number(a.sortOrder || 9999) - Number(b.sortOrder || 9999));
}

function weekOf_(a) {
  const w = toNum_(a.week);
  if (w) return w;
  const key = str_(a.assignmentKey);
  const m = /^(lab|ws)(\d+)$/.exec(key);
  if (m) return Number(m[2]);
  return CONFIG.QUIZ_WEEKS[key] || null;
}

function allowLate_(a) {
  return CONFIG.LATE_TYPES.indexOf(str_(a.type)) !== -1;
}

function assignmentInfo_(a) {
  return {
    key: str_(a.assignmentKey),
    chapter: str_(a.chapter) || 'อื่น ๆ',
    section: str_(a.section),
    name: str_(a.assignmentName),
    type: str_(a.type),
    fullScore: Number(a.fullScore) || 0,
    week: weekOf_(a),
    allowLate: allowLate_(a),
    visible: !isHidden_(a)
  };
}

/* ====================== API นักเรียน ====================== */

function getPublicConfig() {
  try {
    return {
      success: true,
      school: CONFIG.SCHOOL,
      subject: CONFIG.SUBJECT,
      subjectGroup: CONFIG.SUBJECT_GROUP,
      minPassword: CONFIG.MIN_PASSWORD_LENGTH,
      rooms: roomsFromRoster_(loadRoster_())
    };
  } catch (e) {
    return fail_(e.message);
  }
}

/** รายชื่อในห้องที่ยังไม่ได้ลงทะเบียน (หรือถูกรีเซ็ตรหัสแล้ว) ให้นักเรียนเลือกชื่อตัวเอง */
function getRegisterNames(classRoom) {
  try {
    const room = normRoom_(classRoom);
    if (!room) return { success: true, names: [] };
    const registered = {};
    readObjects_(getSheet_(SHEET_STUDENTS)).forEach(s => {
      if (str_(s.passwordHash)) registered[normId_(s.studentId)] = true;
    });
    const names = loadRoster_()
      .filter(r => normRoom_(r.classRoom) === room && !registered[normId_(r.studentId)])
      .sort(byStudentNo_)
      .map(r => ({ no: Number(r.studentNo), name: str_(r.fullName) }));
    return { success: true, names: names };
  } catch (e) {
    return fail_('เกิดข้อผิดพลาด: ' + e.message);
  }
}

/**
 * ลงทะเบียนครั้งแรก (ทำได้ครั้งเดียวต่อคน)
 * form = { classRoom, studentNo, studentId, nickName, password, confirm }
 * ห้อง+เลขที่ มาจากชื่อที่เลือกในรายการ ต้องตรงกับเลขประจำตัวในทะเบียน
 */
function registerStudent(form) {
  try {
    return withLock_(() => registerStudentLocked_(form || {}));
  } catch (e) {
    return fail_('ระบบกำลังยุ่ง กรุณาลองใหม่อีกครั้ง');
  }
}

function registerStudentLocked_(form) {
  const classRoom = str_(form.classRoom);
  const studentNo = str_(form.studentNo);
  const studentId = normId_(form.studentId);
  const nickName = safeText_(form.nickName);
  const password = String(form.password == null ? '' : form.password);
  const confirm = String(form.confirm == null ? '' : form.confirm);

  if (!classRoom || !studentNo) return fail_('กรุณาเลือกห้องและเลือกชื่อของตัวเอง');
  if (!studentId) return fail_('กรุณากรอกเลขประจำตัวนักเรียน');
  if (!str_(form.nickName)) return fail_('กรุณากรอกชื่อเล่น');
  if (nickName.length > CONFIG.MAX_NICKNAME_LENGTH) return fail_('ชื่อเล่นยาวเกิน ' + CONFIG.MAX_NICKNAME_LENGTH + ' ตัวอักษร');
  if (password.length < CONFIG.MIN_PASSWORD_LENGTH) return fail_('รหัสผ่านต้องยาวอย่างน้อย ' + CONFIG.MIN_PASSWORD_LENGTH + ' ตัวอักษร');
  if (password !== confirm) return fail_('รหัสผ่านและการยืนยันรหัสผ่านไม่ตรงกัน');
  if (password === studentId) return fail_('ห้ามใช้เลขประจำตัวเป็นรหัสผ่าน');

  const cache = CacheService.getScriptCache();
  const failKey = 'regfail_' + normRoom_(classRoom) + '_' + Number(studentNo);
  const fails = Number(cache.get(failKey) || 0);
  if (fails >= CONFIG.MAX_FAILED_REGISTER) {
    return fail_('กรอกเลขประจำตัวผิดหลายครั้ง ระบบล็อกชั่วคราว 15 นาที หากเลขถูกต้องแล้วให้แจ้งครู');
  }

  const roster = loadRoster_().find(r => normId_(r.studentId) === studentId);
  const ok = roster && normRoom_(roster.classRoom) === normRoom_(classRoom) && sameNumber_(roster.studentNo, studentNo);
  if (!ok) {
    cache.put(failKey, String(fails + 1), CONFIG.LOCKOUT_SECONDS);
    return fail_('เลขประจำตัวไม่ตรงกับชื่อที่เลือก กรุณาตรวจสอบอีกครั้ง');
  }
  cache.remove(failKey);

  const stSheet = getSheet_(SHEET_STUDENTS);
  const existing = readObjects_(stSheet).find(s => normId_(s.studentId) === studentId);
  if (existing && str_(existing.passwordHash)) {
    return fail_('บัญชีนี้ลงทะเบียนไว้แล้ว ให้เข้าสู่ระบบด้วยรหัสผ่านที่ตั้งไว้ หากลืมรหัสผ่านให้กด "ลืมรหัสผ่าน" เพื่อขอให้ครูรีเซ็ต');
  }

  const salt = newSalt_();
  const rowValues = [
    str_(roster.classRoom), str_(roster.studentNo), studentId, str_(roster.fullName),
    nickName, salt, hashPassword_(password, salt), new Date(), 'ปกติ'
  ];
  if (existing) {
    stSheet.getRange(existing._row, 1, 1, rowValues.length).setValues([rowValues]);
  } else {
    stSheet.appendRow(rowValues);
  }
  return { success: true, message: 'ลงทะเบียนสำเร็จ เข้าสู่ระบบได้ทันที' };
}

function loginStudent(studentId, password) {
  try {
    const id = normId_(studentId);
    const pw = String(password == null ? '' : password);
    if (!id || !pw) return fail_('กรุณากรอกเลขประจำตัวและรหัสผ่าน');

    const cache = CacheService.getScriptCache();
    const failKey = 'fail_' + id;
    const fails = Number(cache.get(failKey) || 0);
    if (fails >= CONFIG.MAX_FAILED_LOGINS) {
      return fail_('กรอกรหัสผ่านผิดหลายครั้ง ระบบล็อกชั่วคราว 15 นาที');
    }

    const student = readObjects_(getSheet_(SHEET_STUDENTS)).find(s => normId_(s.studentId) === id);
    const ok = student && str_(student.passwordHash) &&
      hashPassword_(pw, str_(student.salt)) === str_(student.passwordHash);

    if (!ok) {
      cache.put(failKey, String(fails + 1), CONFIG.LOCKOUT_SECONDS);
      return fail_('เลขประจำตัวหรือรหัสผ่านไม่ถูกต้อง (ถ้ายังไม่เคยลงทะเบียน ให้ไปที่แท็บ "ลงทะเบียนครั้งแรก")');
    }
    if (str_(student.status) && str_(student.status) !== 'ปกติ') {
      return fail_('บัญชีนี้ถูกระงับ กรุณาติดต่อครู');
    }

    cache.remove(failKey);
    return { success: true, token: createSession_(id), student: profile_(student) };
  } catch (e) {
    return fail_('เกิดข้อผิดพลาด: ' + e.message);
  }
}

function profile_(s) {
  return {
    studentId: normId_(s.studentId),
    studentNo: str_(s.studentNo),
    fullName: str_(s.fullName),
    nickName: str_(s.nickName),
    classRoom: str_(s.classRoom)
  };
}

function logoutStudent(token) {
  if (token) CacheService.getScriptCache().remove('sess_' + token);
  return { success: true };
}

/** นักเรียนที่ลืมรหัสผ่านส่งคำขอ ครูจะเห็นในแดชบอร์ดและกดอนุญาตรีเซ็ต */
function requestPasswordReset(studentId) {
  try {
    return withLock_(() => {
      const id = normId_(studentId);
      if (!id) return fail_('กรุณากรอกเลขประจำตัวนักเรียน');
      const student = readObjects_(getSheet_(SHEET_STUDENTS)).find(s => normId_(s.studentId) === id && str_(s.passwordHash));
      if (!student) {
        return fail_('ไม่พบบัญชีที่ลงทะเบียนด้วยเลขประจำตัวนี้ ถ้ายังไม่เคยลงทะเบียนให้ไปที่แท็บ "ลงทะเบียนครั้งแรก"');
      }
      const resets = getResetSheet_();
      const pending = readObjects_(resets).some(r => normId_(r.studentId) === id && str_(r.status) === REQ_PENDING);
      if (!pending) {
        resets.appendRow([new Date(), id, str_(student.classRoom), str_(student.fullName), REQ_PENDING, '']);
      }
      return { success: true, message: 'ส่งคำขอให้ครูแล้ว เมื่อครูอนุญาต ให้ไปที่แท็บ "ลงทะเบียนครั้งแรก" เพื่อตั้งรหัสผ่านใหม่' };
    });
  } catch (e) {
    return fail_('ระบบกำลังยุ่ง กรุณาลองใหม่อีกครั้ง');
  }
}

function changePassword(token, oldPassword, newPassword) {
  try {
    const id = sessionStudentId_(token);
    if (!id) return fail_('หมดเวลาการใช้งาน กรุณาเข้าสู่ระบบใหม่', { expired: true });

    const np = String(newPassword == null ? '' : newPassword);
    if (np.length < CONFIG.MIN_PASSWORD_LENGTH) {
      return fail_('รหัสผ่านใหม่ต้องยาวอย่างน้อย ' + CONFIG.MIN_PASSWORD_LENGTH + ' ตัวอักษร');
    }
    if (np === id) return fail_('ห้ามใช้เลขประจำตัวเป็นรหัสผ่าน');

    return withLock_(() => {
      const sh = getSheet_(SHEET_STUDENTS);
      const idx = headerIndex_(sh);
      const s = readObjects_(sh).find(r => normId_(r.studentId) === id);
      if (!s || hashPassword_(String(oldPassword || ''), str_(s.salt)) !== str_(s.passwordHash)) {
        return fail_('รหัสผ่านเดิมไม่ถูกต้อง');
      }
      const salt = newSalt_();
      sh.getRange(s._row, idx.salt).setValue(salt);
      sh.getRange(s._row, idx.passwordHash).setValue(hashPassword_(np, salt));
      return { success: true, message: 'เปลี่ยนรหัสผ่านเรียบร้อย' };
    });
  } catch (e) {
    return fail_('เกิดข้อผิดพลาด: ' + e.message);
  }
}

function getMyScores(token) {
  try {
    const id = sessionStudentId_(token);
    if (!id) return fail_('หมดเวลาการใช้งาน กรุณาเข้าสู่ระบบใหม่', { expired: true });

    const student = readObjects_(getSheet_(SHEET_STUDENTS)).find(s => normId_(s.studentId) === id);
    if (!student) return fail_('ไม่พบบัญชีนักเรียน', { expired: true });

    const assignments = loadAssignments_(false);
    const scoreRow = loadRoster_().find(r => normId_(r.studentId) === id);

    const items = assignments.map(a => {
      const key = str_(a.assignmentKey);
      const rawScore = scoreRow ? scoreRow[key + '_score'] : '';
      const rawStatus = scoreRow ? scoreRow[key + '_status'] : '';
      const full = Number(a.fullScore) || 0;
      const type = str_(a.type);
      return {
        key: key,
        chapter: str_(a.chapter) || 'อื่น ๆ',
        section: str_(a.section),
        name: str_(a.assignmentName),
        type: type,
        dueDate: fmtDate_(a.dueDate),
        fullScore: full,
        score: displayScore_(rawScore),
        status: deriveStatus_(rawScore, full, type, rawStatus)
      };
    });

    let totalScore = 0, totalFull = 0, recordedScore = 0, recordedFull = 0;
    items.forEach(it => {
      totalFull += it.fullScore;
      if (typeof it.score === 'number') {
        totalScore += it.score;
        recordedScore += it.score;
        recordedFull += it.fullScore;
      }
    });

    return {
      success: true,
      student: profile_(student),
      semester: assignments.length ? str_(assignments[0].semester) : '',
      items: items,
      summary: {
        totalScore: round2_(totalScore),
        totalFull: round2_(totalFull),
        recordedFull: round2_(recordedFull),
        percentOfRecorded: recordedFull > 0 ? Math.round(recordedScore / recordedFull * 100) : 0
      },
      updatedAt: scoreRow ? fmtDate_(scoreRow.updatedAt) : '',
      hasScoreRow: !!scoreRow
    };
  } catch (e) {
    return fail_('เกิดข้อผิดพลาด: ' + e.message);
  }
}

function displayScore_(v) {
  const c = str_(v);
  if (c === '') return null;           // ยังไม่มีคะแนน
  if (isScoreX_(c)) return 'x';        // รหัส "แก้ไข"
  const n = Number(c);
  return Number.isFinite(n) ? n : c;
}

/**
 * สถานะที่นักเรียนเห็น คำนวณจากคะแนนและประเภทงาน
 * ถ้ามีค่าในคอลัมน์ <รหัสงาน>_status (เช่น ส่งช้า) จะใช้ค่านั้นแทน ยกเว้นคะแนนเป็น x จะเป็น "แก้ไข" เสมอ
 */
function deriveStatus_(rawScore, full, type, rawStatus) {
  const override = str_(rawStatus);
  const score = str_(rawScore);
  const isExam = type === 'สอบ' || type === 'สอบเก็บ';

  if (isScoreX_(score)) return 'แก้ไข';
  if (override) return override;
  if (score === '') return isExam ? 'ยังไม่ได้สอบ' : 'ยังไม่มีคะแนน';

  const n = Number(score);
  if (!Number.isFinite(n)) return score;
  if (isExam) return 'สอบแล้ว';
  if (n <= 0) return 'ยังไม่ได้ส่ง';
  if (full > 0 && n >= full) return 'ส่งแล้ว';
  return 'ได้บางส่วน';
}

/* ====================== API ครู ====================== */

function teacherPasswordIsSet_() {
  return !!PropertiesService.getScriptProperties().getProperty('T_HASH');
}

function setTeacherPassword_(password) {
  const salt = newSalt_();
  PropertiesService.getScriptProperties().setProperties({ T_SALT: salt, T_HASH: hashPassword_(password, salt) });
}

function teacherLogin(password) {
  try {
    const cache = CacheService.getScriptCache();
    const fails = Number(cache.get('tfail') || 0);
    if (fails >= CONFIG.MAX_FAILED_LOGINS) return fail_('กรอกรหัสผ่านผิดหลายครั้ง ระบบล็อกชั่วคราว 15 นาที');

    const props = PropertiesService.getScriptProperties();
    const hash = props.getProperty('T_HASH');
    if (!hash) return fail_('ยังไม่ได้ตั้งรหัสผ่านครู ให้เปิดชีตแล้วใช้เมนู GradeChecker > ตั้งรหัสผ่านครู');

    if (hashPassword_(String(password == null ? '' : password), props.getProperty('T_SALT')) !== hash) {
      cache.put('tfail', String(fails + 1), CONFIG.LOCKOUT_SECONDS);
      return fail_('รหัสผ่านครูไม่ถูกต้อง');
    }
    cache.remove('tfail');
    const token = newToken_();
    cache.put('tsess_' + token, '1', CONFIG.SESSION_SECONDS);
    return { success: true, token: token };
  } catch (e) {
    return fail_('เกิดข้อผิดพลาด: ' + e.message);
  }
}

function teacherLogout(token) {
  if (token) CacheService.getScriptCache().remove('tsess_' + token);
  return { success: true };
}

function requireTeacher_(token) {
  if (!token || !CacheService.getScriptCache().get('tsess_' + token)) throw new Error('EXPIRED');
}

/** ตรวจสิทธิ์ครูแล้วรันฟังก์ชัน คืนผลเป็น { success, ... } เสมอ */
function teacherGuard_(token, fn) {
  try {
    requireTeacher_(token);
    const out = fn() || {};
    out.success = true;
    return out;
  } catch (e) {
    if (e.message === 'EXPIRED') return fail_('หมดเวลาการใช้งาน กรุณาเข้าสู่ระบบใหม่', { expired: true });
    return fail_('เกิดข้อผิดพลาด: ' + e.message);
  }
}

function teacherInit(token) {
  return teacherGuard_(token, () => ({
    config: { school: CONFIG.SCHOOL, subject: CONFIG.SUBJECT, weeks: CONFIG.WEEKS, latePenalty: CONFIG.LATE_PENALTY },
    rooms: roomsFromRoster_(loadRoster_()),
    assignments: loadAssignments_(true).map(assignmentInfo_),
    pendingResets: pendingResets_().length
  }));
}

/* ---------- เช็คชื่อ ---------- */

function getAttendanceSheet_() {
  const ss = getSS_();
  let sh = ss.getSheetByName(SHEET_ATTENDANCE);
  if (!sh) {
    sh = ss.insertSheet(SHEET_ATTENDANCE);
    const head = SCORE_BASE_HEADERS.concat(weekHeaders_());
    sh.getRange(1, 1, 1, head.length).setValues([head]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

function weekHeaders_() {
  const h = [];
  for (let w = 1; w <= CONFIG.WEEKS; w++) h.push('w' + w);
  return h;
}

/** เติมนักเรียนที่ยังไม่มีแถวในชีต attendance (ตามทะเบียนใน scores) */
function syncAttendanceRows_() {
  const sh = getAttendanceSheet_();
  const have = {};
  readObjects_(sh).forEach(r => { have[normId_(r.studentId)] = true; });
  const width = SCORE_BASE_HEADERS.length + CONFIG.WEEKS;
  const add = loadRoster_().filter(r => !have[normId_(r.studentId)]).map(r => {
    const row = [str_(r.classRoom), Number(r.studentNo) || str_(r.studentNo), normId_(r.studentId), str_(r.fullName)];
    while (row.length < width) row.push('');
    return row;
  });
  if (add.length) sh.getRange(sh.getLastRow() + 1, 1, add.length, width).setValues(add);
  return sh;
}

function checkWeek_(week) {
  const w = Number(week);
  if (!Number.isInteger(w) || w < 1 || w > CONFIG.WEEKS) throw new Error('สัปดาห์ไม่ถูกต้อง');
  return w;
}

function summarizeMarks_(list) {
  const s = { present: 0, absent: 0, blank: 0, total: list.length };
  list.forEach(x => {
    if (x.mark === MARK_PRESENT) s.present++;
    else if (x.mark === MARK_ABSENT) s.absent++;
    else s.blank++;
  });
  return s;
}

function teacherGetAttendance(token, classRoom, week) {
  return teacherGuard_(token, () => {
    const w = checkWeek_(week);
    const sh = syncAttendanceRows_();
    const col = 'w' + w;
    const nicks = nickMap_();
    const students = readObjects_(sh)
      .filter(r => normRoom_(r.classRoom) === normRoom_(classRoom))
      .sort(byStudentNo_)
      .map(r => ({ studentId: normId_(r.studentId), no: Number(r.studentNo), name: str_(r.fullName), nick: nicks[normId_(r.studentId)] || '', mark: str_(r[col]) }));
    return { room: str_(classRoom), week: w, students: students, summary: summarizeMarks_(students), photosReady: !!photoFolderId_() };
  });
}

/** ชื่อเล่นของนักเรียนที่ลงทะเบียนแล้ว (id -> ชื่อเล่น) */
function nickMap_() {
  const m = {};
  readObjects_(getSheet_(SHEET_STUDENTS)).forEach(s => {
    if (str_(s.passwordHash) && str_(s.nickName)) m[normId_(s.studentId)] = str_(s.nickName).replace(/^'/, '');
  });
  return m;
}

/* ================= รูปนักเรียน (โฟลเดอร์ใน Google Drive ตั้งชื่อไฟล์ = เลขประจำตัว) ================= */
const PHOTO_PROP = 'PHOTO_FOLDER_ID';
const PHOTO_VER_PROP = 'PHOTO_VER';

function photoFolderId_() {
  return PropertiesService.getScriptProperties().getProperty(PHOTO_PROP) || '';
}

/** เลขประจำตัว -> fileId จากไฟล์ในโฟลเดอร์ (ชื่อไฟล์ 69980020.jpg) แคช 1 ชม. */
function photoIndex_() {
  const folderId = photoFolderId_();
  if (!folderId) return null;
  const props = PropertiesService.getScriptProperties();
  const ver = props.getProperty(PHOTO_VER_PROP) || '0';
  const cache = CacheService.getScriptCache();
  const ck = 'phidx_' + ver;
  const hit = cache.get(ck);
  if (hit) return JSON.parse(hit);
  const idx = {};
  const it = DriveApp.getFolderById(folderId).getFiles();
  while (it.hasNext()) {
    const f = it.next();
    const stem = String(f.getName()).replace(/\.[A-Za-z0-9]+$/, '').trim();
    if (/^\d+$/.test(stem)) idx[stem] = f.getId();
  }
  try { cache.put(ck, JSON.stringify(idx), 3600); } catch (_) {}
  return idx;
}

/** รูปย่อ (data URI) ของนักเรียนในห้อง ส่งให้เฉพาะครูที่ล็อกอิน ไม่ต้องแชร์ไฟล์เป็นสาธารณะ */
function teacherGetPhotos(token, classRoom) {
  return teacherGuard_(token, () => {
    let idx;
    try { idx = photoIndex_(); } catch (e) { return { success: true, configured: true, error: 'เปิดโฟลเดอร์รูปไม่ได้ ตรวจสอบสิทธิ์/ลิงก์โฟลเดอร์', photos: {} }; }
    if (!idx) return { success: true, configured: false, photos: {} };
    const ver = PropertiesService.getScriptProperties().getProperty(PHOTO_VER_PROP) || '0';
    const cache = CacheService.getScriptCache();
    const photos = {};
    let missing = 0;
    readObjects_(getSheet_(SHEET_SCORES))
      .filter(r => normRoom_(r.classRoom) === normRoom_(classRoom))
      .forEach(r => {
        const id = normId_(r.studentId);
        const fid = idx[id];
        if (!fid) { missing++; return; }
        const ck = 'ph_' + ver + '_' + id;
        let uri = cache.get(ck);
        if (!uri) {
          try {
            const blob = DriveApp.getFileById(fid).getThumbnail();
            if (blob) {
              uri = 'data:' + (blob.getContentType() || 'image/jpeg') + ';base64,' + Utilities.base64Encode(blob.getBytes());
              if (uri.length < 95000) cache.put(ck, uri, 21600);
            }
          } catch (_) {}
        }
        if (uri) photos[id] = uri; else missing++;
      });
    return { success: true, configured: true, photos: photos, missing: missing };
  });
}

function setPhotoFolderPrompt() {
  const ui = SpreadsheetApp.getUi();
  const r = ui.prompt('ตั้งโฟลเดอร์รูปนักเรียน', 'วางลิงก์หรือรหัสของโฟลเดอร์ใน Google Drive ที่เก็บรูป (ไฟล์ตั้งชื่อตามเลขประจำตัว เช่น 69980020.jpg)\nเว้นว่างแล้วกด OK เพื่อปิดการแสดงรูป', ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;
  const raw = String(r.getResponseText() || '').trim();
  const props = PropertiesService.getScriptProperties();
  if (!raw) { props.setProperty(PHOTO_PROP, ''); ui.alert('ปิดการแสดงรูปแล้ว'); return; }
  const m = raw.match(/[-\w]{25,}/);
  const id = m ? m[0] : raw;
  let folder;
  try { folder = DriveApp.getFolderById(id); } catch (e) { ui.alert('เปิดโฟลเดอร์ไม่ได้: ตรวจสอบลิงก์ และต้องเป็นโฟลเดอร์ที่บัญชีนี้เข้าถึงได้'); return; }
  props.setProperty(PHOTO_PROP, id);
  props.setProperty(PHOTO_VER_PROP, String(Date.now()));
  const idx = photoIndex_() || {};
  ui.alert('ตั้งโฟลเดอร์ "' + folder.getName() + '" แล้ว พบรูป ' + Object.keys(idx).length + ' ไฟล์');
}

/** ใช้เมื่ออัปโหลดรูปเพิ่ม/เปลี่ยนรูปแล้วอยากให้เห็นทันที */
function refreshPhotos() {
  PropertiesService.getScriptProperties().setProperty(PHOTO_VER_PROP, String(Date.now()));
  try { SpreadsheetApp.getUi().alert('รีเฟรชรูปแล้ว เปิดหน้าเช็คชื่อใหม่ได้เลย'); } catch (_) {}
}

function teacherSetAttendance(token, studentId, week, mark) {
  return teacherGuard_(token, () => {
    const w = checkWeek_(week);
    const m = str_(mark);
    if (m !== '' && m !== MARK_PRESENT && m !== MARK_ABSENT) throw new Error('ค่าเช็คชื่อไม่ถูกต้อง');
    return withLock_(() => {
      let sh = getAttendanceSheet_();
      let idx = headerIndex_(sh);
      let row = findRowById_(sh, idx, studentId);
      if (!row) {
        sh = syncAttendanceRows_();
        idx = headerIndex_(sh);
        row = findRowById_(sh, idx, studentId);
      }
      if (!row) throw new Error('ไม่พบนักเรียนในทะเบียน');
      sh.getRange(row, idx['w' + w]).setValue(m);
      return { studentId: normId_(studentId), mark: m };
    });
  });
}

/** เช็คทั้งห้องในครั้งเดียว: onlyBlank = true จะเติมเฉพาะคนที่ยังไม่ได้เช็ค */
function teacherSetAttendanceBulk(token, classRoom, week, mark, onlyBlank) {
  return teacherGuard_(token, () => {
    const w = checkWeek_(week);
    const m = str_(mark);
    if (m !== MARK_PRESENT && m !== MARK_ABSENT) throw new Error('ค่าเช็คชื่อไม่ถูกต้อง');
    return withLock_(() => {
      const sh = syncAttendanceRows_();
      const idx = headerIndex_(sh);
      const last = sh.getLastRow();
      const rng = sh.getRange(2, 1, last - 1, idx['w' + w]);
      const data = rng.getValues();
      const room = normRoom_(classRoom);
      let changed = 0;
      const colVals = data.map(r => {
        const cur = str_(r[idx['w' + w] - 1]);
        if (normRoom_(r[idx.classRoom - 1]) === room && (!onlyBlank || cur === '')) {
          if (cur !== m) changed++;
          return [m];
        }
        return [cur];
      });
      sh.getRange(2, idx['w' + w], colVals.length, 1).setValues(colVals);
      return { changed: changed };
    });
  });
}

/* ---------- ลงคะแนน ---------- */

function findAssignment_(key) {
  const a = loadAssignments_(true).find(x => str_(x.assignmentKey) === str_(key));
  if (!a) throw new Error('ไม่พบรายการงาน: ' + key);
  return a;
}

/** ตารางคะแนนของงานหนึ่งช่อง ทั้งห้อง พร้อมข้อมูลการขาดเรียนของสัปดาห์นั้น */
function teacherGetScores(token, classRoom, key) {
  return teacherGuard_(token, () => {
    const a = findAssignment_(key);
    const info = assignmentInfo_(a);
    const k = info.key;

    const absentIds = {};
    if (info.week) {
      const att = syncAttendanceRows_();
      readObjects_(att).forEach(r => {
        if (str_(r['w' + info.week]) === MARK_ABSENT) absentIds[normId_(r.studentId)] = true;
      });
    }

    const students = loadRoster_()
      .filter(r => normRoom_(r.classRoom) === normRoom_(classRoom))
      .sort(byStudentNo_)
      .map(r => {
        const rawScore = r[k + '_score'];
        const rawStatus = r[k + '_status'];
        const score = displayScore_(rawScore);
        const late = str_(rawStatus) === STATUS_LATE && typeof score === 'number';
        return {
          studentId: normId_(r.studentId),
          no: Number(r.studentNo),
          name: str_(r.fullName),
          score: score,
          raw: late ? round2_(score + CONFIG.LATE_PENALTY) : score,
          late: late,
          absent: !!absentIds[normId_(r.studentId)],
          status: deriveStatus_(rawScore, info.fullScore, info.type, rawStatus)
        };
      });

    return {
      assignment: info,
      room: str_(classRoom),
      students: students,
      pendingAbsent: students.filter(s => s.absent && s.score === null).length
    };
  });
}

/**
 * บันทึกคะแนนหนึ่งช่อง
 * value: ตัวเลข | 'x' (แก้ไข) | '' (ล้างคะแนน)
 * late : true = ส่งช้า หักคะแนน CONFIG.LATE_PENALTY (เฉพาะงานประเภทแลป/แบบฝึกหัดที่ได้คะแนน > 0)
 */
function teacherSetScore(token, studentId, key, value, late) {
  return teacherGuard_(token, () => {
    const a = findAssignment_(key);
    const info = assignmentInfo_(a);
    const full = info.fullScore;

    let raw = null;
    let isX = false;
    if (isScoreX_(value)) {
      isX = true;
    } else if (str_(value) !== '') {
      raw = Number(value);
      if (!Number.isFinite(raw) || raw < 0 || raw > full) throw new Error('คะแนนต้องอยู่ระหว่าง 0 ถึง ' + full);
      raw = round2_(raw);
    }
    const isLate = !!late && info.allowLate && raw !== null && raw > 0;
    const finalScore = raw === null ? null : (isLate ? round2_(Math.max(0, raw - CONFIG.LATE_PENALTY)) : raw);
    const cellScore = isX ? 'x' : (finalScore === null ? '' : finalScore);
    const cellStatus = isLate ? STATUS_LATE : '';

    return withLock_(() => {
      const sh = getSheet_(SHEET_SCORES);
      let idx = headerIndex_(sh);
      const row = findRowById_(sh, idx, studentId);
      if (!row) throw new Error('ไม่พบนักเรียนในชีต scores');

      const scoreCol = getOrCreateCol_(sh, info.key + '_score');
      sh.getRange(row, scoreCol).setValue(cellScore);

      idx = headerIndex_(sh);
      const statusHeader = info.key + '_status';
      if (cellStatus !== '' || idx[statusHeader]) {
        sh.getRange(row, getOrCreateCol_(sh, statusHeader)).setValue(cellStatus);
      }
      idx = headerIndex_(sh);
      if (idx.updatedAt) sh.getRange(row, idx.updatedAt).setValue(new Date());

      return {
        studentId: normId_(studentId),
        score: cellScore === '' ? null : cellScore,
        raw: isX ? 'x' : raw,
        late: isLate,
        status: deriveStatus_(cellScore, full, info.type, cellStatus)
      };
    });
  });
}

/* ---------- รายชื่อนักเรียน / รีเซ็ตรหัสผ่าน ---------- */

function getResetSheet_() {
  const ss = getSS_();
  let sh = ss.getSheetByName(SHEET_RESETS);
  if (!sh) {
    sh = ss.insertSheet(SHEET_RESETS);
    sh.getRange(1, 1, 1, RESET_HEADERS.length).setValues([RESET_HEADERS]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

function pendingResets_() {
  return readObjects_(getResetSheet_())
    .filter(r => str_(r.status) === REQ_PENDING)
    .map(r => ({
      row: r._row,
      studentId: normId_(r.studentId),
      classRoom: str_(r.classRoom),
      fullName: str_(r.fullName),
      requestedAt: fmtDate_(r.requestedAt)
    }));
}

function teacherGetStudents(token, classRoom) {
  return teacherGuard_(token, () => {
    const regMap = {};
    readObjects_(getSheet_(SHEET_STUDENTS)).forEach(s => { regMap[normId_(s.studentId)] = s; });
    const pending = {};
    pendingResets_().forEach(p => { pending[p.studentId] = true; });

    const students = loadRoster_()
      .filter(r => normRoom_(r.classRoom) === normRoom_(classRoom))
      .sort(byStudentNo_)
      .map(r => {
        const id = normId_(r.studentId);
        const s = regMap[id];
        const registered = !!(s && str_(s.passwordHash));
        return {
          studentId: id,
          no: Number(r.studentNo),
          name: str_(r.fullName),
          nickName: s ? str_(s.nickName) : '',
          registered: registered,
          registeredAt: registered ? fmtDate_(s.registeredAt) : '',
          resetPending: !!pending[id]
        };
      });
    return {
      room: str_(classRoom),
      students: students,
      registeredCount: students.filter(s => s.registered).length,
      requests: pendingResets_()
    };
  });
}

function teacherResetPassword(token, studentId) {
  return teacherGuard_(token, () => withLock_(() => {
    if (!resetStudentPassword_(studentId)) throw new Error('ไม่พบบัญชีนี้ในชีต students');
    closeResetRequests_(studentId, REQ_DONE);
    return { studentId: normId_(studentId), requests: pendingResets_() };
  }));
}

function teacherDismissReset(token, studentId) {
  return teacherGuard_(token, () => withLock_(() => {
    closeResetRequests_(studentId, REQ_REJECTED);
    return { requests: pendingResets_() };
  }));
}

function closeResetRequests_(studentId, status) {
  const sh = getResetSheet_();
  const idx = headerIndex_(sh);
  readObjects_(sh).forEach(r => {
    if (normId_(r.studentId) === normId_(studentId) && str_(r.status) === REQ_PENDING) {
      sh.getRange(r._row, idx.status).setValue(status);
      sh.getRange(r._row, idx.handledAt).setValue(new Date());
    }
  });
}

/** ล้างรหัสผ่านของนักเรียน (นักเรียนต้องลงทะเบียนตั้งรหัสใหม่) */
function resetStudentPassword_(studentId) {
  const sh = getSheet_(SHEET_STUDENTS);
  const idx = headerIndex_(sh);
  const s = readObjects_(sh).find(r => normId_(r.studentId) === normId_(studentId));
  if (!s) return false;
  sh.getRange(s._row, idx.salt).clearContent();
  sh.getRange(s._row, idx.passwordHash).clearContent();
  CacheService.getScriptCache().remove('fail_' + normId_(studentId));
  return true;
}

/* ====================== เมนูสำหรับครูในชีต ====================== */

function onOpen() {
  try {
    SpreadsheetApp.getUi()
      .createMenu('GradeChecker')
      .addItem('1) ตั้งค่าชีตครั้งแรก', 'setupSheets')
      .addItem('2) ตั้งรหัสผ่านครู (สำหรับแดชบอร์ดครู)', 'setTeacherPasswordPrompt')
      .addItem('3) ตั้งโฟลเดอร์รูปนักเรียน (แสดงในหน้าเช็คชื่อ)', 'setPhotoFolderPrompt')
      .addItem('รีเฟรชรูปนักเรียน', 'refreshPhotos')
      .addItem('ซิงค์คอลัมน์คะแนนตามชีต assignments', 'syncScoreColumns')
      .addItem('รีเซ็ตรหัสผ่านนักเรียน (กรอกเลขประจำตัว)', 'resetStudentPasswordPrompt')
      .addToUi();
  } catch (_) {}
}

/** สร้างชีตที่ขาดอยู่ ไม่ทับข้อมูลเดิม */
function setupSheets() {
  const ss = getSS_();

  if (!ss.getSheetByName(SHEET_STUDENTS)) {
    const stu = ss.insertSheet(SHEET_STUDENTS);
    stu.getRange(1, 1, 1, STUDENT_HEADERS.length).setValues([STUDENT_HEADERS]).setFontWeight('bold');
    stu.setFrozenRows(1);
  }

  if (!ss.getSheetByName(SHEET_ASSIGNMENTS)) {
    const asg = ss.insertSheet(SHEET_ASSIGNMENTS);
    asg.getRange(1, 1, 1, ASSIGNMENT_HEADERS.length).setValues([ASSIGNMENT_HEADERS]).setFontWeight('bold');
    const rows = seedAssignments_();
    asg.getRange(2, 1, rows.length, ASSIGNMENT_HEADERS.length).setValues(rows);
    asg.setFrozenRows(1);
  }

  let sc = ss.getSheetByName(SHEET_SCORES);
  if (!sc) {
    // ถ้าแท็บแรกเป็นรายชื่อที่นำเข้ามาแล้ว (A1 = classRoom) ให้เปลี่ยนชื่อเป็น scores แทนการสร้างใหม่
    const first = ss.getSheets()[0];
    if (first && str_(first.getRange(1, 1).getValue()) === 'classRoom' &&
        first.getName() !== SHEET_STUDENTS && first.getName() !== SHEET_ASSIGNMENTS) {
      first.setName(SHEET_SCORES);
      sc = first;
    }
  }
  if (!sc) {
    sc = ss.insertSheet(SHEET_SCORES);
    sc.getRange(1, 1, 1, SCORE_BASE_HEADERS.length).setValues([SCORE_BASE_HEADERS]).setFontWeight('bold');
    sc.setFrozenRows(1);
  }

  getResetSheet_();
  getAttendanceSheet_();
  syncScoreColumns();
  syncAttendanceRows_();

  try {
    SpreadsheetApp.getUi().alert(
      'ตั้งค่าชีตเรียบร้อย\n\nขั้นต่อไป:\n1) เมนู GradeChecker > ตั้งรหัสผ่านครู\n2) ทำให้ใช้งานได้ > เว็บแอป\n3) หน้าครูคือลิงก์เว็บแอป ต่อท้ายด้วย ?page=teacher');
  } catch (_) {}
}

/** เพิ่มคอลัมน์ <assignmentKey>_score ที่ยังไม่มีในชีต scores และคง updatedAt ไว้ท้ายสุด */
function syncScoreColumns() {
  const sc = getSheet_(SHEET_SCORES);
  const asg = readObjects_(getSheet_(SHEET_ASSIGNMENTS))
    .filter(a => str_(a.assignmentKey))
    .sort((a, b) => Number(a.sortOrder || 9999) - Number(b.sortOrder || 9999));

  let idx = headerIndex_(sc);
  SCORE_BASE_HEADERS.forEach(h => {
    if (!idx[h]) {
      sc.getRange(1, sc.getLastColumn() + 1).setValue(h).setFontWeight('bold');
      idx = headerIndex_(sc);
    }
  });

  if (idx.updatedAt) sc.deleteColumn(idx.updatedAt);
  asg.forEach(a => {
    const col = str_(a.assignmentKey) + '_score';
    idx = headerIndex_(sc);
    if (!idx[col]) sc.getRange(1, sc.getLastColumn() + 1).setValue(col).setFontWeight('bold');
  });
  sc.getRange(1, sc.getLastColumn() + 1).setValue('updatedAt').setFontWeight('bold');
}

function setTeacherPasswordPrompt() {
  const ui = SpreadsheetApp.getUi();
  const res = ui.prompt('ตั้งรหัสผ่านครู', 'กรอกรหัสผ่านสำหรับเข้าแดชบอร์ดครู (อย่างน้อย 8 ตัวอักษร)', ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) return;
  const pw = res.getResponseText();
  if (pw.length < 8) {
    ui.alert('รหัสผ่านสั้นเกินไป ต้องมีอย่างน้อย 8 ตัวอักษร');
    return;
  }
  setTeacherPassword_(pw);
  ui.alert('ตั้งรหัสผ่านครูเรียบร้อย');
}

function resetStudentPasswordPrompt() {
  const ui = SpreadsheetApp.getUi();
  const res = ui.prompt('รีเซ็ตรหัสผ่าน', 'กรอกเลขประจำตัวนักเรียน (นักเรียนจะลงทะเบียนตั้งรหัสผ่านใหม่ได้)', ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) return;
  const ok = resetStudentPassword_(res.getResponseText());
  if (ok) closeResetRequests_(res.getResponseText(), REQ_DONE);
  ui.alert(ok ? 'รีเซ็ตเรียบร้อย นักเรียนไปที่แท็บ "ลงทะเบียนครั้งแรก" เพื่อตั้งรหัสผ่านใหม่' : 'ไม่พบเลขประจำตัวนี้ในชีต students');
}

/* ---------- ข้อมูลตั้งต้นของชีต assignments (อิงตารางคะแนนที่ให้มา แก้ได้ในชีต) ---------- */

function seedAssignments_() {
  const chapterOfWeek = w => w <= 7 ? 1 : (w <= 10 ? 2 : (w <= 12 ? 3 : 4));
  const chapterName = {
    1: 'บทที่ 1 การเคลื่อนที่และแรง',
    2: 'บทที่ 2 แรงในธรรมชาติ',
    3: 'บทที่ 3 พลังงาน',
    4: 'บทที่ 4 คลื่นกล'
  };
  const quizWeeks = { 3: [1, 1], 7: [2, 1], 11: [3, 2], 13: [4, 3], 16: [5, 4] }; // สัปดาห์ -> [ลำดับควิซ, บท]
  const sem = 2, subject = CONFIG.SUBJECT;
  const rows = [];
  let order = 0;

  for (let w = 1; w <= 16; w++) {
    if (w <= 15) {
      const ch = chapterName[chapterOfWeek(w)];
      rows.push(['lab' + w, ch, 'แลปปฏิบัติการ', 'แลปที่ ' + w, 'แลป', '', 1, ++order, sem, subject, 'TRUE', w]);
      rows.push(['ws' + w, ch, 'แบบฝึกหัดในชีท', 'ชีทที่ ' + w, 'แบบฝึกหัด', '', 2, ++order, sem, subject, 'TRUE', w]);
    }
    if (quizWeeks[w]) {
      const q = quizWeeks[w];
      rows.push(['quiz' + q[0], chapterName[q[1]], 'ควิซสั้น', 'ควิซที่ ' + q[0] + ' (สัปดาห์ ' + w + ')', 'สอบเก็บ', '', 3, ++order, sem, subject, 'TRUE', w]);
    }
    if (w === 7) {
      rows.push(['midterm', 'สอบกลางภาค', '', 'สอบกลางภาค (บทที่ 1)', 'สอบ', '', 20, ++order, sem, subject, 'TRUE', '']);
    }
  }
  rows.push(['final', 'สอบปลายภาค', '', 'สอบปลายภาค', 'สอบ', '', 20, ++order, sem, subject, 'TRUE', '']);
  return rows;
}
