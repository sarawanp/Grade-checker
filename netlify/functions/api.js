const { handleApi } = require('./lib/runtime');
const { createGoogle } = require('./lib/google-rest');

const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
const reply = (status, json) => ({ statusCode: status, headers, body: JSON.stringify(json) });

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return reply(405, { success: false, message: 'method not allowed' });
  if (event.body && event.body.length > 20000) return reply(413, { success: false, message: 'คำขอใหญ่เกินไป' });
  let body;
  try { body = JSON.parse(event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body || '{}'); }
  catch (_) { return reply(400, { success: false, message: 'คำขอไม่ถูกต้อง' }); }
  try {
    const google = createGoogle(process.env);
    const r = await handleApi(body, { google, env: process.env });
    return reply(r.status, r.json);
  } catch (e) {
    console.error('api error', e && e.message);
    return reply(500, { success: false, message: 'ระบบขัดข้อง ลองใหม่อีกครั้ง' });
  }
};
