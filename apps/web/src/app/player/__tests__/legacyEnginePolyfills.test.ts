/**
 * @jest-environment node
 *
 * The APK's legacy-engine compatibility layer
 * (`apps/player/app/src/main/assets/legacy-engine-polyfills.js`), loaded the
 * way the APK loads it: one script, before any page script, into a realm
 * whose engine lacks the builtins. Each test makes a FRESH realm (`vm`),
 * deletes the builtins it is about, runs the asset, and checks the spec
 * behaviour. Host APIs the realm does not own (AbortSignal, URL,
 * ReadableStream) are passed in and restored after.
 *
 * The other half of the contract — a modern engine is left exactly as it
 * was — is the last describe block (and the Playwright spec
 * `legacy-engine-polyfills.spec.ts` in a real browser).
 */
import * as fs from 'fs';
import * as path from 'path';
import * as vm from 'vm';
import { webcrypto } from 'crypto';
import * as ts from 'typescript';

const ASSET = path.resolve(__dirname, '../../../../../player/app/src/main/assets/legacy-engine-polyfills.js');
const SRC = fs.readFileSync(ASSET, 'utf8');

function realm(extra: Record<string, unknown> = {}, remove: string[] = []): vm.Context {
  const ctx = vm.createContext({ ...extra });
  for (const expr of remove) vm.runInContext(`delete ${expr};`, ctx);
  return ctx;
}
function load(ctx: vm.Context, src = SRC) {
  vm.runInContext(src, ctx);
}
function run<T = unknown>(ctx: vm.Context, code: string): T {
  return vm.runInContext(code, ctx) as T;
}
/** The realm's error name for a throwing expression (cross-realm safe), or 'no throw'. */
function errName(ctx: vm.Context, code: string): string {
  try { run(ctx, code); } catch (e) { return (e as Error).name; }
  return 'no throw';
}
/** The realm's own typeof for an expression, after load. */
function kind(ctx: vm.Context, expr: string): string {
  return run(ctx, `typeof (${expr})`);
}
/** Temporarily remove host-object properties (restored in finally). */
async function without(targets: Array<[object, PropertyKey]>, fn: () => unknown | Promise<unknown>) {
  const saved = targets.map(([o, k]) => [o, k, Object.getOwnPropertyDescriptor(o, k)] as const);
  try {
    for (const [o, k] of targets) delete (o as Record<PropertyKey, unknown>)[k];
    await fn();
  } finally {
    for (const [o, k, d] of saved) if (d) Object.defineProperty(o, k, d);
  }
}

/** Every ES2015+ syntax node in a script (an ES5 engine could not parse it). */
function es2015Syntax(src: string): string[] {
  const file = ts.createSourceFile('asset.js', src, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const banned = new Set([
    ts.SyntaxKind.ArrowFunction, ts.SyntaxKind.ClassDeclaration, ts.SyntaxKind.ClassExpression,
    ts.SyntaxKind.TemplateExpression, ts.SyntaxKind.NoSubstitutionTemplateLiteral, ts.SyntaxKind.SpreadElement,
    ts.SyntaxKind.ForOfStatement, ts.SyntaxKind.ShorthandPropertyAssignment, ts.SyntaxKind.MethodDeclaration,
    ts.SyntaxKind.ComputedPropertyName, ts.SyntaxKind.ObjectBindingPattern, ts.SyntaxKind.ArrayBindingPattern,
    ts.SyntaxKind.AwaitExpression, ts.SyntaxKind.YieldExpression, ts.SyntaxKind.BigIntLiteral,
  ]);
  const found: string[] = [];
  const visit = (n: ts.Node) => {
    if (banned.has(n.kind)) found.push(ts.SyntaxKind[n.kind]);
    if (ts.isVariableDeclarationList(n) && (n.flags & (ts.NodeFlags.Let | ts.NodeFlags.Const))) found.push('let/const');
    if (ts.isParameter(n) && (n.initializer || n.dotDotDotToken)) found.push('default/rest parameter');
    if (ts.isFunctionLike(n) && (n as ts.FunctionLikeDeclaration).asteriskToken) found.push('generator');
    if (ts.canHaveModifiers(n) && ts.getModifiers(n)?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword)) found.push('async');
    ts.forEachChild(n, visit);
  };
  visit(file);
  const diags = (file as unknown as { parseDiagnostics: unknown[] }).parseDiagnostics;
  if (diags.length) found.push('parse error');
  return found;
}

