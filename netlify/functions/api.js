const { handleApi } = require('./lib/runtime');
const { createGoogle } = require('./lib/google-rest');

const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
const reply = (status, json) => ({ statusCode: status, headers, body: JSON.stringify(json) });

let GOOGLE = null;   /* ใช้ซ้ำข้ามคำขอในเครื่องเดียวกัน (เก็บโทเค็นและรายชื่อชีตไว้) */

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return reply(405, { success: false, message: 'method not allowed' });
  if (event.body && event.body.length > 20000) return reply(413, { success: false, message: 'คำขอใหญ่เกินไป' });
  let body;
  try { body = JSON.parse(event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body || '{}'); }
  catch (_) { return reply(400, { success: false, message: 'คำขอไม่ถูกต้อง' }); }
  try {
    if (!GOOGLE) GOOGLE = createGoogle(process.env);
    const r = await handleApi(body, { google: GOOGLE, env: process.env, snapshotTtlMs: 15000 });
    return reply(r.status, r.json);
  } catch (e) {
    console.error('api error', e && e.message);
    const busy = e && (e.status === 429 || e.status >= 500 || e.status === 0);
    return reply(busy ? 503 : 500, { success: false, busy: !!busy, message: busy ? 'ระบบกำลังมีคนใช้งานมาก กำลังลองใหม่' : 'ระบบขัดข้อง ลองใหม่อีกครั้ง' });
  }
};
