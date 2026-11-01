/* คัดลอกหน้าเว็บจาก src/ ไป public/ แล้วแทรก gas-shim.js */
const fs = require('fs'), path = require('path');
const out = path.join(__dirname, 'public');
['index.html', 'teacher.html'].forEach((f) => {
  let h = fs.readFileSync(path.join(__dirname, 'src', f), 'utf8');
  if (!h.includes('/gas-shim.js')) h = h.replace(/<head>/i, '<head>\n<script src="/gas-shim.js"></script>');
  fs.writeFileSync(path.join(out, f), h);
});
console.log('built');
