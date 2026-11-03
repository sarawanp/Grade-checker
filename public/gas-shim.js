/* ทำให้โค้ดหน้าเว็บเดิม (google.script.run) ทำงานบน Netlify โดยส่งคำขอไปที่ /api */
(function () {
  /* ลองใหม่อัตโนมัติ (สุ่มเวลารอ) เมื่อระบบไม่ว่างหรือเน็ตหลุดชั่วคราว นักเรียนไม่ต้องกดซ้ำเอง */
  function send(fn, args, n) {
    return fetch('/api', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fn: fn, args: args }) })
      .then(function (r) { return r.json().catch(function () { return null; }).then(function (j) { return { ok: r.ok, status: r.status, j: j }; }); })
      .catch(function () { return { ok: false, status: 0, j: null }; })
      .then(function (x) {
        var retry = !x.ok && (x.status === 0 || x.status === 429 || x.status >= 502 || (x.j && x.j.busy));
        if (retry && n < 5) {
          var wait = Math.min(8000, 1000 * Math.pow(1.7, n)) * (0.5 + Math.random());
          return new Promise(function (res) { setTimeout(res, wait); }).then(function () { return send(fn, args, n + 1); });
        }
        return x;
      });
  }
  function make(ok, bad) {
    return new Proxy({}, {
      get: function (_, name) {
        if (name === 'withSuccessHandler') return function (h) { return make(h, bad); };
        if (name === 'withFailureHandler') return function (h) { return make(ok, h); };
        return function () {
          var args = Array.prototype.slice.call(arguments);
          send(String(name), args, 0)
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
