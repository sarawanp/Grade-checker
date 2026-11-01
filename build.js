/* 1) ฝังโค้ดระบบเป็นสตริงใน lib/sources.js  2) คัดลอกหน้าเว็บจาก src/ ไป public/ แล้วแทรก gas-shim.js */
const fs = require('fs'), path = require('path');
const lib = path.join(__dirname, 'netlify', 'functions', 'lib');
const src = {
  MOCK_SRC: fs.readFileSync(path.join(lib, 'gas-mock.js'), 'utf8'),
  CODE_SRC: fs.readFileSync(path.join(lib, 'Code.gs'), 'utf8')
};
fs.writeFileSync(path.join(lib, 'sources.js'), '/* สร้างอัตโนมัติโดย build.js ห้ามแก้ */\nmodule.exports = ' + JSON.stringify(src) + ';\n');

const out = path.join(__dirname, 'public');
['index.html', 'teacher.html'].forEach((f) => {
  let h = fs.readFileSync(path.join(__dirname, 'src', f), 'utf8');
  if (!h.includes('/gas-shim.js')) h = h.replace(/<head>/i, '<head>\n<script src="/gas-shim.js"></script>');
  fs.writeFileSync(path.join(out, f), h);
});
console.log('built');