describe('the asset itself', () => {
  it('is pure ES5 syntax wrapped in one IIFE, and leaks no global', () => {
    expect(es2015Syntax(SRC)).toEqual([]);
    const ctx = realm({}, ['Object.hasOwn']);
    const before = new Set(run<string[]>(ctx, 'Object.getOwnPropertyNames(globalThis)'));
    load(ctx);
    const added = run<string[]>(ctx, 'Object.getOwnPropertyNames(globalThis)').filter((k) => !before.has(k));
    // Only the spec globals the layer exists to supply — no helper, no state.
    for (const k of added) expect(['Iterator', 'structuredClone']).toContain(k);
  });

  it('never throws, even when the realm is hostile (a feature that throws is skipped alone)', () => {
    const ctx = realm({}, ['Array.prototype.at', 'Object.hasOwn']);
    // A getter that throws on the Set prototype breaks only the Set feature.
    run(ctx, "Object.defineProperty(Set.prototype, 'size', { get() { throw new Error('boom'); }, configurable: true })");
    run(ctx, "delete Set.prototype.union");
    expect(() => load(ctx)).not.toThrow();
    expect(kind(ctx, 'Array.prototype.at')).toBe('function');
    expect(kind(ctx, 'Object.hasOwn')).toBe('function');
  });

  it('skips a frame whose origin the APK listed (the player origin) and leaves it untouched', () => {
    const ctx = realm({ location: { origin: 'https://player.example.test' } }, ['Array.prototype.at']);
    const src = SRC.replace(
      '/*VENUEOS_SKIP_ORIGINS*/[]/*VENUEOS_SKIP_ORIGINS_END*/',
      JSON.stringify(['https://player.example.test']),
    );
    load(ctx, src);
    expect(kind(ctx, 'Array.prototype.at')).toBe('undefined');
    const other = realm({ location: { origin: 'https://dashboard.example.test' } }, ['Array.prototype.at']);
    load(other, src);
    expect(kind(other, 'Array.prototype.at')).toBe('function');
  });

  it('defines non-enumerable, writable, configurable methods with spec names and lengths', () => {
    const ctx = realm({}, ['Array.prototype.at', 'Array.prototype.with', 'Object.hasOwn', 'Array.prototype.toSpliced']);
    load(ctx);
    const d = run<PropertyDescriptor>(ctx, "Object.getOwnPropertyDescriptor(Array.prototype, 'at')");
    expect(d.enumerable).toBe(false);
    expect(d.writable).toBe(true);
    expect(d.configurable).toBe(true);
    expect(run(ctx, 'Array.prototype.with.name')).toBe('with');
    expect(run(ctx, 'Array.prototype.with.length')).toBe(2);
    expect(run(ctx, 'Array.prototype.toSpliced.length')).toBe(2);
    expect(run(ctx, 'Object.hasOwn.length')).toBe(2);
    expect(run(ctx, 'Object.keys(Array.prototype).length')).toBe(0);
    expect(run(ctx, "for (var k in []) throw k; 'ok'")).toBe('ok');
  });
});

describe('Object', () => {
  it('Object.hasOwn', () => {
    const ctx = realm({}, ['Object.hasOwn']);
    load(ctx);
    expect(run(ctx, "Object.hasOwn({a:1}, 'a')")).toBe(true);
    expect(run(ctx, "Object.hasOwn(Object.create({a:1}), 'a')")).toBe(false);
    expect(run(ctx, "Object.hasOwn('ab', 'length')")).toBe(true);
    expect(errName(ctx, "Object.hasOwn(null, 'a')")).toBe('TypeError');
  });

  it('Object.groupBy / Map.groupBy', () => {
    const ctx = realm({}, ['Object.groupBy', 'Map.groupBy']);
    load(ctx);
    expect(run(ctx, "var g = Object.groupBy([1,2,3,4], function (x) { return x % 2 ? 'odd' : 'even'; }); JSON.stringify([Object.getPrototypeOf(g), g.odd, g.even])"))
      .toBe('[null,[1,3],[2,4]]');
    expect(run(ctx, "var m = Map.groupBy([-0, 0, 1], function (x) { return x === 1 ? 1 : x; }); [m.size, m.get(0).length, Object.is(Array.from(m.keys())[0], 0)].join()"))
      .toBe('2,2,true');
    expect(run(ctx, "Object.keys(Object.groupBy('aab', function (c) { return c; })).join()")).toBe('a,b');
    expect(errName(ctx, 'Object.groupBy([1], 5)')).toBe('TypeError');
    expect(errName(ctx, 'Object.groupBy({length: 1, 0: 1}, function () {})')).toBe('TypeError');
    // An abrupt callback closes the iterator.
    expect(run(ctx, "var closed = false; var it = { i: 0, next: function () { return { done: false, value: this.i++ }; }, return: function () { closed = true; return {}; } }; it[Symbol.iterator] = function () { return this; }; try { Object.groupBy(it, function () { throw 1; }); } catch (e) {} closed")).toBe(true);
  });
});

