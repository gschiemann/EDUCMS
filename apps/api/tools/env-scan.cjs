/**
 * env-scan.cjs — finds every environment-variable read in apps/api/src.
 *
 * Shared by `check-env-declared.cjs` (the CI gate) and `generate-env-docs.cjs`
 * (the docs / .env.example generator). It is a LIBRARY: it prints nothing and
 * exits nothing.
 *
 * WHY AN AST AND NOT A GREP. The 2026-10 configuration audits counted 168
 * names with `grep "process\.env\.[A-Z0-9_]+"`. That number is a floor, not the
 * answer: most of the newer code reads the environment through an injectable
 * alias —
 *
 *     export function aiPlanLimits(env: NodeJS.ProcessEnv = process.env) {
 *       return { boards: envInt(env, 'AI_BOARDS_PER_SCREEN', 10) };
 *     }
 *
 * — so the variable never appears next to the words `process.env`. A grep also
 * cannot see `process.env['X']`, a name held in a `const`, or a name handed to
 * a helper as an argument. This scanner resolves all of those. What it CANNOT
 * resolve (a name assembled at run time) it reports as a DYNAMIC site, and the
 * schema must register that site explicitly (`DYNAMIC_ENV_READS` in
 * src/config/env-schema.ts) — a new dynamic read can never slip in unseen.
 *
 * What counts as a read of variable NAME (every one is reported with file:line):
 *   direct     process.env.NAME            process.env['NAME']
 *   alias      env.NAME  env['NAME']       where `env` is a parameter / variable
 *                                          typed NodeJS.ProcessEnv (or
 *                                          Record<string, string | undefined>)
 *                                          or initialised from process.env
 *   const      process.env[CONST]          CONST = 'NAME' in scope (or an
 *                                          imported const with one project-wide value)
 *   helper     intEnv('NAME', 5)           where the helper does env[param]
 *   array      for/filter/map over a const array of names that does env[k]
 *   destruct   const { NAME } = process.env
 *
 * Constant resolution is LEXICAL: a parameter called `name` is a parameter, not
 * whichever module-level `const name` some other file happens to declare.
 *
 * Writes (`process.env.NAME = …`, `delete process.env.NAME`) are reported with
 * kind 'write'. Writes into a local env-shaped object (a child-process env being
 * built) are not process.env accesses and are dropped.
 *
 * Spec files are excluded: they SET variables to exercise code; the reader is
 * the thing being declared.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const API_ROOT = path.join(__dirname, '..');
const REPO_ROOT = path.join(API_ROOT, '..', '..');
const SRC_ROOT = path.join(API_ROOT, 'src');

/** @returns {import('typescript')} resolved from apps/api so the tool needs no root install. */
function loadTypeScript() {
  try {
    return require(require.resolve('typescript', { paths: [API_ROOT, REPO_ROOT] }));
  } catch (e) {
    throw new Error(
      'env-scan: cannot load `typescript` (run `pnpm install` first). ' + (e && e.message ? e.message : e),
    );
  }
}

const NAME_RE = /^[A-Z][A-Z0-9_]*$/;
const ENV_TYPE_RE = /\bProcessEnv\b|Record<\s*string\s*,\s*string\s*\|\s*undefined\s*>/;

function toPosix(p) {
  return p.split(path.sep).join('/');
}

function collectSourceFiles(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      collectSourceFiles(full, out);
    } else if (
      entry.isFile() &&
      /\.(ts|tsx|js|cjs|mjs)$/.test(entry.name) &&
      !/\.d\.ts$/.test(entry.name) &&
      !/\.(spec|test|e2e-spec)\.[a-z]+$/.test(entry.name)
    ) {
      out.push(full);
    }
  }
  return out;
}

/**
 * @typedef {{ name: string, file: string, line: number, kind: 'read'|'write', via: string }} EnvSite
 * @typedef {{ file: string, line: number, expr: string, why: string }} DynamicSite
 */

