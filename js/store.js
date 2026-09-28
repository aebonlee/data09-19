/* 브라우저 저장소 — localStorage 를 쓰되, 막혀 있거나 가득 차면 메모리로만 동작합니다 */
(function (root) {
  'use strict';
  var KEY_DB = 'data09-19.db';
  var memory = {};
  var ok = true;
  function get(k) {
    try { return root.localStorage.getItem(k); } catch (e) { ok = false; return memory[k] == null ? null : memory[k]; }
  }
  function set(k, v) {
    try { root.localStorage.setItem(k, v); return true; } catch (e) { ok = false; memory[k] = v; return false; }
  }
  function del(k) {
    try { root.localStorage.removeItem(k); } catch (e) { ok = false; delete memory[k]; }
  }
  function loadDb() {
    var L = root.OPLogic;
    var db = L.emptyDb();
    var raw = get(KEY_DB);
    if (!raw) return db;
    try {
      var p = JSON.parse(raw);
      if (p.catalog && Array.isArray(p.catalog.fields)) db.catalog = p.catalog;
      if (Array.isArray(p.records)) db.records = p.records;
      if (typeof p.seq === 'number') db.seq = p.seq;
      if (p.mapping && typeof p.mapping === 'object') db.mapping = p.mapping;
      if (p._sample) db._sample = true;
    } catch (e) { /* 깨진 값은 무시하고 빈 DB */ }
    return db;
  }
  root.OPStore = {
    loadDb: loadDb,
    saveDb: function (db) { return set(KEY_DB, JSON.stringify(db)); },
    clearDb: function () { del(KEY_DB); },
    available: function () { get(KEY_DB); return ok; }
  };
})(window);