describe('Array, %TypedArray% and String', () => {
  const removed = [
    'Array.prototype.at', 'Array.prototype.findLast', 'Array.prototype.findLastIndex',
    'Array.prototype.toReversed', 'Array.prototype.toSorted', 'Array.prototype.toSpliced', 'Array.prototype.with',
    'String.prototype.at', 'String.prototype.isWellFormed', 'String.prototype.toWellFormed',
    'Object.getPrototypeOf(Int8Array.prototype).at', 'Object.getPrototypeOf(Int8Array.prototype).findLast',
    'Object.getPrototypeOf(Int8Array.prototype).findLastIndex', 'Object.getPrototypeOf(Int8Array.prototype).toReversed',
    'Object.getPrototypeOf(Int8Array.prototype).toSorted', 'Object.getPrototypeOf(Int8Array.prototype).with',
  ];
  let ctx: vm.Context;
  beforeEach(() => {
    ctx = realm({}, removed);
    for (const r of removed) expect(kind(ctx, r)).toBe('undefined');
    load(ctx);
  });

  it('.at', () => {
    expect(run(ctx, '[1,2,3].at(-1)')).toBe(3);
    expect(run(ctx, '[1,2,3].at(0)')).toBe(1);
    expect(run(ctx, '[1,2,3].at(3)')).toBeUndefined();
    expect(run(ctx, '[1,2,3].at(-4)')).toBeUndefined();
    expect(run(ctx, "[1,2,3].at('1.7')")).toBe(2);
    expect(run(ctx, 'Array.prototype.at.call({length: 2, 1: "x"}, -1)')).toBe('x');
    expect(run(ctx, "'abc'.at(-1)")).toBe('c');
    expect(run(ctx, "'abc'.at(5)")).toBeUndefined();
    expect(run(ctx, 'new Uint8Array([5,6]).at(-1)')).toBe(6);
    expect(errName(ctx, 'Object.getPrototypeOf(Int8Array.prototype).at.call([1], 0)')).toBe('TypeError');
    expect(run(ctx, "Array.prototype[Symbol.unscopables].at")).toBe(true);
  });

  it('.findLast / .findLastIndex', () => {
    expect(run(ctx, '[1,2,3,4].findLast(function (x) { return x % 2; })')).toBe(3);
    expect(run(ctx, '[1,2,3,4].findLastIndex(function (x) { return x % 2; })')).toBe(2);
    expect(run(ctx, '[1].findLastIndex(function () { return false; })')).toBe(-1);
    expect(run(ctx, '[1].findLast(function () { return false; })')).toBeUndefined();
    expect(run(ctx, "var seen = []; [1,2].findLast(function (v, i, a) { seen.push(i, this.t, a.length); }, {t: 't'}); seen.join()")).toBe('1,t,2,0,t,2');
    expect(run(ctx, 'new Int16Array([1,-2,3]).findLast(function (x) { return x < 0; })')).toBe(-2);
    expect(errName(ctx, '[1].findLast()')).toBe('TypeError');
  });

  it('.toReversed / .toSorted / .toSpliced / .with leave the original alone', () => {
    expect(run(ctx, 'var a = [3,1,2]; var b = a.toSorted(); [a.join(), b.join()].join("|")')).toBe('3,1,2|1,2,3');
    expect(run(ctx, '[3,1,2].toSorted(function (x, y) { return y - x; }).join()')).toBe('3,2,1');
    expect(run(ctx, '[1,,3].toSorted().length')).toBe(3);
    expect(errName(ctx, '[1].toSorted(5)')).toBe('TypeError');
    expect(run(ctx, 'var a = [1,2,3]; [a.toReversed().join(), a.join()].join("|")')).toBe('3,2,1|1,2,3');
    expect(run(ctx, '[1,,3].toReversed().hasOwnProperty(1)')).toBe(true);
    expect(run(ctx, "[1,2,3,4].toSpliced(1, 2, 'a').join()")).toBe('1,a,4');
    expect(run(ctx, '[1,2,3].toSpliced(-1).join()')).toBe('1,2');
    expect(run(ctx, '[1,2,3].toSpliced().join()')).toBe('1,2,3');
    expect(run(ctx, "[1,2,3].with(-1, 'z').join()")).toBe('1,2,z');
    expect(errName(ctx, '[1,2,3].with(3, 0)')).toBe('RangeError');
    expect(errName(ctx, '[1,2,3].with(-4, 0)')).toBe('RangeError');
    expect(run(ctx, 'Array.isArray(Array.prototype.toReversed.call({length: 1, 0: 1}))')).toBe(true);
    expect(run(ctx, 'var t = new Float32Array([3,1,2]); var s = t.toSorted(); [t.join(), s.join(), s instanceof Float32Array].join("|")')).toBe('3,1,2|1,2,3|true');
    expect(run(ctx, 'new Uint8Array([1,2]).toReversed().join()')).toBe('2,1');
    expect(run(ctx, 'new Uint8Array([1,2]).with(0, 9).join()')).toBe('9,2');
    expect(run(ctx, 'new BigInt64Array([1n]).with(0, 5n)[0] === 5n')).toBe(true);
    expect(errName(ctx, 'new BigInt64Array([1n]).with(0, 5)')).toBe('TypeError');
    expect(errName(ctx, 'new Uint8Array(1).with(1, 0)')).toBe('RangeError');
    expect(run(ctx, "['toReversed','toSorted','toSpliced'].every(function (k) { return Array.prototype[Symbol.unscopables][k] === true; })")).toBe(true);
  });

  it('String.prototype.isWellFormed / toWellFormed', () => {
    expect(run(ctx, "'ab\\uD83D\\uDE00'.isWellFormed()")).toBe(true);
    expect(run(ctx, "'ab\\uD83D'.isWellFormed()")).toBe(false);
    expect(run(ctx, "'\\uDE00x'.toWellFormed() === '\\uFFFDx'")).toBe(true);
    expect(run(ctx, "'\\uD83D\\uDE00'.toWellFormed() === '\\uD83D\\uDE00'")).toBe(true);
  });
});

