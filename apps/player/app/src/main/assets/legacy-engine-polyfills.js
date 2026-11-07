/*
 * VenueOS legacy-engine compatibility layer (APK asset, pure ES5).
 *
 * Registered by `LegacyEngineCompat` as an androidx.webkit document-start
 * script ONLY when the system WebView's major version is below
 * `LegacyEnginePolicy.MODERN_WEBVIEW_MAJOR`, so a modern engine never loads it.
 * It runs in page context before any page script, in every frame.
 *
 * Contract (pinned by apps/web/src/app/player/__tests__/legacyEnginePolyfills.test.ts):
 *  - every feature is detected first and defined ONLY when missing;
 *  - definitions are non-enumerable, writable, configurable (like built-ins);
 *  - no global is leaked except the spec global `Iterator` when absent;
 *  - every feature is wrapped in its own try/catch, so one failure never
 *    breaks the page or another feature; the script never throws;
 *  - frames on an origin listed in SKIP_ORIGINS (the player's own origin,
 *    substituted by the APK) are left exactly as the engine made them.
 *
 * Syntax (regex `v` flag, decorators, `using`) cannot be polyfilled.
 * Each `feature('…'` line below is one feature group; the APK counts them for
 * its `PLAYER_LEGACY_POLYFILL installed … features=N` log line.
 */
