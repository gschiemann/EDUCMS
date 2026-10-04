"""A portable before/after review; nothing is installed in a customer tenant."""
from pathlib import Path
import argparse
import json
import shutil

ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / 'apps/web/public'
INDEX = r'''<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>JLL · Property overview · Round 2</title><style>
*{box-sizing:border-box}body{margin:0;background:#f0f1f0;color:#171c20;font:16px/1.45 Arial,sans-serif}button,a{font:inherit}button{cursor:pointer}header{padding:28px 40px;background:#fff;border-bottom:1px solid #d4d8d8;display:flex;align-items:center;justify-content:space-between;gap:30px}.overline{font-size:12px;letter-spacing:.13em;text-transform:uppercase;color:#59636a}h1{font-size:36px;letter-spacing:-.035em;line-height:1.1;margin:10px 0}header p{margin:0;max-width:800px;color:#59636a}.status{border-left:4px solid #e30613;padding-left:18px;max-width:275px;font-size:14px}.status strong{display:block;margin-bottom:5px}main{padding:24px 40px 40px}.directions{display:flex;gap:12px;margin-bottom:22px}.directions button{flex:1;text-align:left;padding:15px 20px;border:1px solid #c6cece;background:#fff;color:#171c20;font-weight:bold;font-size:18px}.directions small{display:block;font-size:13px;font-weight:normal;margin-top:5px}.directions button[aria-pressed=true]{background:#171c20;border-color:#171c20;color:white}.controls{display:flex;gap:20px;align-items:center;flex-wrap:wrap;margin-bottom:24px}.group{display:flex;gap:0}.group button{border:1px solid #bcc4c7;background:#fff;color:#171c20;padding:9px 17px}.group button+button{border-left:0}.group button[aria-pressed=true]{background:#dbe1e0;font-weight:bold}.primary{margin-left:auto;background:#e30613;color:white;border:0;padding:12px 22px;font-weight:bold}.comparison{display:grid;grid-template-columns:1fr 1fr;gap:24px;align-items:start}.board-head{display:flex;align-items:baseline;gap:15px;justify-content:space-between;margin-bottom:10px}.board-head h2{font-size:18px;margin:0}.board-head span{font-size:13px;color:#616970}iframe{width:100%;aspect-ratio:16/9;display:block;border:0;background:#fff}.portrait iframe{aspect-ratio:9/16}.caption{font-size:14px;color:#505b62;margin-top:14px;max-width:800px}.note{margin-top:30px;display:grid;grid-template-columns:1fr 1fr;gap:35px;border-top:1px solid #c6cece;padding-top:22px}.note h3{margin:0 0 8px;font-size:17px}.note p{margin:0 0 10px;color:#505b62;font-size:14px}.note a{color:#ab0710}.full{position:fixed;top:0;left:0;width:100%;height:100%;background:#080b0d;z-index:40;display:flex;align-items:center;justify-content:center}.full[hidden]{display:none}.full iframe{width:min(100vw,calc(100vh * 16/9));height:min(100vh,calc(100vw * 9/16));aspect-ratio:auto}.full.portrait iframe{width:min(100vw,calc(100vh * 9/16));height:min(100vh,calc(100vw * 16/9))}.close{position:absolute;right:15px;top:15px;padding:10px 16px;border:1px solid #dce2e2;background:rgba(255,255,255,.94);color:#171c20;font-size:14px}.close:hover{background:white}button:focus-visible,a:focus-visible{outline:3px solid #1c78d4;outline-offset:4px}@media(max-width:850px){header{padding:22px;display:block}.status{margin-top:20px;max-width:none}main{padding:22px}.directions{flex-wrap:wrap}.directions button{min-width:200px}.comparison,.note{grid-template-columns:1fr}.primary{margin-left:0}h1{font-size:29px}}
</style></head><body><header><div><div class="overline">Property overview · Design review · Round 2</div><h1>Built to be read across the room.</h1><p>Three directions for the same property overview. Larger information, clearer hierarchy, and a stronger property image.</p></div><div class="status"><strong>My recommendation: A · Architectural</strong>The cleanest property presentation, with the best separation between image and information.</div></header><main><nav class="directions" aria-label="Design directions"><button data-direction="a" aria-pressed="true">A · Architectural<small>Clear type. Uninterrupted architecture.</small></button><button data-direction="b" aria-pressed="false">B · Hospitality<small>Immersive imagery. A warmer first impression.</small></button><button data-direction="c" aria-pressed="false">C · Editorial<small>Oversized title. A bold brand color panel.</small></button></nav><div class="controls"><div class="group" aria-label="Brand"><button data-brand="jll" aria-pressed="true">JLL</button><button data-brand="generic" aria-pressed="false">Generic</button></div><div class="group" aria-label="Orientation"><button data-orientation="landscape" aria-pressed="true">Landscape</button><button data-orientation="portrait" aria-pressed="false">Portrait</button></div><button class="primary" data-full>View new design full screen ↗</button></div><section class="comparison"><article><div class="board-head"><h2>Before · Original overview</h2><span>Small facts and supporting copy</span></div><iframe title="Before: original overview" sandbox="allow-scripts" id="before"></iframe></article><article><div class="board-head"><h2 id="after-title">After · A · Architectural</h2><span>48 px minimum information text at 1080p</span></div><iframe title="After: revised overview" sandbox="allow-scripts" id="after"></iframe></article></section><p class="caption">These are live templates. The comparison scales both screens equally; use the full-screen view to inspect the revised design at the largest size your display supports.</p><div class="note"><section><h3>Less copy. More presence.</h3><p>Property names around 150–160 px at 1080p. Three prominent facts. Supporting information starts at 48 px. Portrait layouts are composed separately.</p><p>Logos, photography, property copy, facts, colors, fonts, text styling and positioning use the CMS editing controls already in the first pack.</p></section><section><h3>Overview direction first, then the collection.</h3><p>This round revises the property overview. The amenity, plans, location, industrial, investment and touch templates remain in the first review until the visual direction is chosen.</p><p>JLL reference: <a href="https://property.jll.co.uk/listings/1-liverpool-street" target="_blank" rel="noopener">One Liverpool Street listing</a>. Imagery and facts were reviewed October 3, 2026; availability is a content snapshot. Generic property details are illustrative.</p><p><a href="README.md">Review notes and CMS verification</a> · <a href="http://127.0.0.1:8926/index.html">Original full collection</a></p></section></div></main><div class="full" role="dialog" aria-modal="true" aria-label="Full-screen property overview" hidden><iframe title="Full-screen revised property overview" sandbox="allow-scripts"></iframe><button class="close" data-close>Close · Esc</button></div><script>
const names={a:'Architectural',b:'Hospitality',c:'Editorial'};let direction='a',brand='jll',orientation='landscape',returnFocus;
const full=document.querySelector('.full');
function query(){return '?orientation='+orientation+'&text='+btoa(JSON.stringify({'carousel.autoplay':'no'}));}
function afterURL(){return 'templates/custom/jll-overview-directions/'+brand+'-'+direction+'.html'+query();}
function render(){for(const key of ['direction','brand','orientation']){const value=key==='direction'?direction:key==='brand'?brand:orientation;document.querySelectorAll('[data-'+key+']').forEach(b=>b.setAttribute('aria-pressed',b.dataset[key]===value));}document.querySelector('.comparison').classList.toggle('portrait',orientation==='portrait');document.querySelector('#before').src='templates/'+(brand==='jll'?'custom/jll-commercial-real-estate':'signage/corporate/commercial-real-estate')+'/01-property-overview.html'+query();document.querySelector('#after').src=afterURL();document.querySelector('#after-title').textContent='After · '+direction.toUpperCase()+' · '+names[direction];}
function close(){full.hidden=true;full.querySelector('iframe').removeAttribute('src');returnFocus?.focus();}
document.addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;if(b.dataset.direction){direction=b.dataset.direction;render();}if(b.dataset.brand){brand=b.dataset.brand;render();}if(b.dataset.orientation){orientation=b.dataset.orientation;render();}if(b.hasAttribute('data-full')){returnFocus=b;full.classList.toggle('portrait',orientation==='portrait');full.querySelector('iframe').src=afterURL();full.hidden=false;full.querySelector('button').focus();}if(b.hasAttribute('data-close'))close();});
document.addEventListener('keydown',e=>{if(!full.hidden&&e.key==='Escape')close();if(!full.hidden&&e.key==='Tab'){e.preventDefault();full.querySelector('button').focus();}});
render();
</script></body></html>'''