describe('Promise', () => {
  it('Promise.withResolvers and Promise.try', async () => {
    const ctx = realm({}, ['Promise.withResolvers', 'Promise.try']);
    load(ctx);
    expect(run(ctx, 'Object.keys(Promise.withResolvers()).join()')).toBe('promise,resolve,reject');
    await expect(run(ctx, 'var r = Promise.withResolvers(); r.resolve(7); r.promise')).resolves.toBe(7);
    await expect(run(ctx, 'var r = Promise.withResolvers(); r.reject(8); r.promise')).rejects.toBe(8);
    await expect(run(ctx, 'Promise.try(function (a, b) { return a + b; }, 2, 3)')).resolves.toBe(5);
    await expect(run(ctx, 'Promise.try(function () { throw 9; })')).rejects.toBe(9);
    expect(run(ctx, 'var sync = false; Promise.try(function () { sync = true; }); sync')).toBe(true);
    expect(errName(ctx, 'Promise.withResolvers.call(undefined)')).toBe('TypeError');
  });
});

describe('Set methods', () => {
  const names = ['union', 'intersection', 'difference', 'symmetricDifference', 'isSubsetOf', 'isSupersetOf', 'isDisjointFrom'];
  it('match the spec on Sets and set-likes', () => {
    const ctx = realm({}, names.map((n) => `Set.prototype.${n}`));
    load(ctx);
    const j = (e: string) => run(ctx, `Array.from(${e}).join()`);
    expect(j('new Set([1,2]).union(new Set([2,3]))')).toBe('1,2,3');
    expect(j('new Set([1,2,3]).intersection(new Set([3,2,9,8]))')).toBe('2,3');
    expect(j('new Set([1,2,3,4,5]).intersection(new Set([5,1]))')).toBe('5,1');
    expect(j('new Set([1,2,3]).difference(new Set([2]))')).toBe('1,3');
    expect(j('new Set([1,2]).symmetricDifference(new Set([2,3]))')).toBe('1,3');
    expect(run(ctx, 'new Set([1]).isSubsetOf(new Set([1,2]))')).toBe(true);
    expect(run(ctx, 'new Set([1,3]).isSubsetOf(new Set([1,2]))')).toBe(false);
    expect(run(ctx, 'new Set([1,2]).isSupersetOf(new Set([1]))')).toBe(true);
    expect(run(ctx, 'new Set([1]).isDisjointFrom(new Set([2]))')).toBe(true);
    expect(run(ctx, 'new Set([1]).isDisjointFrom(new Set([1]))')).toBe(false);
    // Set-like: a Map is accepted (size/has/keys).
    expect(j("new Set(['a']).union(new Map([['b', 1]]))")).toBe('a,b');
    expect(errName(ctx, 'new Set().union([1])')).toBe('TypeError');
    expect(errName(ctx, 'new Set().union({ size: -1, has: function () {}, keys: function () {} })')).toBe('RangeError');
    expect(errName(ctx, 'Set.prototype.union.call({}, new Set())')).toBe('TypeError');
  });
});