/**
 * @param {{ srcRoot?: string }} [opts]
 * @returns {{ files: number, sites: EnvSite[], dynamic: DynamicSite[], passthrough: {file:string,line:number,expr:string,kind:string}[] }}
 */
function scanEnvReads(opts = {}) {
  const ts = loadTypeScript();
  const srcRoot = opts.srcRoot || SRC_ROOT;
  const repoRel = (f) => toPosix(path.relative(REPO_ROOT, f));

  const files = collectSourceFiles(srcRoot, []).sort();
  const parsed = files.map((file) => {
    const text = fs.readFileSync(file, 'utf8');
    const kind = /\.tsx$/.test(file) ? ts.ScriptKind.TSX : /\.(js|cjs|mjs)$/.test(file) ? ts.ScriptKind.JS : ts.ScriptKind.TS;
    return { file, sf: ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind) };
  });

  const lineOf = (sf, node) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
  const textOf = (sf, node) => node.getText(sf);

  const unwrap = (n) => {
    while (
      n &&
      (ts.isAsExpression(n) || ts.isParenthesizedExpression(n) || ts.isTypeAssertionExpression(n) || ts.isSatisfiesExpression(n) || ts.isNonNullExpression(n))
    ) {
      n = n.expression;
    }
    return n;
  };
  const stringLit = (n) => {
    n = unwrap(n);
    return n && (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) ? n.text : null;
  };
  const stringArray = (n) => {
    n = unwrap(n);
    if (!n || !ts.isArrayLiteralExpression(n)) return null;
    const lits = n.elements.map(stringLit);
    return lits.length && lits.every((l) => l !== null) ? lits : null;
  };
  const isFunctionLike = (n) => ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n) || ts.isArrowFunction(n) || ts.isMethodDeclaration(n);

  // ── pass 0: imports, and project-wide exported string constants / arrays ────────
  /** file -> Set of locally imported identifiers */
  const importsByFile = new Map();
  /** constName -> Set(literal) over every module-level const in the project */
  const constsGlobal = new Map();
  /** arrayName -> Set(JSON of string[]) over every module-level const in the project */
  const arraysGlobal = new Map();

  for (const { file, sf } of parsed) {
    const imports = new Set();
    importsByFile.set(file, imports);
    for (const st of sf.statements) {
      if (ts.isImportDeclaration(st) && st.importClause) {
        if (st.importClause.name) imports.add(st.importClause.name.text);
        const nb = st.importClause.namedBindings;
        if (nb && ts.isNamedImports(nb)) nb.elements.forEach((e) => imports.add(e.name.text));
      }
      if (ts.isVariableStatement(st)) {
        for (const d of st.declarationList.declarations) {
          if (!ts.isIdentifier(d.name) || !d.initializer) continue;
          const lit = stringLit(d.initializer);
          if (lit !== null) {
            if (!constsGlobal.has(d.name.text)) constsGlobal.set(d.name.text, new Set());
            constsGlobal.get(d.name.text).add(lit);
            continue;
          }
          const arr = stringArray(d.initializer);
          if (arr) {
            if (!arraysGlobal.has(d.name.text)) arraysGlobal.set(d.name.text, new Set());
            arraysGlobal.get(d.name.text).add(JSON.stringify(arr));
          }
        }
      }
    }
  }
  const globalLiteral = (id) => {
    const g = constsGlobal.get(id);
    return g && g.size === 1 ? [...g][0] : null;
  };
  const globalArray = (id) => {
    const g = arraysGlobal.get(id);
    return g && g.size === 1 ? JSON.parse([...g][0]) : null;
  };

  /**
   * Lexical binding of an identifier node.
   * @returns {{kind:'literal',value:string}|{kind:'array',value:string[]}|{kind:'param',fn:any,index:number}
   *   |{kind:'loop'}|{kind:'import'}|{kind:'other'}|null}
   */
  function bindingOf(file, ident) {
    const name = ident.text;
    for (let n = ident.parent; n; n = n.parent) {
      if (isFunctionLike(n)) {
        const index = n.parameters.findIndex((p) => ts.isIdentifier(p.name) && p.name.text === name);
        if (index >= 0) return { kind: 'param', fn: n, index };
      }
      if (ts.isBlock(n) || ts.isSourceFile(n) || ts.isModuleBlock(n) || ts.isCaseClause(n) || ts.isDefaultClause(n)) {
        for (const st of n.statements) {
          if (ts.isVariableStatement(st)) {
            for (const d of st.declarationList.declarations) {
              if (ts.isIdentifier(d.name) && d.name.text === name) {
                const lit = d.initializer ? stringLit(d.initializer) : null;
                if (lit !== null) return { kind: 'literal', value: lit };
                const arr = d.initializer ? stringArray(d.initializer) : null;
                if (arr) return { kind: 'array', value: arr };
                return { kind: 'other' };
              }
            }
          } else if ((ts.isFunctionDeclaration(st) || ts.isClassDeclaration(st)) && st.name && st.name.text === name) {
            return { kind: 'other' };
          }
        }
      }
      if ((ts.isForOfStatement(n) || ts.isForInStatement(n) || ts.isForStatement(n)) && n.initializer && ts.isVariableDeclarationList(n.initializer)) {
        if (n.initializer.declarations.some((d) => ts.isIdentifier(d.name) && d.name.text === name)) return { kind: 'loop' };
      }
      if (ts.isCatchClause(n) && n.variableDeclaration && ts.isIdentifier(n.variableDeclaration.name) && n.variableDeclaration.name.text === name) {
        return { kind: 'other' };
      }
    }
    if (importsByFile.get(file).has(name)) return { kind: 'import' };
    return null;
  }

  // ── pass 1: env aliases per file ────────────────────────────────────────────────
  const isProcessEnv = (n) => {
    n = unwrap(n);
    return !!n && ts.isPropertyAccessExpression(n) && n.name.text === 'env' && ts.isIdentifier(n.expression) && n.expression.text === 'process';
  };

  /** file -> Set of identifier names that denote "the environment" ('.name' = an `opts.name` property) */
  const aliasesByFile = new Map();
  /** names of functions in apps/api/src that take the environment as a parameter (their bodies are scanned) */
  const envFunctions = new Set();
  for (const { file, sf } of parsed) {
    const aliases = new Set();
    const visit = (node) => {
      if ((ts.isParameter(node) || ts.isVariableDeclaration(node)) && ts.isIdentifier(node.name)) {
        const typeText = node.type ? node.type.getText(sf) : '';
        const init = node.initializer ? unwrap(node.initializer) : null;
        if ((typeText && ENV_TYPE_RE.test(typeText)) || (init && isProcessEnv(init))) {
          aliases.add(node.name.text);
          if (ts.isParameter(node) && isFunctionLike(node.parent)) {
            const fnName = node.parent.name && ts.isIdentifier(node.parent.name) ? node.parent.name.text
              : node.parent.parent && ts.isVariableDeclaration(node.parent.parent) && ts.isIdentifier(node.parent.parent.name) ? node.parent.parent.name.text : null;
            if (fnName) envFunctions.add(fnName);
          }
        }
      }
      if (ts.isBindingElement(node) && ts.isIdentifier(node.name) && node.initializer && isProcessEnv(node.initializer)) {
        aliases.add(node.name.text);
      }
      // `env?: NodeJS.ProcessEnv` in an options type: readers do `opts.env?.NAME`
      if (ts.isPropertySignature(node) && node.type && ENV_TYPE_RE.test(node.type.getText(sf)) && ts.isIdentifier(node.name)) {
        aliases.add('.' + node.name.text);
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
    aliasesByFile.set(file, aliases);
  }

  const isDirect = (expr) => isProcessEnv(unwrap(expr));
  /** Is `expr` the environment (process.env, an alias, or an `opts.env` property)? */
  const isEnvExpr = (file, expr) => {
    expr = unwrap(expr);
    if (!expr) return false;
    if (isProcessEnv(expr)) return true;
    const aliases = aliasesByFile.get(file);
    if (ts.isIdentifier(expr)) return aliases.has(expr.text);
    if (ts.isPropertyAccessExpression(expr)) return aliases.has('.' + expr.name.text);
    return false;
  };

  // ── pass 2: helper functions that do env[<their own parameter>] ────────────────
  /** @type {{name:string,file:string,paramIndex:number,template?:{head:string,tail:string}}[]} */
  const helpers = [];
  /** `file:line` of element accesses attributed to a helper (resolved at its call sites instead) */
  const helperSites = new Set();

  const enclosingFunction = (node) => {
    for (let n = node.parent; n; n = n.parent) if (isFunctionLike(n)) return n;
    return null;
  };
  const functionName = (fn) => {
    if (fn.name && ts.isIdentifier(fn.name)) return fn.name.text;
    const p = fn.parent;
    if (p && ts.isVariableDeclaration(p) && ts.isIdentifier(p.name)) return p.name.text;
    if (p && ts.isPropertyAssignment(p) && ts.isIdentifier(p.name)) return p.name.text;
    return null;
  };

  for (const { file, sf } of parsed) {
    const visit = (node) => {
      if (ts.isElementAccessExpression(node) && isEnvExpr(file, node.expression)) {
        const arg = unwrap(node.argumentExpression);
        if (arg && ts.isIdentifier(arg)) {
          const b = bindingOf(file, arg);
          const nm = b && b.kind === 'param' ? functionName(b.fn) : null;
          if (b && b.kind === 'param' && nm) {
            helpers.push({ name: nm, file, paramIndex: b.index });
            helperSites.add(file + ':' + lineOf(sf, node));
          }
        }
        // template literal keyed by a parameter: process.env[`${prefix}_CLIENT_ID`]
        if (arg && ts.isTemplateExpression(arg) && arg.templateSpans.length === 1) {
          const inner = unwrap(arg.templateSpans[0].expression);
          if (inner && ts.isIdentifier(inner)) {
            const b = bindingOf(file, inner);
            const nm = b && b.kind === 'param' ? functionName(b.fn) : null;
            if (b && b.kind === 'param' && nm) {
              helpers.push({ name: nm, file, paramIndex: b.index, template: { head: arg.head.text, tail: arg.templateSpans[0].literal.text } });
              helperSites.add(file + ':' + lineOf(sf, node));
            }
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }

  // ── pass 3: collect sites ───────────────────────────────────────────────────────
  /** @type {EnvSite[]} */
  const sites = [];
  /** @type {DynamicSite[]} */
  const dynamic = [];
  /** @type {{file:string,line:number,expr:string,kind:string}[]} */
  const passthrough = [];

  const isAssignTarget = (node) => {
    const p = node.parent;
    if (p && ts.isBinaryExpression(p) && p.left === node) {
      const k = p.operatorToken.kind;
      return k >= ts.SyntaxKind.FirstAssignment && k <= ts.SyntaxKind.LastAssignment;
    }
    return !!(p && ts.isDeleteExpression(p));
  };

  const add = (file, sf, node, name, via) => {
    if (!NAME_RE.test(name)) return;
    const write = isAssignTarget(node);
    // A write through an alias builds a local child env; it is not a process.env access.
    if (write && via !== 'direct') return;
    sites.push({ name, file: repoRel(file), line: lineOf(sf, node), kind: write ? 'write' : 'read', via });
  };
  // A write or delete with a computed key (`delete env[key]` while scrubbing secrets from a child
  // environment) names no particular variable the code depends on: not a read, not reported.
  const addDynamic = (file, sf, node, why) => {
    if (isAssignTarget(node)) return;
    dynamic.push({ file: repoRel(file), line: lineOf(sf, node), expr: textOf(sf, node), why });
  };

  /** Names held by the array a loop / callback variable iterates. */
  function namesIterated(file, ident) {
    const arrayOf = (expr) => {
      expr = unwrap(expr);
      if (!expr) return null;
      if (ts.isArrayLiteralExpression(expr)) {
        // an inline list: for (const name of ['DATABASE_URL', 'DIRECT_URL'])
        const out = [];
        for (const el of expr.elements) {
          const lit = stringLit(el);
          if (lit !== null) out.push(lit);
          else if (ts.isIdentifier(unwrap(el))) {
            const b = bindingOf(file, unwrap(el));
            if (b && b.kind === 'literal') out.push(b.value);
            else if (b && b.kind === 'import' && globalLiteral(unwrap(el).text) !== null) out.push(globalLiteral(unwrap(el).text));
            else return null;
          } else return null;
        }
        return out.length ? out : null;
      }
      if (!ts.isIdentifier(expr)) return null;
      const b = bindingOf(file, expr);
      if (b && b.kind === 'array') return b.value;
      if (b && b.kind === 'import') return globalArray(expr.text);
      return null;
    };
    for (let n = ident.parent; n; n = n.parent) {
      if (ts.isForOfStatement(n) && ts.isVariableDeclarationList(n.initializer)) {
        const d = n.initializer.declarations[0];
        if (ts.isIdentifier(d.name) && d.name.text === ident.text) return arrayOf(n.expression);
      }
      if ((ts.isArrowFunction(n) || ts.isFunctionExpression(n)) && n.parameters.some((p) => ts.isIdentifier(p.name) && p.name.text === ident.text)) {
        const call = n.parent;
        if (call && ts.isCallExpression(call) && ts.isPropertyAccessExpression(call.expression)) return arrayOf(call.expression.expression);
        return null;
      }
    }
    return null;
  }

  /** The names a helper call's argument can take: a literal, a constant, or a loop variable over constants. */
  function argNames(file, a) {
    a = unwrap(a);
    if (!a) return [];
    const lit = stringLit(a);
    if (lit !== null) return [lit];
    if (!ts.isIdentifier(a)) return [];
    const b = bindingOf(file, a);
    if (b && b.kind === 'literal') return [b.value];
    if (b && b.kind === 'import' && globalLiteral(a.text) !== null) return [globalLiteral(a.text)];
    return namesIterated(file, a) || [];
  }

  for (const { file, sf } of parsed) {
    const visit = (node) => {
      // NAME via property access
      if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.name) && NAME_RE.test(node.name.text) && isEnvExpr(file, node.expression)) {
        add(file, sf, node, node.name.text, isDirect(node.expression) ? 'direct' : 'alias');
      }

      if (ts.isElementAccessExpression(node) && isEnvExpr(file, node.expression)) {
        const arg = unwrap(node.argumentExpression);
        const lit = arg ? stringLit(arg) : null;
        if (lit !== null) {
          add(file, sf, node, lit, isDirect(node.expression) ? 'direct' : 'alias');
        } else if (arg && ts.isIdentifier(arg)) {
          const b = bindingOf(file, arg);
          if (b && b.kind === 'literal') add(file, sf, node, b.value, 'const');
          else if (b && b.kind === 'import' && globalLiteral(arg.text) !== null) add(file, sf, node, globalLiteral(arg.text), 'const');
          else if (helperSites.has(file + ':' + lineOf(sf, node))) {
            /* attributed through the helper's call sites */
          } else {
            const names = namesIterated(file, arg);
            if (names) names.forEach((n) => add(file, sf, node, n, 'array'));
            else addDynamic(file, sf, node, 'name is a variable that is not a known constant');
          }
        } else if (arg && ts.isTemplateExpression(arg)) {
          if (!helperSites.has(file + ':' + lineOf(sf, node))) addDynamic(file, sf, node, 'name is built from a template literal');
        } else if (arg) {
          addDynamic(file, sf, node, 'name is a computed expression');
        }
      }

      // process.env handed over WHOLE to a function: the callee reads the variables. When the callee is a
      // function of apps/api/src that takes the environment, its body is scanned above and nothing more is
      // needed; when it comes from elsewhere (`playbackGateMode(process.env)` lives in @cms/api-types) the
      // read is invisible here, so the site must be registered. A plain spread (`{ ...process.env }`)
      // inherits everything and names nothing - it is not a read of any particular variable.
      if (isProcessEnv(node)) {
        const p = node.parent;
        if (p && (ts.isCallExpression(p) || ts.isNewExpression(p)) && p.arguments && p.arguments.includes(node)) {
          const callee = unwrap(p.expression);
          const calleeName = ts.isIdentifier(callee) ? callee.text : ts.isPropertyAccessExpression(callee) ? callee.name.text : null;
          if (!calleeName || !envFunctions.has(calleeName)) {
            passthrough.push({
              file: repoRel(file),
              line: lineOf(sf, node),
              expr: textOf(sf, p.expression) + '(' + p.arguments.map((a) => (a === node ? 'process.env' : '\u2026')).join(', ') + ')',
              kind: 'call',
            });
          }
        }
      }

      // const { A, B } = process.env   /   const { A } = env
      if (ts.isVariableDeclaration(node) && ts.isObjectBindingPattern(node.name) && node.initializer && isEnvExpr(file, node.initializer)) {
        for (const el of node.name.elements) {
          const key = el.propertyName
            ? ts.isIdentifier(el.propertyName) || ts.isStringLiteral(el.propertyName) ? el.propertyName.text : null
            : ts.isIdentifier(el.name) ? el.name.text : null;
          if (key) add(file, sf, el, key, isDirect(node.initializer) ? 'direct' : 'destruct');
        }
      }

      // helper call sites: intEnv('NAME', 5) / envInt(env, 'NAME', 5) / this.read('NAME')
      if (ts.isCallExpression(node)) {
        const callee = unwrap(node.expression);
        const calleeName = ts.isIdentifier(callee) ? callee.text : ts.isPropertyAccessExpression(callee) ? callee.name.text : null;
        if (calleeName) {
          const same = helpers.filter((h) => h.name === calleeName && h.file === file);
          const pool = same.length ? same : importsByFile.get(file).has(calleeName) ? helpers.filter((h) => h.name === calleeName) : [];
          for (const h of pool) {
            for (const l of argNames(file, node.arguments[h.paramIndex])) {
              add(file, sf, node, h.template ? h.template.head + l + h.template.tail : l, 'helper');
            }
          }
        }
      }

      ts.forEachChild(node, visit);
    };
    visit(sf);
  }

  const seen = new Set();
  const uniq = sites.filter((s) => {
    const k = [s.name, s.file, s.line, s.kind, s.via].join('|');
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  uniq.sort((a, b) => a.name.localeCompare(b.name) || a.file.localeCompare(b.file) || a.line - b.line);
  dynamic.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
  passthrough.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
  return { files: files.length, sites: uniq, dynamic, passthrough };
}

/** name -> sites[] */
function groupByName(sites) {
  const m = new Map();
  for (const s of sites) {
    if (!m.has(s.name)) m.set(s.name, []);
    m.get(s.name).push(s);
  }
  return m;
}

/**
 * Load apps/api/src/config/env-schema.ts without a build step: transpile it with the TypeScript
 * compiler and evaluate it as a module whose `require('zod')` resolves from apps/api. The schema
 * file has no other imports, which is also why it is safe to load from a tool.
 * @returns {{ ENV_VARS: any[], DYNAMIC_ENV_READS: any[], envVarListSchema: any, dynamicEnvReadSchema: any }}
 */
function loadEnvSchema(file = path.join(SRC_ROOT, 'config', 'env-schema.ts')) {
  const ts = loadTypeScript();
  const Module = require('module');
  const out = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    fileName: file,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  });
  const m = new Module(file, module);
  m.filename = file;
  m.paths = Module._nodeModulePaths(path.dirname(file));
  m._compile(out.outputText, file);
  return m.exports;
}

/**
 * Compare what the code reads with what the schema declares.
 *
 * ERRORS (the gate fails):
 *   - a variable the code reads that has no ENV_VARS entry;
 *   - a dynamic read (name assembled at run time, or `process.env` handed whole to a function that
 *     lives elsewhere) with no DYNAMIC_ENV_READS row;
 *   - a registry row that covers a name ENV_VARS does not declare, or whose `reader` file does not
 *     contain a name it claims.
 * WARNINGS (printed, never fail):
 *   - an ENV_VARS entry nothing reads (and no registry row covers);
 *   - a registry row that matches no site any more.
 *
 * @param {{ sites: EnvSite[], dynamic: DynamicSite[], passthrough: {file:string,line:number,expr:string}[] }} scan
 * @param {{ ENV_VARS: any[], DYNAMIC_ENV_READS: any[] }} schema
 * @returns {{ errors: {file?:string,line?:number,message:string}[], warnings: {message:string}[] }}
 */
function compareToSchema(scan, schema) {
  const errors = [];
  const warnings = [];
  const declared = new Map(schema.ENV_VARS.map((v) => [v.name, v]));
  const rows = schema.DYNAMIC_ENV_READS;
  const byName = groupByName(scan.sites);

  for (const [name, sites] of [...byName].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (declared.has(name)) continue;
    const where = sites.slice(0, 3).map((s) => `${s.file}:${s.line}`).join(', ') + (sites.length > 3 ? `, +${sites.length - 3} more` : '');
    errors.push({
      file: sites[0].file,
      line: sites[0].line,
      message: `${name} is read by the API (${where}) but has no entry in apps/api/src/config/env-schema.ts. Declare it: type, default (copy the reader's fallback), purpose, killSwitch, failureDirection.`,
    });
  }

  const matchedRows = new Set();
  for (const d of [...scan.dynamic, ...scan.passthrough]) {
    const row = rows.find((r) => r.file === d.file && r.expr === d.expr);
    if (row) matchedRows.add(row);
    else {
      errors.push({
        file: d.file,
        line: d.line,
        message: `unregistered dynamic environment read \`${d.expr}\` at ${d.file}:${d.line}. A read whose variable name is not a literal must be registered in DYNAMIC_ENV_READS (file + expr + every name it can read).`,
      });
    }
  }

  const covered = new Set();
  for (const row of rows) {
    for (const name of row.covers) {
      covered.add(name);
      if (!declared.has(name)) {
        errors.push({ file: row.file, message: `DYNAMIC_ENV_READS row for \`${row.expr}\` (${row.file}) covers ${name}, which has no ENV_VARS entry.` });
      }
    }
    if (row.reader) {
      let text = null;
      try {
        text = fs.readFileSync(path.join(REPO_ROOT, row.reader), 'utf8');
      } catch {
        errors.push({ file: row.file, message: `DYNAMIC_ENV_READS row for \`${row.expr}\` names reader ${row.reader}, which cannot be read.` });
      }
      if (text !== null) {
        for (const name of row.covers) {
          if (!text.includes(name)) {
            errors.push({ file: row.reader, message: `DYNAMIC_ENV_READS row for \`${row.expr}\` says ${row.reader} reads ${name}, but that name does not occur in the file.` });
          }
        }
      }
    }
    if (!matchedRows.has(row)) {
      warnings.push({ message: `stale DYNAMIC_ENV_READS row: no dynamic read \`${row.expr}\` found in ${row.file} any more.` });
    }
  }

  for (const v of schema.ENV_VARS) {
    if (!byName.has(v.name) && !covered.has(v.name)) {
      warnings.push({ message: `${v.name} is declared but no code in apps/api/src reads it. Delete the entry, or mark it retired if the API still warns about it.` });
    }
  }
  return { errors, warnings };
}

module.exports = { scanEnvReads, groupByName, loadEnvSchema, compareToSchema, REPO_ROOT, API_ROOT, SRC_ROOT, NAME_RE };