def package(output):
    output.mkdir(parents=True, exist_ok=True)
    for folder in ['custom/jll-overview-directions', 'custom/jll-commercial-real-estate', 'signage/corporate/commercial-real-estate']:
        dest = output / 'templates' / folder
        dest.mkdir(parents=True, exist_ok=True)
        if folder.endswith('directions'):
            shutil.copytree(PUBLIC/'templates'/folder,dest,dirs_exist_ok=True)
        else:
            shutil.copy2(PUBLIC/'templates'/folder/'01-property-overview.html',dest/'01-property-overview.html')
            if (PUBLIC/'templates'/folder/'_assets').exists():
                shutil.copytree(PUBLIC/'templates'/folder/'_assets',dest/'_assets',dirs_exist_ok=True)
    shutil.copy2(PUBLIC/'templates/_native-image-carousel.js',output/'templates/_native-image-carousel.js')
    (output/'index.html').write_text(INDEX)
    scratch=ROOT/'scratch/design'
    (scratch/'index.html').write_text(INDEX)
    sources = {
        'reviewed':'2026-10-03',
        'jllProperty':'https://property.jll.co.uk/listings/1-liverpool-street',
        'jllImages':'https://res.cloudinary.com/global-demand-gen-prod/image/upload/f_jpg,w_2400,q_90/t_main_uk/olm-global/properties/uk/39181/images/',
        'genericImage':'https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?auto=format&fit=crop&w=2400&q=90',
        'jllFacts':{'name':'One Liverpool Street','location':'London EC2M','availableSqFt':'19,570','totalBuildingSqFt':'170,416','transport':'Liverpool Street / Elizabeth line'},
        'genericFacts':'Illustrative property details, not a marketed listing.'
    }
    (output/'sources.json').write_text(json.dumps(sources,indent=2)+'\n')
    notes = '''# JLL property overview — round 2

Three review directions for the same overview, each with JLL and generic branding and landscape/portrait layouts. These are candidates, not approved or installed templates.

- A — Architectural: clean typography, large architecture image, dark fact rail. Recommended.
- B — Hospitality: reception imagery with large protected white type.
- C — Editorial: oversized horizontal title and a strong brand-colored fact panel.

Information text starts at 96 design pixels on a 3840×2160 scene (48 px at 1080p). Main landscape titles are 300–320 design pixels. The comparison scales both old and new designs equally. Full-screen preview gives the largest view possible on the current display. A physical screen and viewing-distance check remains necessary for installation sizing.

## Scope

This round revises the OVERVIEW only. The rest of the first collection, including the two touch experiences, is awaiting the selected visual direction. No tenant data, installed template or catalog entry was changed. The next touch revision needs larger navigation, fewer simultaneous choices and progressive detail pages for plans, amenities, specifications and broker handoff.

## Editing

The existing V14 EXTERNAL_HTML shim and native media/text adapters handle these candidates. All property copy and facts expose data-field; brand.logo and property.hero are native media slots. Existing theme colors/fonts, saved text styles/positions and media fit/crop controls remain available. No new CMS feature or editor is required.

## Source content

JLL photographs/renderings and property facts come from the public One Liverpool Street listing, reviewed October 3, 2026. JLL watermarks remain intact. Availability is a reviewed snapshot, not a live listing feed. Generic details are sample data with separate stock architecture. See sources.json. Replace all content with approved property assets before a customer launch.

## Verification

See verification/results.json and verification/*.png for browser checks and actual rendered captures. These check layout and CMS compatibility; visual approval is still the user's decision. The candidates have not been deployed.

Run Launch Preview.command, or serve this folder with Python on localhost port 8928.
'''
    (output/'README.md').write_text(notes)
    launcher=output/'Launch Preview.command'
    launcher.write_text('#!/bin/zsh\ncd -- "${0:A:h}"\nopen "http://127.0.0.1:8928/index.html"\npython3 -m http.server 8928 --bind 127.0.0.1\n')
    launcher.chmod(0o755)
    print(output)

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--output',type=Path,required=True)
    package(p.parse_args().output.expanduser().resolve())