describe('Array.fromAsync', () => {
  it('handles async iterables, sync iterables of promises, array-likes and a mapper', async () => {
    const ctx = realm({}, ['Array.fromAsync']);
    load(ctx);
    const flat = (code: string) => (run<Promise<unknown[]>>(ctx, code)).then((a) => Array.from(a));
    await expect(flat('Array.fromAsync([Promise.resolve(1), 2])')).resolves.toEqual([1, 2]);
    await expect(flat('Array.fromAsync((async function* () { yield 1; yield 2; })())')).resolves.toEqual([1, 2]);
    await expect(flat('Array.fromAsync({ length: 2, 0: "a", 1: Promise.resolve("b") })')).resolves.toEqual(['a', 'b']);
    await expect(flat('Array.fromAsync([1, 2], function (x, i) { return Promise.resolve(x * 10 + i); })')).resolves.toEqual([10, 21]);
    await expect(run(ctx, 'Array.fromAsync(null)')).rejects.toBeInstanceOf(run(ctx, 'TypeError'));
    await expect(run(ctx, 'Array.fromAsync([], 5)')).rejects.toBeInstanceOf(run(ctx, 'TypeError'));
    expect(await run(ctx, `(function () {
      var closed = false;
      var it = { next: function () { return { done: false, value: 1 }; }, return: function () { closed = true; return {}; } };
      it[Symbol.iterator] = function () { return it; };
      return Array.fromAsync(it, function () { throw 1; }).then(null, function (e) { return [e, closed].join(); });
    })()`)).toBe('1,true');
  });
});

