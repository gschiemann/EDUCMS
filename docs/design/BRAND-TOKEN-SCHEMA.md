# Flagship Templates — Shared Brand Token Schema

Every flagship template exposes a hidden `[data-widget="theme"]` block. To let the
template editor apply a school's brand (colors / fonts / logo) **identically across
all templates**, every template uses this SAME canonical token set. The runtime maps
each `theme.*` field onto a CSS variable; editing a field re-skins live.

## Canonical brand fields (use these names in EVERY template)
| `data-field`        | CSS var            | Meaning                                  |
|---------------------|--------------------|------------------------------------------|
| `theme.brand`       | `--brand`          | School primary color                     |
| `theme.brand2`      | `--brand2`         | Secondary / deep shade of primary        |
| `theme.accent`      | `--accent`         | Accent (highlights, CTAs)                |
| `theme.accent2`     | `--accent2`        | Second accent (optional)                 |
| `theme.ink`         | `--ink`            | Primary text color                       |
| `theme.bg`          | `--bg`             | Background base                          |
| `theme.pos`         | `--pos`            | "Positive" (win/open/go) — usually green |
| `theme.neg`         | `--neg`            | "Negative" (loss/closed) — usually red   |
| `theme.fDisplay`    | `--f-display`      | Display/headline font family             |
| `theme.fBody`       | `--f-body`         | Body font family                         |
| `theme.fMono`       | `--f-mono`         | Mono/label font family                   |
| `theme.scale`       | `--scale`          | Global type-size multiplier              |
| `theme.logo`*       | (img slot)         | School logo — see below                  |

\* Logos are not theme fields; they are `data-imgslot="school.logo"` (or `home.logo` /
`away.logo` / `aotw.photo` / `teacher.photo` etc.) elsewhere in the markup. The editor's
"logo" control writes the uploaded URL to those slots' `data-img`.

## Runtime (identical in every template)
```js
var THEME={brand:'--brand',brand2:'--brand2',accent:'--accent',accent2:'--accent2',
  ink:'--ink',bg:'--bg',pos:'--pos',neg:'--neg',
  fDisplay:'--f-display',fBody:'--f-body',fMono:'--f-mono',scale:'--scale'};
function applyTheme(){Object.keys(THEME).forEach(function(k){
  var el=document.querySelector('[data-field="theme.'+k+'"]');
  if(el&&el.textContent.trim()){var v=el.textContent.trim();
    root.style.setProperty(THEME[k], k.indexOf('f')===0?("'"+v+"'"):v);}});}
applyTheme();
new MutationObserver(applyTheme).observe(document.querySelector('[data-widget="theme"]'),
  {subtree:true,childList:true,characterData:true});
```

## How the editor applies a school brand (one object → all templates)
```
school = { brand:'#005A9C', brand2:'#00336b', accent:'#EF3E42', accent2:'#ffffff',
           ink:'#0b1f3a', bg:'#0b1f3a', pos:'#1f9d57', neg:'#d6455e',
           fDisplay:'Anton', fBody:'Inter', fMono:'JetBrains Mono', scale:1,
           logo:'https://…/dodgers.png' }
```
The editor sets each `theme.<key>` field's text to `school[key]`, and writes `school.logo`
to every `[data-imgslot]` that represents a school mark. Because all templates share the
schema, **one brand object skins the whole signage system** (verified: Dodgers blue/red).

## Migration note
Templates built before this schema used bespoke token names (e.g. `cUs`, `cBrand`,
`cHome`, `cGold`, `cAccent`). Those are being renamed to the canonical set in a sweep so
the editor's brand controls map 1:1 everywhere. Per-team colors (home vs away) keep
distinct tokens (`home.*` / `away.*`) but inherit `--brand` as their default.

> **Note on `theme.fHead`:** several shipped flagship templates also expose a
> `theme.fHead` → `--f-head` (sub-headline family) token in addition to the four above.
> It's a superset, not a conflict — include it when a template uses a distinct
> sub-headline face. The four core families (display/body/mono) + scale are the floor.

---

> **Provenance:** authored by the design team; canonical copy committed here on 2026-06-06
> alongside `FLAGSHIP-TEMPLATE-STANDARDS.md` as the binding spec the
> `venueos-template-designer` agent reads before building.
