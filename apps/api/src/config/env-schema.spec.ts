/**
 * The environment declaration (env-schema.ts) is only worth anything while it is TRUE. This spec
 * holds it to:
 *
 *   1. its own structural rules (zod: types, defaults, kill switches with a decided direction);
 *   2. the three rules the Foundry Standard's Article 15 puts on a kill switch - declared once,
 *      every `*_DISABLED` is a kill switch, every kill switch has a decided failure direction;
 *   3. COMPLETENESS against the code: every environment variable apps/api/src reads has an entry.
 *      This is the same comparison the CI gate runs (`apps/api/tools/check-env-declared.cjs`),
 *      so the blocking API Jest job enforces it even before a workflow step lists that file.
 *
 * Negative controls are here on purpose: a completeness check that cannot fail (a scanner that
 * silently finds nothing) is the false-green this repo keeps ending up with.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  buildEnvSchema,
  checkEnvValues,
  DYNAMIC_ENV_READS,
  dynamicEnvReadSchema,
  ENV_NAME_RE,
  ENV_VARS,
  envVarListSchema,
  envVarSpecSchema,
  type EnvVarSpec,
} from './env-schema';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const scanTool = require('../../tools/env-scan.cjs') as {
  scanEnvReads: (opts?: { srcRoot?: string }) => {
    files: number;
    sites: {
      name: string;
      file: string;
      line: number;
      kind: string;
      via: string;
    }[];
    dynamic: { file: string; line: number; expr: string }[];
    passthrough: { file: string; line: number; expr: string }[];
  };
  compareToSchema: (
    scan: unknown,
    schema: {
      ENV_VARS: readonly EnvVarSpec[];
      DYNAMIC_ENV_READS: readonly unknown[];
    },
  ) => { errors: { message: string }[]; warnings: { message: string }[] };
};

const valid: EnvVarSpec = {
  name: 'EXAMPLE_LIMIT',
  type: 'integer',
  default: 5,
  failureDirection: 'n/a',
  purpose: 'A well-formed example entry used by the negative controls.',
};

describe('env-schema: structure', () => {
  it('every entry passes the declaration schema', () => {
    const r = envVarListSchema.safeParse(ENV_VARS);
    if (!r.success) {
      throw new Error(
        r.error.issues
          .map((i) => `${String(i.path.join('.'))}: ${i.message}`)
          .join('\n'),
      );
    }
    expect(r.success).toBe(true);
  });

  it('declares each variable exactly once', () => {
    const seen = new Set<string>();
    const dupes: string[] = [];
    for (const v of ENV_VARS) {
      if (seen.has(v.name)) dupes.push(v.name);
      seen.add(v.name);
    }
    expect(dupes).toEqual([]);
  });

  it('uses only UPPER_SNAKE names', () => {
    expect(
      ENV_VARS.filter((v) => !ENV_NAME_RE.test(v.name)).map((v) => v.name),
    ).toEqual([]);
  });

  it('marks every *_DISABLED variable as a kill switch', () => {
    const missing = ENV_VARS.filter(
      (v) => /_DISABLED$/.test(v.name) && !v.killSwitch,
    ).map((v) => v.name);
    expect(missing).toEqual([]);
  });

  it('marks every *_MODE variable as a kill switch', () => {
    const missing = ENV_VARS.filter(
      (v) => /_MODE$/.test(v.name) && !v.killSwitch,
    ).map((v) => v.name);
    expect(missing).toEqual([]);
  });

  it('gives every kill switch a decided failure direction (open or closed, never n/a)', () => {
    const undecided = ENV_VARS.filter(
      (v) =>
        v.killSwitch &&
        v.failureDirection !== 'open' &&
        v.failureDirection !== 'closed',
    ).map((v) => v.name);
    expect(undecided).toEqual([]);
    expect(ENV_VARS.filter((v) => v.killSwitch).length).toBeGreaterThanOrEqual(
      33,
    );
  });

  it('keeps a secret free of any default value or example', () => {
    expect(
      ENV_VARS.filter((v) => v.type === 'secret' && v.default !== null).map(
        (v) => v.name,
      ),
    ).toEqual([]);
  });

  it('registers each dynamic read with valid, declared coverage', () => {
    const declared = new Set(ENV_VARS.map((v) => v.name));
    for (const row of DYNAMIC_ENV_READS) {
      expect(dynamicEnvReadSchema.safeParse(row).success).toBe(true);
      for (const name of row.covers)
        expect([name, declared.has(name)]).toEqual([name, true]);
    }
  });
});

describe('env-schema: the rules reject bad declarations (negative controls)', () => {
  const rejects = (patch: Partial<EnvVarSpec>) =>
    envVarSpecSchema.safeParse({ ...valid, ...patch }).success;

  it('accepts the well-formed example', () => {
    expect(envVarSpecSchema.safeParse(valid).success).toBe(true);
  });

  it('rejects a kill switch whose failure direction is n/a', () => {
    expect(rejects({ killSwitch: true, failureDirection: 'n/a' })).toBe(false);
    expect(rejects({ killSwitch: true, failureDirection: 'closed' })).toBe(
      true,
    );
  });

  it('rejects a duplicate name', () => {
    expect(envVarListSchema.safeParse([valid, valid]).success).toBe(false);
  });

  it('rejects a boolean that does not say what it accepts, and a non-boolean that does', () => {
    expect(rejects({ type: 'boolean', default: false })).toBe(false);
    expect(rejects({ type: 'boolean', default: false, accepts: '1' })).toBe(
      true,
    );
    expect(rejects({ accepts: '1' })).toBe(false);
  });

  it('rejects an enum default outside its values, and values on a non-enum', () => {
    expect(
      rejects({ type: 'enum', values: ['on', 'off'], default: 'maybe' }),
    ).toBe(false);
    expect(
      rejects({ type: 'enum', values: ['on', 'off'], default: 'on' }),
    ).toBe(true);
    expect(rejects({ values: ['a', 'b'] })).toBe(false);
  });

  it('rejects a default of the wrong type, a secret with a default, and a multi-line purpose', () => {
    expect(rejects({ default: 2.5 })).toBe(false);
    expect(rejects({ type: 'string', default: 7 })).toBe(false);
    expect(rejects({ type: 'secret', default: 'hunter2' })).toBe(false);
    expect(rejects({ purpose: 'two\nlines of purpose text' })).toBe(false);
  });

  it('rejects an unknown field and a malformed name', () => {
    expect(
      envVarSpecSchema.safeParse({ ...valid, owner: 'someone' }).success,
    ).toBe(false);
    expect(rejects({ name: 'lower_case' })).toBe(false);
  });
});

describe('env-schema: completeness against the code', () => {
  const schema = { ENV_VARS, DYNAMIC_ENV_READS };

  it('declares every environment variable apps/api/src reads', () => {
    const scan = scanTool.scanEnvReads();
    // The scanner must actually be looking: today it resolves ~240 names across ~600 files. A
    // regression that makes it find nothing would otherwise read as a clean pass.
    expect(scan.files).toBeGreaterThan(400);
    expect(new Set(scan.sites.map((s) => s.name)).size).toBeGreaterThan(200);

    const { errors } = scanTool.compareToSchema(scan, schema);
    if (errors.length)
      throw new Error(
        `\n${errors.map((e) => `  - ${e.message}`).join('\n')}\n`,
      );
    expect(errors).toEqual([]);
  }, 120_000);

  it('FAILS on an undeclared read, however the name is reached (scanner negative control)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'env-scan-'));
    try {
      fs.writeFileSync(
        path.join(dir, 'shapes.ts'),
        [
          "const HELD = 'NC_CONST';",
          "const LIST = ['NC_ARRAY_A', 'NC_ARRAY_B'];",
          'export const a = process.env.NC_DIRECT;',
          "export const b = process.env['NC_BRACKET'];",
          'export const c = process.env[HELD];',
          'export function d(env: NodeJS.ProcessEnv = process.env) { return env.NC_ALIAS; }',
          'function intEnv(name: string, def: number) { return Number(process.env[name]) || def; }',
          "export const e = intEnv('NC_HELPER', 1);",
          'export const f = LIST.filter((k) => !process.env[k]);',
          'export const g = process.env[`NC_DYN_${Math.random()}`];',
          'export function h() { const env: NodeJS.ProcessEnv = {}; env.NC_SCRATCH_WRITE = "x"; return env; }',
        ].join('\n'),
      );
      const scan = scanTool.scanEnvReads({ srcRoot: dir });
      const names = new Set(scan.sites.map((s) => s.name));
      for (const n of [
        'NC_DIRECT',
        'NC_BRACKET',
        'NC_CONST',
        'NC_ALIAS',
        'NC_HELPER',
        'NC_ARRAY_A',
        'NC_ARRAY_B',
      ]) {
        expect([n, names.has(n)]).toEqual([n, true]);
      }
      // A write into a scratch child environment is not a read of the process environment.
      expect(names.has('NC_SCRATCH_WRITE')).toBe(false);

      const { errors } = scanTool.compareToSchema(scan, schema);
      const text = errors.map((e) => e.message).join('\n');
      expect(text).toContain('NC_DIRECT is read by the API');
      expect(text).toContain('NC_HELPER is read by the API');
      expect(text).toContain('unregistered dynamic environment read');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

// eslint-disable-next-line @typescript-eslint/no-require-imports
const gen = require('../../tools/generate-env-docs.cjs') as {
  groupsFromSource: (text: string) => {
    byName: Map<string, string>;
    order: string[];
  };
  documentationStatus: (
    claude: string | null,
    docs: string | null,
  ) => (name: string) => string;
  renderDocsRegion: (
    vars: readonly EnvVarSpec[],
    statusOf: (n: string) => string,
  ) => string;
  applyDocsRegion: (text: string, region: string) => string;
  renderEnvExampleRegion: (
    vars: readonly EnvVarSpec[],
    present: Set<string>,
    groups: { byName: Map<string, string>; order: string[] },
  ) => string;
  applyEnvExampleRegion: (text: string, region: string) => string;
  namesInEnvExample: (text: string) => Set<string>;
  envExampleCandidates: (
    vars: readonly EnvVarSpec[],
    present: Set<string>,
  ) => EnvVarSpec[];
};

describe('generate-env-docs: the generated outputs', () => {
  const sample: EnvVarSpec[] = [
    {
      name: 'ALPHA_LIMIT',
      type: 'integer',
      default: 5,
      failureDirection: 'n/a',
      purpose: 'A tuning number with a | pipe and <angle> brackets.',
    },
    {
      name: 'BETA_DISABLED',
      type: 'boolean',
      default: false,
      accepts: '1',
      killSwitch: true,
      failureDirection: 'open',
      purpose: 'A kill switch used by the generator tests.',
    },
    {
      name: 'GAMMA_KEY',
      type: 'secret',
      default: null,
      failureDirection: 'closed',
      purpose: 'A credential that must never get an example value.',
    },
    {
      name: 'PATH',
      type: 'path',
      default: null,
      origin: 'platform',
      failureDirection: 'n/a',
      purpose: 'Provided by the platform, never set by hand.',
    },
    {
      name: 'OLD_PIN',
      type: 'string',
      default: null,
      retired: true,
      failureDirection: 'n/a',
      purpose: 'Removed; the API only warns when it is set.',
    },
    {
      name: 'ALREADY_THERE',
      type: 'string',
      default: 'x',
      failureDirection: 'n/a',
      purpose: 'Already named in the example file.',
    },
  ];
  const groups = { byName: new Map<string, string>(), order: [] as string[] };
  const original =
    '# existing header\nFOO=bar\n# BAZ=qux\n\n# trailing comment\n';

  it('appends to .env.example without touching a single existing byte', () => {
    const present = gen.namesInEnvExample(original + '\nALREADY_THERE=1\n');
    const next = gen.applyEnvExampleRegion(
      original,
      gen.renderEnvExampleRegion(sample, present, groups),
    );
    expect(next.startsWith(original)).toBe(true);
    expect(next.length).toBeGreaterThan(original.length);
  });

  it('is idempotent: regenerating replaces the block and nothing else', () => {
    const present = gen.namesInEnvExample(original);
    const region = gen.renderEnvExampleRegion(sample, present, groups);
    const once = gen.applyEnvExampleRegion(original, region);
    const twice = gen.applyEnvExampleRegion(once, region);
    expect(twice).toBe(once);
    // a later hand edit ABOVE the block survives a regeneration
    const edited = once.replace('FOO=bar', 'FOO=changed');
    const again = gen.applyEnvExampleRegion(
      edited,
      gen.renderEnvExampleRegion(sample, gen.namesInEnvExample(edited), groups),
    );
    expect(again).toContain('FOO=changed');
    expect(again.match(/# >>> BEGIN GENERATED/g)).toHaveLength(1);
  });

  it('writes every row commented out, so copying the file changes nothing', () => {
    const region = gen.renderEnvExampleRegion(sample, new Set(), groups);
    const live = region.split('\n').filter((l) => /^[A-Za-z_]/.test(l));
    expect(live).toEqual([]);
  });

  it('lists only what an operator sets: no platform, retired or already-named variable', () => {
    const present = new Set(['ALREADY_THERE']);
    expect(
      gen.envExampleCandidates(sample, present).map((v) => v.name),
    ).toEqual(['ALPHA_LIMIT', 'BETA_DISABLED', 'GAMMA_KEY']);
    const region = gen.renderEnvExampleRegion(sample, present, groups);
    expect(region).toContain('# ALPHA_LIMIT=5');
    expect(region).toContain('# BETA_DISABLED=false');
    expect(region).toContain('# GAMMA_KEY=\n');
    for (const gone of ['PATH=', 'OLD_PIN=', 'ALREADY_THERE='])
      expect(region).not.toContain('# ' + gone);
  });

  it('treats a commented example row as already named', () => {
    expect(
      [
        ...gen.namesInEnvExample(
          '# BAZ=qux\nFOO=1\n  # QUX=2\n#   prose about THING=1\n',
        ),
      ].sort(),
    ).toEqual(['BAZ', 'FOO', 'QUX']);
  });

  it('renders the docs region with escaped pipes and angle brackets, and keeps hand-kept text', () => {
    const region = gen.renderDocsRegion(sample, () => 'none');
    expect(region).toContain(
      'A tuning number with a \\| pipe and &lt;angle&gt; brackets.',
    );
    expect(region.startsWith('<!-- ENV-SCHEMA:BEGIN')).toBe(true);
    expect(region.endsWith('<!-- ENV-SCHEMA:END -->')).toBe(true);
    const hand = '# Environment\n\nHand-kept text.\n';
    const next = gen.applyDocsRegion(hand, region);
    expect(next.startsWith(hand)).toBe(true);
    expect(gen.applyDocsRegion(next, region)).toBe(next);
  });

  it('reads "documented" from the hand-kept tables, wherever they live, and ignores its own block', () => {
    const claude =
      '## Environment Variables\n\n| Variable | x |\n|---|---|\n| `ALPHA_LIMIT` | a |\n| `VIDEO_*` | w |\n\n## Other\n\n| `BETA_DISABLED` | not here |\n';
    const region = gen.renderDocsRegion(sample, () => 'none');
    const docs = '# Env\n\n| `GAMMA_KEY` | hand-kept |\n\n' + region + '\n';
    const status = gen.documentationStatus(claude, docs);
    expect(status('ALPHA_LIMIT')).toBe('claude');
    expect(status('VIDEO_THING')).toBe('claude');
    expect(status('GAMMA_KEY')).toBe('environment-md');
    // BETA_DISABLED is only backticked in a table OUTSIDE the Environment Variables section: a mention, not documentation
    expect(status('BETA_DISABLED')).toBe('mentioned');
    // OLD_PIN appears only in the generated block, which must never count as hand-kept documentation
    expect(status('OLD_PIN')).toBe('none');
  });
});

describe('env-schema: the derived validator (declared, not wired into boot)', () => {
  it('has one leaf per declared variable', () => {
    expect(Object.keys(buildEnvSchema().shape)).toHaveLength(ENV_VARS.length);
  });

  it('reports nothing for an empty environment - a missing variable is never an issue', () => {
    expect(checkEnvValues({})).toEqual([]);
  });

  it('lets unknown variables through and accepts every enum in any case', () => {
    expect(
      checkEnvValues({
        SOMETHING_ELSE: 'x',
        CUSTOMER_ALERT_EMAILS_MODE: 'ON',
        NODE_ENV: 'Production',
      }),
    ).toEqual([]);
  });

  it('reports a value the reader would certainly mis-handle', () => {
    const issues = checkEnvValues({
      AI_HOURLY_CAP: 'twelve',
      CUSTOMER_ALERT_EMAILS_MODE: 'maybe',
      CAPACITY_LIMITS: '{nope',
    });
    expect(issues.join('\n')).toContain('AI_HOURLY_CAP');
    expect(issues.join('\n')).toContain('CUSTOMER_ALERT_EMAILS_MODE');
    expect(issues.join('\n')).toContain('CAPACITY_LIMITS');
  });
});