describe('Iterator helpers and the Iterator global', () => {
  let ctx: vm.Context;
  const methods = ['map', 'filter', 'take', 'drop', 'flatMap', 'reduce', 'toArray', 'forEach', 'some', 'every', 'find'];
  beforeEach(() => {
    const IP = 'Object.getPrototypeOf(Object.getPrototypeOf([][Symbol.iterator]()))';
    ctx = realm({}, [...methods.map((m) => `${IP}.${m}`), 'globalThis.Iterator', `${IP}.constructor`]);
    expect(kind(ctx, '[].values().map')).toBe('undefined');
    load(ctx);
  });

  it('are lazy, counted, and close the source', () => {
    expect(run(ctx, '[1,2,3].values().map(function (x, i) { return x * 10 + i; }).toArray().join()')).toBe('10,21,32');
    expect(run(ctx, '[1,2,3,4].values().filter(function (x) { return x % 2; }).toArray().join()')).toBe('1,3');
    expect(run(ctx, '[1,2,3].values().take(2).toArray().join()')).toBe('1,2');
    expect(run(ctx, '[1,2,3].values().drop(1).toArray().join()')).toBe('2,3');
    expect(run(ctx, '[1,2].values().flatMap(function (x) { return [x, x]; }).toArray().join()')).toBe('1,1,2,2');
    expect(errName(ctx, '[1].values().flatMap(function () { return 1; }).toArray()')).toBe('TypeError');
    expect(run(ctx, '[1,2,3].values().reduce(function (a, b) { return a + b; })')).toBe(6);
    expect(run(ctx, '[1,2,3].values().reduce(function (a, b) { return a + b; }, 10)')).toBe(16);
    expect(errName(ctx, '[].values().reduce(function () {})')).toBe('TypeError');
    expect(run(ctx, '[1,2].values().some(function (x) { return x > 1; })')).toBe(true);
    expect(run(ctx, '[1,2].values().every(function (x) { return x > 1; })')).toBe(false);
    expect(run(ctx, '[1,2,3].values().find(function (x) { return x > 1; })')).toBe(2);
    expect(run(ctx, 'var s = 0; [1,2].values().forEach(function (x) { s += x; }); s')).toBe(3);
    expect(run(ctx, 'var n = 0; var m = [1,2,3].values().map(function (x) { n++; return x; }); m.next(); n')).toBe(1);
    expect(run(ctx, 'new Map([[1,2]]).keys().map(function (k) { return k + 1; }).next().value')).toBe(2);
    expect(run(ctx, `var closed = 0; var src = { next: function () { return { value: 1, done: false }; }, return: function () { closed++; return {}; } };
      Object.setPrototypeOf(src, Iterator.prototype);
      src.take(1).toArray(); src.find(function () { return true; }); var h = src.map(function (x) { return x; }); h.next(); h.return(); closed`)).toBe(3);
    expect(errName(ctx, '[].values().take(-1)')).toBe('RangeError');
    expect(errName(ctx, '[].values().take(NaN)')).toBe('RangeError');
    expect(errName(ctx, '[].values().map(5)')).toBe('TypeError');
  });

  it('defines Iterator, Iterator.prototype and Iterator.from', () => {
    expect(kind(ctx, 'Iterator')).toBe('function');
    expect(run(ctx, 'Iterator.prototype === Object.getPrototypeOf(Object.getPrototypeOf([][Symbol.iterator]()))')).toBe(true);
    expect(run(ctx, '[].values() instanceof Iterator')).toBe(true);
    expect(errName(ctx, 'new Iterator()')).toBe('TypeError');
    expect(run(ctx, 'var i = 0; Iterator.from({ next: function () { return { value: i, done: i++ > 1 }; } }).toArray().join()')).toBe('0,1');
    expect(run(ctx, "Iterator.from('ab').toArray().join()")).toBe('a,b');
    expect(run(ctx, 'var it = [1].values(); Iterator.from(it) === it')).toBe(true);
    expect(run(ctx, "Object.prototype.toString.call([].values().map(function () {}))")).toBe('[object Iterator Helper]');
  });
});

describe('structuredClone', () => {
  it('deep-clones the serializable types, keeps cycles, refuses the rest with DataCloneError', () => {
    const ctx = realm({ DOMException });
    expect(kind(ctx, 'structuredClone')).toBe('undefined'); // a bare realm has none, like Chrome < 98
    load(ctx);
    expect(run(ctx, `var src = { a: [1, { b: 2 }], d: new Date(5), r: /x/gi, m: new Map([[1, { z: 1 }]]), s: new Set([1]), n: null, u: undefined, big: 10n };
      src.self = src;
      var c = structuredClone(src);
      [c !== src, c.a[1].b, c.a[1] !== src.a[1], c.d.getTime(), c.d !== src.d, c.r.flags, c.m.get(1).z, c.m.get(1) !== src.m.get(1),
       c.s.has(1), c.self === c, 'u' in c, c.big === 10n].join()`)).toBe('true,2,true,5,true,gi,1,true,true,true,true,true');
    expect(run(ctx, `var buf = new Uint8Array([1,2,3]); var c = structuredClone({ a: buf, b: buf.subarray(1) });
      [c.a !== buf, c.a.join(), c.b.join(), c.a.buffer === c.b.buffer, c.a instanceof Uint8Array].join()`)).toBe('true,1,2,3,2,3,true,true');
    expect(run(ctx, "var e = structuredClone(new RangeError('bad')); [e instanceof RangeError, e.message].join()")).toBe('true,bad');
    expect(run(ctx, 'class K { constructor() { this.x = 1; } } var c = structuredClone(new K()); [Object.getPrototypeOf(c) === Object.prototype, c.x].join()')).toBe('true,1');
    expect(run(ctx, "structuredClone(Object(5)) instanceof Number && structuredClone(Object('s')).valueOf() === 's'")).toBe(true);
    for (const bad of ['function () {}', 'Symbol()', 'new WeakMap()', 'Promise.resolve()', '{ f: function () {} }']) {
      let err: unknown;
      try { run(ctx, `structuredClone(${bad})`); } catch (e) { err = e; }
      expect((err as DOMException).name).toBe('DataCloneError');
    }
    expect(errName(ctx, 'structuredClone()')).toBe('TypeError');
  });
});

