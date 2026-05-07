"""Wire useHsLiveClock + resolveHsClock into all 15 remaining HS widgets.

Operates idempotently — running twice doesn't break anything.

For each file:
  1. Add `import { useHsLiveClock, resolveHsClock } from './useHsLiveClock';`
     after the HsStage import.
  2. Add `live?: boolean` to the function param destructuring + type.
  3. Add `const now = useHsLiveClock(live !== false);` and
     `const clock = resolveHsClock(c, now, DEFAULTS.clockTime, DEFAULTS.clockCaption || '');`
     right after the `const c = { ...DEFAULTS, ...config }` line.
  4. Replace `{c.clockTime}` → `{clock.time}` and
             `{c.clockCaption}` → `{clock.caption}`

Skips HsStage.tsx and HsVarsityWidget.tsx (already done manually).
"""

import re
import sys
from pathlib import Path

ROOT = Path(r'C:\Users\gschi\OneDrive\Desktop\EDU CMS\apps\web\src\components\widgets\hs')

SKIP = {'HsStage.tsx', 'HsVarsityWidget.tsx', 'useHsLiveClock.ts'}


def patch(path: Path) -> bool:
    src = path.read_text(encoding='utf-8')
    orig = src

    # 1. Import — idempotent
    if "useHsLiveClock" not in src:
        src = re.sub(
            r"(import \{ HsStage \} from '\./HsStage';)",
            r"\1\nimport { useHsLiveClock, resolveHsClock } from './useHsLiveClock';",
            src,
            count=1,
        )

    # 2. Add `live` to function signature. Pattern: ({ config }: { config?: T }) → ({ config, live }: { config?: T; live?: boolean })
    # Use a capturing group to extract the type name
    sig_re = re.compile(
        r"export function (Hs\w+Widget)\(\{\s*config\s*\}: \{\s*config\?: (\w+)\s*\}\)",
    )
    if "live?:" not in src:
        src = sig_re.sub(
            r"export function \1({ config, live }: { config?: \2; live?: boolean })",
            src,
        )

    # 3. Add hook calls AFTER `const c = { ...DEFAULTS, ...(config || {}) } as ...;`
    # Pattern matches several variants of this construction.
    if "useHsLiveClock(" not in src:
        c_decl_re = re.compile(
            r"(const c = \{ \.\.\.DEFAULTS, \.\.\.\(config \|\| \{\}\) \} as Required<\w+>;)",
        )
        src = c_decl_re.sub(
            r"\1\n  // 2026-05-07 — live clock (see useHsLiveClock.ts).\n"
            r"  const now = useHsLiveClock(live !== false);\n"
            r"  const clock = resolveHsClock(c as any, now, (DEFAULTS as any).clockTime || '', (DEFAULTS as any).clockCaption || '');",
            src,
        )

    # 4. Replace render references.
    src = src.replace("{c.clockTime}", "{clock.time}")
    src = src.replace("{c.clockCaption}", "{clock.caption}")

    if src != orig:
        path.write_text(src, encoding='utf-8')
        return True
    return False


def main():
    changed = []
    skipped = []
    for path in sorted(ROOT.glob("Hs*.tsx")):
        if path.name in SKIP:
            skipped.append(path.name)
            continue
        if patch(path):
            changed.append(path.name)
        else:
            skipped.append(path.name)
    print(f"Changed ({len(changed)}):")
    for n in changed:
        print(f"  {n}")
    print(f"Skipped ({len(skipped)}):")
    for n in skipped:
        print(f"  {n}")


if __name__ == '__main__':
    main()