(function () {
  'use strict';
  var SKIP_ORIGINS = /*VENUEOS_SKIP_ORIGINS*/[]/*VENUEOS_SKIP_ORIGINS_END*/;
  var G = typeof globalThis !== 'undefined' ? globalThis
    : typeof self !== 'undefined' ? self : typeof window !== 'undefined' ? window : null;
  if (!G) return;
  try {
    if (G.location && SKIP_ORIGINS.indexOf(String(G.location.origin)) !== -1) return;
  } catch (e) { /* no location: not a frame we skip */ }

  var defProp = Object.defineProperty;
  var getProto = Object.getPrototypeOf;
  var hasOwnP = Object.prototype.hasOwnProperty;
  var SYM = typeof Symbol === 'function' ? Symbol : null;
  var MAX_SAFE = 9007199254740991;
  var MAX_ARRAY = 4294967295;

  function feature(name, install) {
    try { install(); } catch (e) { /* this feature stays absent; the page is untouched */ }
  }
  function missing(obj, key) {
    try { return obj != null && typeof obj[key] === 'undefined'; } catch (e) { return false; }
  }
  function def(obj, key, value, fnName) {
    if (!missing(obj, key)) return false;
    if (typeof value === 'function') {
      try { defProp(value, 'name', { value: fnName || String(key), configurable: true }); } catch (e) {}
    }
    defProp(obj, key, { value: value, writable: true, enumerable: false, configurable: true });
    return true;
  }
  function unscopable(names) {
    try {
      var u = SYM && Array.prototype[SYM.unscopables];
      if (!u) return;
      for (var i = 0; i < names.length; i++) {
        if (!hasOwnP.call(u, names[i])) {
          defProp(u, names[i], { value: true, writable: true, enumerable: true, configurable: true });
        }
      }
    } catch (e) {}
  }
  function toInt(v) {
    var n = +v;
    if (n !== n || n === 0) return 0;
    if (n === Infinity || n === -Infinity) return n;
    return n < 0 ? Math.ceil(n) : Math.floor(n);
  }
  function toLength(v) {
    var n = toInt(v);
    return n <= 0 ? 0 : Math.min(n, MAX_SAFE);
  }
  function toObject(v) {
    if (v == null) throw new TypeError('Cannot convert undefined or null to object');
    return Object(v);
  }
  function toStr(v) {
    if (typeof v === 'symbol') throw new TypeError('Cannot convert a Symbol value to a string');
    return String(v);
  }
  function isObject(v) {
    return v !== null && (typeof v === 'object' || typeof v === 'function');
  }
  function callable(fn, what) {
    if (typeof fn !== 'function') throw new TypeError(String(what) + ' is not a function');
  }
  function arrayOf(len) {
    if (len > MAX_ARRAY) throw new RangeError('Invalid array length');
    return new Array(len);
  }
  function domError(message, name) {
    try { return new G.DOMException(message, name); } catch (e) {
      var err = new Error(message);
      err.name = name;
      return err;
    }
  }
  function getIterator(obj) {
    var method = obj == null ? undefined : obj[SYM.iterator];
    if (typeof method !== 'function') throw new TypeError('object is not iterable');
    var it = method.call(obj);
    if (!isObject(it)) throw new TypeError('Result of the Symbol.iterator method is not an object');
    return { it: it, next: it.next };
  }
  function step(rec) {
    var r = rec.next.call(rec.it);
    if (!isObject(r)) throw new TypeError('Iterator result ' + String(r) + ' is not an object');
    return r;
  }
  function closeQuietly(it) {
    try { var ret = it['return']; if (ret != null) ret.call(it); } catch (e) {}
  }
  function closeNormally(it) {
    var ret = it['return'];
    if (ret == null) return;
    var r = ret.call(it);
    if (!isObject(r)) throw new TypeError('iterator.return() did not return an object');
  }
  function forOf(items, fn) {
    var rec = getIterator(items);
    for (var k = 0; ; k++) {
      var r = step(rec);
      if (r.done) return;
      try { fn(r.value, k); } catch (e) { closeQuietly(rec.it); throw e; }
    }
  }

  // ── Object ───────────────────────────────────────────────────────────
  feature('Object.hasOwn', function () {
    def(Object, 'hasOwn', function (O, P) { return hasOwnP.call(toObject(O), P); });
  });

  feature('Object.groupBy+Map.groupBy', function () {
    def(Object, 'groupBy', function (items, callback) {
      if (items == null) throw new TypeError('items is null or undefined');
      callable(callback, callback);
      var out = Object.create(null);
      forOf(items, function (value, k) {
        var key = callback(value, k);
        if (typeof key !== 'symbol') key = String(key);
        if (hasOwnP.call(out, key)) out[key].push(value); else out[key] = [value];
      });
      return out;
    });
    if (typeof G.Map === 'function') {
      def(G.Map, 'groupBy', function (items, callback) {
        if (items == null) throw new TypeError('items is null or undefined');
        callable(callback, callback);
        var out = new G.Map();
        forOf(items, function (value, k) {
          var key = callback(value, k);
          if (key === 0) key = 0; // -0 → +0
          var group = out.get(key);
          if (group) group.push(value); else out.set(key, [value]);
        });
        return out;
      });
    }
  });

  // ── Array / %TypedArray% / String: relative indexing and find-from-last ──
  var TA = typeof G.Int8Array === 'function' ? getProto(G.Int8Array.prototype) : null;
  var taTag = null;
  try { taTag = Object.getOwnPropertyDescriptor(TA, SYM.toStringTag).get; } catch (e) {}
  function taName(O) {
    var name = taTag ? taTag.call(O) : undefined;
    if (!name) throw new TypeError('this is not a typed array.');
    return name;
  }
  function taLength(O) { taName(O); return O.length; }

  feature('.at', function () {
    function atOn(O, len, index) {
      var k = toInt(index);
      if (k < 0) k += len;
      return k < 0 || k >= len ? undefined : O[k];
    }
    if (def(Array.prototype, 'at', function (index) {
      var O = toObject(this);
      return atOn(O, toLength(O.length), index);
    })) unscopable(['at']);
    if (TA) def(TA, 'at', function (index) { return atOn(this, taLength(this), index); });
    def(String.prototype, 'at', function (index) {
      if (this == null) throw new TypeError('String.prototype.at called on null or undefined');
      var S = toStr(this);
      var k = toInt(index);
      if (k < 0) k += S.length;
      return k < 0 || k >= S.length ? undefined : S.charAt(k);
    });
  });

  feature('.findLast+.findLastIndex', function () {
    function findLast(O, len, predicate, thisArg, wantIndex) {
      callable(predicate, predicate);
      for (var k = len - 1; k >= 0; k--) {
        var v = O[k];
        if (predicate.call(thisArg, v, k, O)) return wantIndex ? k : v;
      }
      return wantIndex ? -1 : undefined;
    }
    var a = def(Array.prototype, 'findLast', function (predicate) {
      var O = toObject(this);
      return findLast(O, toLength(O.length), predicate, arguments[1], false);
    });
    var b = def(Array.prototype, 'findLastIndex', function (predicate) {
      var O = toObject(this);
      return findLast(O, toLength(O.length), predicate, arguments[1], true);
    });
    if (a) unscopable(['findLast']);
    if (b) unscopable(['findLastIndex']);
    if (TA) {
      def(TA, 'findLast', function (predicate) {
        return findLast(this, taLength(this), predicate, arguments[1], false);
      });
      def(TA, 'findLastIndex', function (predicate) {
        return findLast(this, taLength(this), predicate, arguments[1], true);
      });
    }
  });

  // ── change-array-by-copy ─────────────────────────────────────────────
  feature('.toReversed+.toSorted+.toSpliced+.with', function () {
    function compareOk(fn) {
      if (fn !== undefined && typeof fn !== 'function') {
        throw new TypeError('The comparison function must be either a function or undefined');
      }
    }
    var added = [];
    if (def(Array.prototype, 'toReversed', function () {
      var O = toObject(this), len = toLength(O.length), A = arrayOf(len);
      for (var k = 0; k < len; k++) A[k] = O[len - 1 - k];
      return A;
    })) added.push('toReversed');
    if (def(Array.prototype, 'toSorted', function (comparefn) {
      compareOk(comparefn);
      var O = toObject(this), len = toLength(O.length), A = arrayOf(len);
      for (var k = 0; k < len; k++) A[k] = O[k];
      return A.sort(comparefn);
    })) added.push('toSorted');
    if (def(Array.prototype, 'toSpliced', function (start, skipCount) {
      var O = toObject(this), len = toLength(O.length);
      var rel = toInt(start);
      var from = rel === -Infinity ? 0 : rel < 0 ? Math.max(len + rel, 0) : Math.min(rel, len);
      var insert = arguments.length > 2 ? arguments.length - 2 : 0;
      var skip;
      if (arguments.length === 0) skip = 0;
      else if (arguments.length === 1) skip = len - from;
      else skip = Math.min(Math.max(toInt(skipCount), 0), len - from);
      var newLen = len + insert - skip;
      if (newLen > MAX_SAFE) throw new TypeError('Invalid array length');
      var A = arrayOf(newLen), i = 0, k;
      for (k = 0; k < from; k++) A[i++] = O[k];
      for (k = 0; k < insert; k++) A[i++] = arguments[k + 2];
      for (k = from + skip; k < len; k++) A[i++] = O[k];
      return A;
    })) added.push('toSpliced');
    def(Array.prototype, 'with', function (index, value) {
      var O = toObject(this), len = toLength(O.length), rel = toInt(index);
      var actual = rel >= 0 ? rel : len + rel;
      if (actual >= len || actual < 0) throw new RangeError('Invalid index : ' + String(index));
      var A = arrayOf(len);
      for (var k = 0; k < len; k++) A[k] = k === actual ? value : O[k];
      return A;
    }, 'with');
    unscopable(added);
    if (TA) {
      def(TA, 'toReversed', function () {
        var len = taLength(this), A = new G[taName(this)](len);
        for (var k = 0; k < len; k++) A[k] = this[len - 1 - k];
        return A;
      });
      def(TA, 'toSorted', function (comparefn) {
        compareOk(comparefn);
        var len = taLength(this), A = new G[taName(this)](len);
        for (var k = 0; k < len; k++) A[k] = this[k];
        return A.sort(comparefn);
      });
      def(TA, 'with', function (index, value) {
        var name = taName(this), len = this.length, rel = toInt(index);
        var actual = rel >= 0 ? rel : len + rel;
        var v;
        if (/^Big/.test(name)) {
          if (typeof value === 'number') throw new TypeError('Cannot convert ' + value + ' to a BigInt');
          v = G.BigInt(value);
        } else {
          v = +value;
        }
        if (actual >= len || actual < 0) throw new RangeError('Invalid typed array index');
        var A = new G[name](len);
        for (var k = 0; k < len; k++) A[k] = k === actual ? v : this[k];
        return A;
      }, 'with');
    }
  });

  // ── String well-formedness ───────────────────────────────────────────
  feature('String.isWellFormed+toWellFormed', function () {
    function scan(S, fix) {
      var out = '', bad = false;
      for (var i = 0; i < S.length; i++) {
        var c = S.charCodeAt(i);
        if (c >= 0xD800 && c <= 0xDBFF && i + 1 < S.length) {
          var d = S.charCodeAt(i + 1);
          if (d >= 0xDC00 && d <= 0xDFFF) { if (fix) out += S.charAt(i) + S.charAt(i + 1); i++; continue; }
        }
        if (c >= 0xD800 && c <= 0xDFFF) { bad = true; if (fix) out += '�'; else return false; continue; }
        if (fix) out += S.charAt(i);
      }
      return fix ? out : !bad;
    }
    def(String.prototype, 'isWellFormed', function () {
      if (this == null) throw new TypeError('String.prototype.isWellFormed called on null or undefined');
      return scan(toStr(this), false);
    });
    def(String.prototype, 'toWellFormed', function () {
      if (this == null) throw new TypeError('String.prototype.toWellFormed called on null or undefined');
      return scan(toStr(this), true);
    });
  });

  // ── Promise ──────────────────────────────────────────────────────────
  feature('Promise.withResolvers+Promise.try', function () {
    var P = G.Promise;
    if (typeof P !== 'function') return;
    def(P, 'withResolvers', function () {
      var C = this, res, rej;
      if (!isObject(C)) throw new TypeError('Promise.withResolvers called on a non-object');
      var promise = new C(function (a, b) { res = a; rej = b; });
      return { promise: promise, resolve: res, reject: rej };
    });
    def(P, 'try', function (callback) {
      var C = this, args = Array.prototype.slice.call(arguments, 1);
      if (!isObject(C)) throw new TypeError('Promise.try called on a non-object');
      return new C(function (resolve) { resolve(callback.apply(undefined, args)); });
    }, 'try');
  });

  // ── Set methods ──────────────────────────────────────────────────────
  feature('Set methods', function () {
    var S = G.Set;
    if (typeof S !== 'function') return;
    var sp = S.prototype, sHas = sp.has, sAdd = sp.add, sDel = sp['delete'], sEach = sp.forEach;
    var sSize = Object.getOwnPropertyDescriptor(sp, 'size').get;
    function size(O) { return sSize.call(O); } // throws TypeError for a non-Set
    function record(obj) {
      if (!isObject(obj)) throw new TypeError('The argument must be an object');
      var n = +obj.size;
      if (n !== n) throw new TypeError("The 'size' property must be a number");
      var intSize = toInt(n);
      if (intSize < 0) throw new RangeError("'size' must be non-negative");
      var has = obj.has; callable(has, "'has'");
      var keys = obj.keys; callable(keys, "'keys'");
      return { set: obj, size: intSize, has: has, keys: keys };
    }
    function keysOf(rec) {
      var it = rec.keys.call(rec.set);
      if (!isObject(it)) throw new TypeError('keys() did not return an object');
      return { it: it, next: it.next };
    }
    function each(rec, fn) { // fn returns true to stop (and close)
      var kr = keysOf(rec);
      for (;;) {
        var r = step(kr);
        if (r.done) return false;
        var v = r.value === 0 ? 0 : r.value;
        if (fn(v)) { closeNormally(kr.it); return true; }
      }
    }
    function elems(O) { var a = []; sEach.call(O, function (v) { a.push(v); }); return a; }
    function copy(O) { var R = new S(); sEach.call(O, function (v) { sAdd.call(R, v); }); return R; }
    function inOther(rec, v) { return !!rec.has.call(rec.set, v); }
    def(sp, 'union', function (other) {
      size(this); var rec = record(other), R = copy(this);
      each(rec, function (v) { sAdd.call(R, v); });
      return R;
    });
    def(sp, 'intersection', function (other) {
      var O = this, n = size(O), rec = record(other), R = new S(), i, a;
      if (n <= rec.size) {
        a = elems(O);
        for (i = 0; i < a.length; i++) if (inOther(rec, a[i])) sAdd.call(R, a[i]);
      } else {
        each(rec, function (v) { if (sHas.call(O, v)) sAdd.call(R, v); });
      }
      return R;
    });
    def(sp, 'difference', function (other) {
      var O = this, n = size(O), rec = record(other), R = copy(O), i, a;
      if (n <= rec.size) {
        a = elems(O);
        for (i = 0; i < a.length; i++) if (inOther(rec, a[i])) sDel.call(R, a[i]);
      } else {
        each(rec, function (v) { sDel.call(R, v); });
      }
      return R;
    });
    def(sp, 'symmetricDifference', function (other) {
      var O = this; size(O); var rec = record(other), R = copy(O);
      each(rec, function (v) { if (sHas.call(O, v)) sDel.call(R, v); else sAdd.call(R, v); });
      return R;
    });
    def(sp, 'isSubsetOf', function (other) {
      var O = this, n = size(O), rec = record(other);
      if (n > rec.size) return false;
      var a = elems(O);
      for (var i = 0; i < a.length; i++) if (!inOther(rec, a[i])) return false;
      return true;
    });
    def(sp, 'isSupersetOf', function (other) {
      var O = this, n = size(O), rec = record(other);
      if (n < rec.size) return false;
      return !each(rec, function (v) { return !sHas.call(O, v); });
    });
    def(sp, 'isDisjointFrom', function (other) {
      var O = this, n = size(O), rec = record(other);
      if (n <= rec.size) {
        var a = elems(O);
        for (var i = 0; i < a.length; i++) if (inOther(rec, a[i])) return false;
        return true;
      }
      return !each(rec, function (v) { return sHas.call(O, v); });
    });
  });

  // ── Array.fromAsync ──────────────────────────────────────────────────
  feature('Array.fromAsync', function () {
    var P = G.Promise;
    if (typeof P !== 'function') return;
    def(Array, 'fromAsync', function (asyncItems) {
      var C = this, mapfn = arguments[1], thisArg = arguments[2];
      return new P(function (resolve, reject) {
        if (mapfn !== undefined) callable(mapfn, mapfn);
        if (asyncItems == null) throw new TypeError('asyncItems is null or undefined');
        var asyncM = SYM.asyncIterator && asyncItems[SYM.asyncIterator];
        var syncM = asyncM == null ? asyncItems[SYM.iterator] : null;
        var A, k = 0, rec = null, len = 0, isAsync = asyncM != null;
        if (asyncM != null || syncM != null) {
          var it = (asyncM != null ? asyncM : syncM).call(asyncItems);
          if (!isObject(it)) throw new TypeError('iterator is not an object');
          rec = { it: it, next: it.next };
          A = typeof C === 'function' ? new C() : [];
        } else {
          var arrayLike = Object(asyncItems);
          len = toLength(arrayLike.length);
          A = typeof C === 'function' ? new C(len) : arrayOf(len);
        }
        function finish() { A.length = k; resolve(A); }
        function fail(e) {
          if (!rec) return reject(e);
          var ret;
          try { ret = rec.it['return']; } catch (x) { return reject(e); }
          if (ret == null) return reject(e);
          var p;
          try { p = ret.call(rec.it); } catch (x) { return reject(e); }
          if (isAsync) P.resolve(p).then(function () { reject(e); }, function () { reject(e); });
          else reject(e);
        }
        function store(v) {
          if (!mapfn) { A[k++] = v; loop(); return; }
          var mapped;
          try { mapped = mapfn.call(thisArg, v, k); } catch (e) { fail(e); return; }
          P.resolve(mapped).then(function (m) { A[k++] = m; loop(); }, fail);
        }
        function loop() {
          if (!rec) {
            if (k >= len) { finish(); return; }
            P.resolve(Object(asyncItems)[k]).then(store, reject);
            return;
          }
          var r;
          try { r = rec.next.call(rec.it); } catch (e) { reject(e); return; }
          P.resolve(r).then(function (res) {
            if (!isObject(res)) throw new TypeError('iterator result is not an object');
            if (res.done) { finish(); return; }
            if (isAsync) { store(res.value); return; }
            P.resolve(res.value).then(store, fail);
          }).then(null, reject);
        }
        loop();
      });
    });
  });

  // ── Iterator helpers + the Iterator global ───────────────────────────
  feature('Iterator helpers', function () {
    if (!SYM) return;
    var IP = getProto(getProto([][SYM.iterator]()));
    if (!IP || typeof IP.map === 'function') return;
    var states = new G.WeakMap();
    var HP = Object.create(IP);
    var DONE = function () { return { value: undefined, done: true }; };
    function direct(O) {
      if (!isObject(O)) throw new TypeError('Iterator helper called on a non-object');
      return { it: O, next: O.next };
    }
    function validate(O, fn) {
      if (!isObject(O)) throw new TypeError('Iterator helper called on a non-object');
      if (typeof fn !== 'function') { closeQuietly(O); throw new TypeError(String(fn) + ' is not a function'); }
    }
    function helper(rec, next, inner) {
      var h = Object.create(HP);
      states.set(h, { rec: rec, next: next, done: false, running: false, inner: inner || null });
      return h;
    }
    def(HP, 'next', function () {
      var s = states.get(this);
      if (!s) throw new TypeError('next method called on incompatible receiver');
      if (s.running) throw new TypeError('Generator is already running');
      if (s.done) return DONE();
      s.running = true;
      try {
        var r = s.next(s);
        if (r.done) s.done = true;
        return r;
      } catch (e) { s.done = true; throw e; } finally { s.running = false; }
    });
    def(HP, 'return', function () {
      var s = states.get(this);
      if (!s) throw new TypeError('return method called on incompatible receiver');
      if (s.running) throw new TypeError('Generator is already running');
      if (s.done) return DONE();
      s.done = true;
      if (s.inner && s.inner.rec) closeQuietly(s.inner.rec.it);
      closeNormally(s.rec.it);
      return DONE();
    }, 'return');
    try { defProp(HP, SYM.toStringTag, { value: 'Iterator Helper', configurable: true }); } catch (e) {}
    function counted(O, fn, body) {
      validate(O, fn);
      var rec = direct(O), c = { n: 0 };
      return helper(rec, function (s) { return body(s, rec, c); });
    }
    function flattenable(obj, rejectStrings) {
      if (!isObject(obj) && (rejectStrings || typeof obj !== 'string')) {
        throw new TypeError(String(obj) + ' is not an object');
      }
      var m = obj[SYM.iterator], it = m == null ? obj : m.call(obj);
      if (!isObject(it)) throw new TypeError(String(it) + ' is not an object');
      return { it: it, next: it.next };
    }
    function limitOf(O, limit) {
      if (!isObject(O)) throw new TypeError('Iterator helper called on a non-object');
      var n;
      try {
        n = +limit;
        if (n !== n) throw new RangeError(String(limit) + ' must be positive');
      } catch (e) { closeQuietly(O); throw e; }
      n = toInt(n);
      if (n < 0) { closeQuietly(O); throw new RangeError(String(limit) + ' must be positive'); }
      return n;
    }
    def(IP, 'map', function (mapper) {
      return counted(this, mapper, function (s, rec, c) {
        var r = step(rec);
        if (r.done) return DONE();
        try { return { value: mapper(r.value, c.n++), done: false }; } catch (e) { closeQuietly(rec.it); throw e; }
      });
    });
    def(IP, 'filter', function (predicate) {
      return counted(this, predicate, function (s, rec, c) {
        for (;;) {
          var r = step(rec);
          if (r.done) return DONE();
          var keep;
          try { keep = predicate(r.value, c.n++); } catch (e) { closeQuietly(rec.it); throw e; }
          if (keep) return { value: r.value, done: false };
        }
      });
    });
    def(IP, 'take', function (limit) {
      var O = this, left = limitOf(O, limit), rec = direct(O);
      return helper(rec, function () {
        if (left === 0) { closeNormally(rec.it); return DONE(); }
        if (left !== Infinity) left--;
        var r = step(rec);
        return r.done ? DONE() : { value: r.value, done: false };
      });
    });
    def(IP, 'drop', function (limit) {
      var O = this, left = limitOf(O, limit), rec = direct(O);
      return helper(rec, function () {
        while (left > 0) {
          if (left !== Infinity) left--;
          if (step(rec).done) return DONE();
        }
        var r = step(rec);
        return r.done ? DONE() : { value: r.value, done: false };
      });
    });
    def(IP, 'flatMap', function (mapper) {
      validate(this, mapper);
      var rec = direct(this), n = 0, holder = { rec: null };
      return helper(rec, function () {
        for (;;) {
          if (holder.rec) {
            var ir;
            try { ir = step(holder.rec); } catch (e) { closeQuietly(rec.it); throw e; }
            if (!ir.done) return { value: ir.value, done: false };
            holder.rec = null;
            continue;
          }
          var r = step(rec);
          if (r.done) return DONE();
          try { holder.rec = flattenable(mapper(r.value, n++), true); } catch (e) { closeQuietly(rec.it); throw e; }
        }
      }, holder);
    });
    function consume(O, fn, onValue) {
      validate(O, fn);
      var rec = direct(O);
      for (var n = 0; ; n++) {
        var r = step(rec);
        if (r.done) return { done: true };
        var out;
        try { out = onValue(r.value, n); } catch (e) { closeQuietly(rec.it); throw e; }
        if (out) { closeNormally(rec.it); return out; }
      }
    }
    def(IP, 'reduce', function (reducer) {
      var O = this, hasInit = arguments.length > 1, acc = arguments[1];
      validate(O, reducer);
      var rec = direct(O), n = 0;
      if (!hasInit) {
        var first = step(rec);
        if (first.done) throw new TypeError('Reduce of empty iterator with no initial value');
        acc = first.value; n = 1;
      }
      for (;;) {
        var r = step(rec);
        if (r.done) return acc;
        try { acc = reducer(acc, r.value, n++); } catch (e) { closeQuietly(rec.it); throw e; }
      }
    });
    def(IP, 'toArray', function () {
      var rec = direct(this), out = [];
      for (;;) { var r = step(rec); if (r.done) return out; out.push(r.value); }
    });
    def(IP, 'forEach', function (fn) {
      consume(this, fn, function (v, n) { fn(v, n); return null; });
      return undefined;
    });
    def(IP, 'some', function (predicate) {
      return !!consume(this, predicate, function (v, n) { return predicate(v, n) ? { hit: true } : null; }).hit;
    });
    def(IP, 'every', function (predicate) {
      return !consume(this, predicate, function (v, n) { return predicate(v, n) ? null : { hit: true }; }).hit;
    });
    def(IP, 'find', function (predicate) {
      return consume(this, predicate, function (v, n) { return predicate(v, n) ? { hit: true, value: v } : null; }).value;
    });
    if (typeof G.Iterator === 'undefined') {
      var Iterator = function Iterator() {
        if (!(this instanceof Iterator) || this.constructor === Iterator) {
          throw new TypeError('Abstract class Iterator not directly constructable');
        }
      };
      defProp(Iterator, 'prototype', { value: IP, writable: false });
      if (!hasOwnP.call(IP, 'constructor')) {
        defProp(IP, 'constructor', { value: Iterator, writable: true, enumerable: false, configurable: true });
      }
      var WP = Object.create(IP);
      def(WP, 'next', function () { var s = states.get(this); if (!s) throw new TypeError('incompatible receiver'); return s.rec.next.call(s.rec.it); });
      def(WP, 'return', function () {
        var s = states.get(this);
        if (!s) throw new TypeError('incompatible receiver');
        var ret = s.rec.it['return'];
        return ret == null ? DONE() : ret.call(s.rec.it);
      }, 'return');
      def(Iterator, 'from', function (O) {
        var rec = flattenable(O, false);
        if (rec.it instanceof Iterator) return rec.it;
        var w = Object.create(WP);
        states.set(w, { rec: rec });
        return w;
      }, 'from');
      def(G, 'Iterator', Iterator, 'Iterator');
    }
  });

  // ── structuredClone (synchronous; `transfer` copies, it cannot detach) ──
  feature('structuredClone', function () {
    if (typeof G.Map !== 'function') return;
    var toTag = Object.prototype.toString;
    var errors = { Error: 1, EvalError: 1, RangeError: 1, ReferenceError: 1, SyntaxError: 1, TypeError: 1, URIError: 1 };
    var refuse = { Function: 1, Symbol: 1, Promise: 1, WeakMap: 1, WeakSet: 1, WeakRef: 1, Window: 1, Generator: 1 };
    function fail(what) { return domError(what + ' could not be cloned.', 'DataCloneError'); }
    function clone(v, seen) {
      var t = typeof v;
      if (t === 'symbol') throw fail(String(v));
      if (t === 'function') throw fail(String(v));
      if (v === null || t !== 'object') return v;
      if (seen.has(v)) return seen.get(v);
      var tag = toTag.call(v).slice(8, -1), out, i, keys;
      if (refuse[tag] || (typeof G.Node === 'function' && v instanceof G.Node)) throw fail(tag);
      if (tag === 'Boolean' || tag === 'Number' || tag === 'String' || tag === 'BigInt') {
        out = Object(v.valueOf());
      } else if (tag === 'Date') {
        out = new Date(v.getTime());
      } else if (tag === 'RegExp') {
        out = new RegExp(v.source, v.flags);
      } else if (tag === 'ArrayBuffer') {
        out = v.slice(0);
      } else if (G.ArrayBuffer && G.ArrayBuffer.isView(v)) {
        var buf = clone(v.buffer, seen);
        out = tag === 'DataView' ? new G.DataView(buf, v.byteOffset, v.byteLength)
          : new G[tag](buf, v.byteOffset, v.length);
      } else if (tag === 'Map') {
        out = new G.Map(); seen.set(v, out);
        v.forEach(function (val, key) { out.set(clone(key, seen), clone(val, seen)); });
        return out;
      } else if (tag === 'Set') {
        out = new G.Set(); seen.set(v, out);
        v.forEach(function (val) { out.add(clone(val, seen)); });
        return out;
      } else if (tag === 'Error') {
        var ctor = errors[v.name] ? G[v.name] : Error;
        out = Object.create(ctor.prototype);
        seen.set(v, out);
        if (hasOwnP.call(v, 'message')) defProp(out, 'message', { value: String(v.message), writable: true, configurable: true });
        if (typeof v.stack === 'string') defProp(out, 'stack', { value: v.stack, writable: true, configurable: true });
        if (hasOwnP.call(v, 'cause')) defProp(out, 'cause', { value: clone(v.cause, seen), writable: true, configurable: true });
        return out;
      } else if (tag === 'File' && typeof G.File === 'function') {
        out = new G.File([v], v.name, { type: v.type, lastModified: v.lastModified });
      } else if (tag === 'Blob') {
        out = v.slice(0, v.size, v.type);
      } else if (tag === 'ImageData' && typeof G.ImageData === 'function') {
        out = new G.ImageData(new G.Uint8ClampedArray(v.data), v.width, v.height);
      } else if (tag === 'Array') {
        out = new Array(v.length); seen.set(v, out);
        keys = Object.keys(v);
        for (i = 0; i < keys.length; i++) out[keys[i]] = clone(v[keys[i]], seen);
        return out;
      } else if (tag === 'Object' || tag === 'Arguments' || getProto(v) === null || !isPlatform(v)) {
        out = {}; seen.set(v, out);
        keys = Object.keys(v);
        for (i = 0; i < keys.length; i++) out[keys[i]] = clone(v[keys[i]], seen);
        return out;
      } else {
        throw fail(tag);
      }
      seen.set(v, out);
      return out;
    }
    function isPlatform(v) {
      // An object whose prototype chain holds a non-Object built-in tag the
      // engine owns (a DOM interface) is a platform object: refuse it.
      var p = getProto(v);
      while (p && p !== Object.prototype) {
        var c = hasOwnP.call(p, 'constructor') ? p.constructor : null;
        if (c && /\[native code\]/.test(Function.prototype.toString.call(c))) return true;
        p = getProto(p);
      }
      return false;
    }
    def(G, 'structuredClone', function (value) {
      if (arguments.length === 0) throw new TypeError("Failed to execute 'structuredClone': 1 argument required, but only 0 present.");
      var options = arguments[1];
      if (options != null && !isObject(options)) throw new TypeError("Failed to execute 'structuredClone': The provided value is not of type 'StructuredSerializeOptions'.");
      return clone(value, new G.Map());
    });
  });

  // ── crypto.randomUUID (secure contexts only, like the engine) ──
  feature('crypto.randomUUID', function () {
    var c = G.crypto;
    if (!c || typeof c.getRandomValues !== 'function' || G.isSecureContext === false) return;
    var target = typeof G.Crypto === 'function' && c instanceof G.Crypto ? G.Crypto.prototype : c;
    def(target, 'randomUUID', function () {
      var b = new G.Uint8Array(16), hex = [];
      c.getRandomValues(b);
      b[6] = (b[6] & 0x0f) | 0x40;
      b[8] = (b[8] & 0x3f) | 0x80;
      for (var i = 0; i < 16; i++) hex.push((b[i] + 0x100).toString(16).slice(1));
      return hex.slice(0, 4).join('') + '-' + hex.slice(4, 6).join('') + '-' + hex.slice(6, 8).join('') +
        '-' + hex.slice(8, 10).join('') + '-' + hex.slice(10, 16).join('');
    });
  });

  // ── AbortSignal: reason, throwIfAborted, abort(), timeout(), any() ──
  feature('AbortSignal', function () {
    var AS = G.AbortSignal, AC = G.AbortController;
    if (typeof AS !== 'function' || typeof AC !== 'function') return;
    var reasons = new G.WeakMap();
    function abortError() { return domError('signal is aborted without reason', 'AbortError'); }
    if (!('reason' in AS.prototype)) {
      var nativeAbort = AC.prototype.abort;
      defProp(AS.prototype, 'reason', {
        get: function () { return reasons.get(this); }, enumerable: false, configurable: true,
      });
      defProp(AC.prototype, 'abort', {
        value: function abort(reason) {
          var s = this.signal;
          if (s && !s.aborted) reasons.set(s, reason === undefined ? abortError() : reason);
          return nativeAbort.apply(this, arguments);
        },
        writable: true, enumerable: false, configurable: true,
      });
    }
    def(AS.prototype, 'throwIfAborted', function () {
      if (this.aborted) throw this.reason === undefined ? abortError() : this.reason;
    });
    def(AS, 'abort', function () {
      var c = new AC();
      c.abort(arguments[0]);
      return c.signal;
    }, 'abort');
    def(AS, 'timeout', function (ms) {
      var n = +ms;
      if (n !== n || n < 0 || n > MAX_SAFE) throw new TypeError("Failed to execute 'timeout' on 'AbortSignal': Value is outside the 'unsigned long long' value range.");
      var c = new AC();
      setTimeout(function () { c.abort(domError('signal timed out', 'TimeoutError')); }, Math.floor(n));
      return c.signal;
    });
    def(AS, 'any', function (signals) {
      var list = [];
      forOf(signals, function (s) {
        if (!(s instanceof AS)) throw new TypeError("Failed to execute 'any' on 'AbortSignal': Failed to convert value to 'AbortSignal'.");
        list.push(s);
      });
      var c = new AC(), i;
      for (i = 0; i < list.length; i++) {
        if (list[i].aborted) { c.abort(list[i].reason); return c.signal; }
      }
      function onAbort() {
        for (var j = 0; j < list.length; j++) list[j].removeEventListener('abort', onAbort);
        if (!c.signal.aborted) c.abort(this.reason);
      }
      for (i = 0; i < list.length; i++) list[i].addEventListener('abort', onAbort);
      return c.signal;
    });
  });

  // ── URL.canParse / URL.parse ─────────────────────────────────────────
  feature('URL.canParse+URL.parse', function () {
    var U = G.URL;
    if (typeof U !== 'function') return;
    def(U, 'canParse', function (url) {
      if (arguments.length === 0) throw new TypeError("Failed to execute 'canParse' on 'URL': 1 argument required, but only 0 present.");
      try { new U(url, arguments[1]); return true; } catch (e) { return false; }
    });
    def(U, 'parse', function (url) {
      if (arguments.length === 0) throw new TypeError("Failed to execute 'parse' on 'URL': 1 argument required, but only 0 present.");
      try { return new U(url, arguments[1]); } catch (e) { return null; }
    }, 'parse');
  });

  // ── ReadableStream async iteration (`for await (const c of res.body)`) ──
  feature('ReadableStream async iteration', function () {
    var RS = G.ReadableStream;
    if (typeof RS !== 'function' || !SYM || !SYM.asyncIterator) return;
    if (typeof RS.prototype[SYM.asyncIterator] === 'function') return;
    function values(options) {
      var preventCancel = !!(options && options.preventCancel);
      var reader = this.getReader(), P = G.Promise, finished = false;
      var it = {
        next: function () {
          if (finished) return P.resolve({ value: undefined, done: true });
          return reader.read().then(function (r) {
            if (r.done) { finished = true; reader.releaseLock(); }
            return r;
          }, function (e) { finished = true; reader.releaseLock(); throw e; });
        },
        'return': function (value) {
          if (finished) return P.resolve({ value: value, done: true });
          finished = true;
          if (preventCancel) { reader.releaseLock(); return P.resolve({ value: value, done: true }); }
          var p = reader.cancel(value);
          reader.releaseLock();
          return p.then(function () { return { value: value, done: true }; });
        },
      };
      defProp(it, SYM.asyncIterator, { value: function () { return this; }, configurable: true, writable: true });
      return it;
    }
    def(RS.prototype, 'values', values, 'values');
    defProp(RS.prototype, SYM.asyncIterator, { value: values, writable: true, enumerable: false, configurable: true });
  });
})();