describe('crypto.randomUUID', () => {
  it('returns RFC 4122 v4 UUIDs, and stays absent outside a secure context', () => {
    const crypto = { getRandomValues: (a: Uint8Array) => webcrypto.getRandomValues(a) };
    const ctx = realm({ crypto });
    load(ctx);
    const ids = new Set<string>();
    for (let i = 0; i < 50; i++) {
      const id = run<string>(ctx, 'crypto.randomUUID()');
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      ids.add(id);
    }
    expect(ids.size).toBe(50);
    expect(run(ctx, "Object.keys(crypto).indexOf('randomUUID')")).toBe(-1);
    const insecure = realm({ crypto: { getRandomValues: crypto.getRandomValues }, isSecureContext: false });
    load(insecure);
    expect(kind(insecure, 'crypto.randomUUID')).toBe('undefined');
  });
});

describe('AbortSignal', () => {
  it('timeout, any, abort, throwIfAborted and reason', async () => {
    const AS = AbortSignal as unknown as Record<string, unknown>;
    await without([[AS, 'timeout'], [AS, 'any'], [AS, 'abort'], [AbortSignal.prototype, 'throwIfAborted'], [AbortSignal.prototype, 'reason']], async () => {
      const ctx = realm({ AbortSignal, AbortController, DOMException, setTimeout });
      expect(kind(ctx, 'AbortSignal.timeout')).toBe('undefined');
      load(ctx);
      const t = run<AbortSignal>(ctx, 'AbortSignal.timeout(5)');
      expect(t.aborted).toBe(false);
      await new Promise((r) => setTimeout(r, 30));
      expect(t.aborted).toBe(true);
      expect((t.reason as DOMException).name).toBe('TimeoutError');
      expect(errName(ctx, 'AbortSignal.timeout(-1)')).toBe('TypeError');

      expect(run(ctx, "var a = AbortSignal.abort('why'); [a.aborted, a.reason].join()")).toBe('true,why');
      expect(run(ctx, 'AbortSignal.abort().reason.name')).toBe('AbortError');
      expect(run(ctx, "try { AbortSignal.abort('r').throwIfAborted(); 'no' } catch (e) { e }")).toBe('r');
      expect(run(ctx, 'new AbortController().signal.throwIfAborted()')).toBeUndefined();

      expect(run(ctx, `var c1 = new AbortController(), c2 = new AbortController();
        var any = AbortSignal.any([c1.signal, c2.signal]); var before = any.aborted; c2.abort('second');
        [before, any.aborted, any.reason].join()`)).toBe('false,true,second');
      expect(run(ctx, "AbortSignal.any([AbortSignal.abort('pre')]).reason")).toBe('pre');
      expect(errName(ctx, 'AbortSignal.any([1])')).toBe('TypeError');
    });
  });
});

describe('URL.canParse / URL.parse', () => {
  it('match the WHATWG statics', async () => {
    const U = URL as unknown as Record<string, unknown>;
    await without([[U, 'canParse'], [U, 'parse']], () => {
      const ctx = realm({ URL });
      load(ctx);
      expect(run(ctx, "URL.canParse('https://a.test/x')")).toBe(true);
      expect(run(ctx, "URL.canParse('/x')")).toBe(false);
      expect(run(ctx, "URL.canParse('/x', 'https://a.test')")).toBe(true);
      expect(run(ctx, "URL.parse('/x', 'https://a.test').href")).toBe('https://a.test/x');
      expect(run(ctx, "URL.parse('nope')")).toBeNull();
      expect(errName(ctx, 'URL.canParse()')).toBe('TypeError');
    });
  });
});

describe('ReadableStream async iteration', () => {
  it('for await over a stream, and return() cancels unless preventCancel', async () => {
    const RSP = ReadableStream.prototype as unknown as Record<PropertyKey, unknown>;
    await without([[RSP, Symbol.asyncIterator], [RSP, 'values']], async () => {
      const ctx = realm({ ReadableStream });
      expect(kind(ctx, 'ReadableStream.prototype[Symbol.asyncIterator]')).toBe('undefined');
      load(ctx);
      const out = await run<Promise<string>>(ctx, `(async function () {
        var s = new ReadableStream({ start: function (c) { c.enqueue('a'); c.enqueue('b'); c.close(); } });
        var got = []; for await (var chunk of s) got.push(chunk); return got.join() + '|' + s.locked;
      })()`);
      expect(out).toBe('a,b|false');
      const cancelled = await run<Promise<string>>(ctx, `(async function () {
        var why = null;
        var s = new ReadableStream({ pull: function (c) { c.enqueue(1); }, cancel: function (r) { why = r; } });
        for await (var x of s) break;
        var s2 = new ReadableStream({ pull: function (c) { c.enqueue(1); }, cancel: function () { why = 'wrong'; } });
        var it = s2.values({ preventCancel: true }); await it.next(); await it.return();
        return [why === undefined, s.locked, s2.locked].join();
      })()`);
      expect(cancelled).toBe('true,false,false');
    });
  });
});

