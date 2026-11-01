/* ทำให้โค้ดหน้าเว็บเดิม (google.script.run) ทำงานบน Netlify โดยส่งคำขอไปที่ /api */
(function () {
  function make(ok, bad) {
    return new Proxy({}, {
      get: function (_, name) {
        if (name === 'withSuccessHandler') return function (h) { return make(h, bad); };
        if (name === 'withFailureHandler') return function (h) { return make(ok, h); };
        return function () {
          var args = Array.prototype.slice.call(arguments);
          fetch('/api', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fn: String(name), args: args }) })
            .then(function (r) { return r.json().catch(function () { return null; }).then(function (j) { return { ok: r.ok, j: j }; }); })
            .then(function (x) {
              if (!x.ok) throw new Error((x.j && x.j.message) || 'เชื่อมต่อไม่สำเร็จ');
              if (ok) ok(x.j);
            })
            .catch(function (e) { if (bad) bad({ message: e && e.message ? e.message : 'เชื่อมต่อไม่สำเร็จ' }); else console.error(e); });
        };
      }
    });
  }
  window.google = { script: { run: make(null, null) } };
})();