describe('a modern engine is left exactly as it was', () => {
  /** Every own property (descriptor values by identity) on every object the layer can touch. */
  function snapshot(ctx: vm.Context): Map<string, unknown> {
    const targets: Record<string, unknown> = run(ctx, `({
      global: globalThis, Object: Object, ObjectProto: Object.prototype, Array: Array, ArrayProto: Array.prototype,
      unscopables: Array.prototype[Symbol.unscopables], String: String.prototype, TA: Object.getPrototypeOf(Int8Array.prototype),
      Promise: Promise, Map: Map, Set: Set.prototype, Iter: Object.getPrototypeOf(Object.getPrototypeOf([][Symbol.iterator]())),
      URL: globalThis.URL, AS: globalThis.AbortSignal, ASP: globalThis.AbortSignal && AbortSignal.prototype,
      ACP: globalThis.AbortController && AbortController.prototype, RSP: globalThis.ReadableStream && ReadableStream.prototype,
      crypto: globalThis.crypto,
    })`);
    const out = new Map<string, unknown>();
    for (const [name, obj] of Object.entries(targets)) {
      if (!obj) continue;
      for (const key of Reflect.ownKeys(obj as object)) {
        const d = Object.getOwnPropertyDescriptor(obj, key)!;
        out.set(`${name}.${String(key)}`, [d.value, d.get, d.set, d.enumerable, d.writable, d.configurable]);
      }
    }
    return out;
  }
  /** Keys whose descriptor differs by identity (never deep-compared). */
  function changed(before: Map<string, unknown>, after: Map<string, unknown>): string[] {
    const out: string[] = [];
    for (const [k, v] of before) {
      const a = after.get(k) as unknown[] | undefined;
      if (!a || (v as unknown[]).some((x, i) => !Object.is(x, a[i]))) out.push(k);
    }
    return out;
  }
  const PROVIDED = new Set([
    'hasOwn', 'groupBy', 'at', 'findLast', 'findLastIndex', 'toReversed', 'toSorted', 'toSpliced', 'with',
    'isWellFormed', 'toWellFormed', 'withResolvers', 'try', 'union', 'intersection', 'difference',
    'symmetricDifference', 'isSubsetOf', 'isSupersetOf', 'isDisjointFrom', 'fromAsync', 'map', 'filter', 'take',
    'drop', 'flatMap', 'reduce', 'toArray', 'forEach', 'some', 'every', 'find', 'constructor', 'Iterator',
    'structuredClone', 'randomUUID', 'reason', 'throwIfAborted', 'abort', 'timeout', 'any', 'canParse', 'parse',
    'values', 'Symbol(Symbol.asyncIterator)',
  ]);
  const hostGlobals = () => ({ URL, AbortSignal, AbortController, DOMException, ReadableStream, setTimeout, crypto: webcrypto });

  it('never replaces or reshapes a builtin that already exists (this Node is the engine)', () => {
    const ctx = realm(hostGlobals());
    const before = snapshot(ctx);
    load(ctx);
    const after = snapshot(ctx);
    expect(changed(before, after)).toEqual([]);
    // Anything new is a name the layer provides that this Node genuinely lacks.
    const added = [...after.keys()].filter((k) => !before.has(k));
    for (const k of added) expect([k, PROVIDED.has(k.slice(k.indexOf('.') + 1))]).toEqual([k, true]);
  });

  it('on an engine that has everything, a load changes nothing at all', () => {
    const ctx = realm(hostGlobals());
    load(ctx); // fill whatever this Node lacks, so the realm is "fully modern"
    const before = snapshot(ctx);
    load(ctx);
    const after = snapshot(ctx);
    expect([...after.keys()].sort()).toEqual([...before.keys()].sort());
    expect(changed(before, after)).toEqual([]);
  });
});
