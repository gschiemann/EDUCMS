"""Three review directions for ONE property overview, using existing CMS contracts.

Visual directions A/B/C approved by the user on 2026-10-04. This builder does
not change catalog registrations, tenant installations, or the first pack.
"""
from pathlib import Path
import importlib.util
import json
import shutil
import subprocess

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('cre', ROOT / 'apps/web/scripts/build-commercial-real-estate.py')
cre = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cre)
REVIEW = ROOT / 'scratch/design/jll-v2'
TARGET = cre.PUBLIC / 'templates/custom/jll-overview-directions'
ASSETS = TARGET / '_assets'
ASSETS.mkdir(parents=True, exist_ok=True)
for file in (REVIEW / 'assets').glob('*.jpg'):
    shutil.copy2(file, ASSETS / file.name)

def field(key, value, cls='', tag='p'):
    return cre.field(key, value, cls, tag).replace('data-fit-min="50"', 'data-fit-min="96"')

def photo(branded, interior=False):
    name = ('reception.jpg' if interior else 'architecture.jpg') if branded else 'generic-architecture.jpg'
    slot = cre.image('property.hero', None, 'architecture', label='One Liverpool Street — JLL listing imagery' if branded else 'Illustrative office architecture')
    url = '/templates/custom/jll-overview-directions/_assets/' + name
    urls = ([url, '/templates/custom/jll-overview-directions/_assets/workplace.jpg', '/templates/custom/jll-overview-directions/_assets/architecture-2.jpg'] if branded else [url, cre.ASSET_URL+'lobby.jpg', cre.ASSET_URL+'workspace.jpg'])
    cre.MEDIA['property.hero'].update(slides=json.dumps(urls), mode='carousel')
    return slot.replace('data-img=""', 'data-img="'+url+'"').replace('class="slot ', 'class="slot has-img ').replace('style="', 'style="background-image:url('+url+');')

def video(key='property.film'):
    return '<video class="property-video" data-property-video data-videoslot="'+key+'" data-posterslot="'+key+'.poster" data-aspect="16:9" muted autoplay loop playsinline preload="metadata" aria-label="Property film"></video>'

VIDEO_CSS = '.property-video{position:absolute;top:0;left:0;width:100%;height:100%;object-fit:cover;z-index:1;opacity:0;pointer-events:none}.property-video.video-ready{opacity:1;pointer-events:auto}'
VIDEO_RUNTIME = (ROOT/'scripts/commercial-property-video.js').read_text()

def identity(branded):
    return '<div class="identity">' + cre.logo(branded) + '</div>'

def facts(branded):
    values = [('19,570', 'sq ft available'), ('170,416', 'sq ft total building'), ('Liverpool St.', 'Direct station access')] if branded else [('19,500', 'sq ft available'), ('170,000', 'sq ft total building'), ('City center', 'Connected to transit')]
    return '<div class="key-facts">' + ''.join('<div class="key-fact">'+field(f'highlights.{i}.value',v,'fact-value')+field(f'highlights.{i}.label',l,'fact-label')+'</div>' for i,(v,l) in enumerate(values)) + '</div>'

def scene(branded, direction):
    name = 'One\nLiverpool\nStreet' if branded else 'Harbor\nExchange'
    if direction == 'c':
        name = 'One Liverpool\nStreet' if branded else 'Harbor\nExchange'
    location = 'London · EC2M' if branded else '100 Waterfront Avenue'
    visual=photo(branded, direction=='b')
    visual=visual[:-6]+video()+'</div>'
    config='<div hidden>'+field('video.autoplay','yes')+field('video.loop','yes')+field('media.property.film.fit','cover')+field('media.property.film.position','center')+'</div>'
    return visual + '<div class="photo-shade" aria-hidden="true"></div>' + identity(branded) + field('property.type', 'Office space to let' if branded else 'Office space for lease', 'transaction') + '<div class="property-title">' + field('property.name',name,'property-name','h1') + field('property.address', location, 'property-address') + '</div>' + facts(branded)+config

CSS = r'''
/* Passive signage: the smallest information text is 48px at 1920x1080. */
.direction{background:var(--paper);color:var(--ink)}
.direction .identity{position:absolute;left:150px;top:120px;z-index:5}
.direction .logo{width:410px;height:165px;background-position:left center}
.direction .wordmark{width:1060px;height:180px}
.direction .brand-name{font-size:calc(110px * var(--scale));letter-spacing:.035em;line-height:1}
.direction .brand-descriptor{display:none}
.direction .architecture{position:absolute}
.direction .transaction{position:absolute;font:600 calc(96px * var(--scale))/1.15 var(--f-body);max-height:130px;letter-spacing:0;color:var(--brand);z-index:4}
.direction .property-title{position:absolute;z-index:4}
.direction .property-name{font:600 calc(310px * var(--scale))/.98 var(--f-display);letter-spacing:-.035em;white-space:pre-line;max-height:1020px}
.direction .property-address{font:400 calc(108px * var(--scale))/1.15 var(--f-body);max-height:250px;margin-top:65px;white-space:pre-line}
.direction .key-facts{position:absolute;display:grid;grid-template-columns:1fr 1fr 1.15fr;gap:95px;z-index:5}
.direction .key-fact{min-width:0}
.direction .fact-value{font:600 calc(170px * var(--scale))/1.05 var(--f-display);letter-spacing:-.025em;max-height:210px;white-space:nowrap}
.direction .fact-label{font:400 calc(96px * var(--scale))/1.15 var(--f-body);margin-top:22px;max-height:125px;white-space:nowrap}
.direction .photo-shade{position:absolute;pointer-events:none;z-index:2}
/* A — a generous editorial margin meets a full-height architectural image. */
.direction.a .architecture{left:1570px;top:0;width:2270px;height:1720px}
.direction.a .transaction{left:150px;top:405px;width:1270px}
.direction.a .property-title{left:145px;top:580px;width:1320px}
.direction.a .property-name{font-size:calc(300px * var(--scale))}
.direction.a .property-address{font-size:calc(108px * var(--scale));margin-top:70px}
.direction.a .key-facts{left:0;top:1720px;width:3840px;height:440px;padding:55px 150px;background:var(--brand2);color:var(--inverse);border-top:16px solid var(--brand)}
.direction.a .brand-descriptor{font-size:calc(54px * var(--scale))}
/* B — hospitality photography, large protected typography, one quiet data rail. */
.direction.b .architecture{left:0;top:315px;width:3840px;height:1405px}
.direction.b .photo-shade{left:0;top:315px;width:3840px;height:1405px;background:linear-gradient(90deg,var(--shade),var(--shade) 38%,transparent 75%)}
.direction.b .identity{top:75px}
.direction.b .transaction{right:150px;top:110px;width:1350px;text-align:right}
.direction.b .property-title{left:150px;top:490px;width:1700px;color:var(--inverse)}
.direction.b .property-name{font-size:calc(320px * var(--scale));max-height:1050px}
.direction.b .property-address{margin-top:65px}
.direction.b .key-facts{left:0;top:1720px;width:3840px;height:440px;padding:60px 150px;background:var(--paper);border-top:16px solid var(--brand)}
/* C — an oversized editorial title above a photo and a deliberate brand block. */
.direction.c .identity{left:auto;right:150px;top:105px}
.direction.c .transaction{left:150px;top:120px;width:2250px}
.direction.c .property-title{left:140px;top:290px;width:2560px}
.direction.c .property-name{font-size:calc(305px * var(--scale));line-height:.98;max-height:670px}
.direction.c .property-address{position:absolute;left:2690px;top:345px;width:850px;font-size:calc(108px * var(--scale));margin:0}
.direction.c .architecture{left:0;top:1070px;width:2630px;height:1090px}
.direction.c .key-facts{left:2630px;top:1070px;width:1210px;height:1090px;padding:65px 90px;background:var(--brand);color:var(--inverse);display:flex;flex-direction:column;gap:35px}
.direction.c .fact-value{font-size:calc(160px * var(--scale));max-height:220px}
.direction.c .fact-label{margin-top:8px;font-size:calc(96px * var(--scale))}
.direction.c .wordmark{width:1100px}
/* Portrait is an authored composition, not a squeeze of the landscape scene. */
.direction.portrait .identity{left:125px;top:110px;right:auto}
.direction.portrait .transaction{left:125px;top:345px;width:1910px;text-align:left}
.direction.portrait .property-title{left:120px;top:530px;width:1920px}
.direction.portrait .property-name{font-size:calc(330px * var(--scale));line-height:.98;max-height:1040px}
.direction.portrait .property-address{position:static;font-size:calc(112px * var(--scale));margin-top:65px;width:1920px}
.direction.portrait .key-facts{left:0;top:3140px;width:2160px;height:700px;display:grid;grid-template-columns:1fr 1fr;gap:50px 70px;padding:65px 125px;align-content:start}
.direction.portrait .key-fact:last-child{grid-column:1/-1;display:flex;gap:65px;align-items:baseline}
.direction.portrait .fact-value{font-size:calc(170px * var(--scale));max-height:190px}
.direction.portrait .fact-label{font-size:calc(96px * var(--scale));margin-top:14px;max-height:130px}
.direction.portrait .key-fact:last-child .fact-value{font-size:calc(148px * var(--scale))}
.direction.portrait .key-fact:last-child .fact-label{font-size:calc(96px * var(--scale));white-space:normal;max-height:230px}
.direction.a.portrait .architecture{left:0;top:1750px;width:2160px;height:1390px}
.direction.a.portrait .property-name{white-space:normal;max-width:1800px}
.direction.a.portrait .property-title{top:540px}
.direction.b.portrait .identity{top:90px}
.direction.b.portrait .transaction{top:360px}
.direction.b.portrait .architecture{left:0;top:540px;width:2160px;height:2600px}
.direction.b.portrait .photo-shade{left:0;top:540px;width:2160px;height:2600px;background:linear-gradient(180deg,var(--shade),var(--shade) 41%,transparent 78%)}
.direction.b.portrait .property-title{top:750px}
.direction.b.portrait .property-name{font-size:calc(340px * var(--scale));max-height:1110px}
.direction.c.portrait .property-title{top:540px}
.direction.c.portrait .property-name{font-size:calc(320px * var(--scale));white-space:normal;max-width:1810px}
.direction.c.portrait .architecture{left:0;top:1750px;width:2160px;height:1390px}
.direction.c.portrait .key-facts{border-top:0;background:var(--brand)}
'''

records=[]
for direction, name in [('a','Architectural'), ('b','Hospitality'), ('c','Editorial')]:
    for branded in [True, False]:
        cre.BUILDERS['direction'] = lambda brand: scene(brand, direction)
        slug = ('jll' if branded else 'generic') + '-' + direction
        result = cre.document(slug, name+' — Property Overview', 'direction', branded)
        result = result.replace('class="stage direction"', 'class="stage direction '+direction+'"')
        result = result.replace('</style>', CSS+VIDEO_CSS+'</style>', 1)
        result = result.replace('</body>', '<script>'+VIDEO_RUNTIME+'</script></body>')
        # Quiet, neutral monochrome palette with JLL red / generic forest accents.
        result = result.replace('>#19282d</p>', '>#161c20</p>').replace('>#101d24</p>', '>#171c20</p>')
        (TARGET / (slug+'.html')).write_text(result)
        records.append({'id':slug,'direction':direction,'name':name,'brand':'JLL' if branded else 'Generic','url':'/templates/custom/jll-overview-directions/'+slug+'.html'})

for script in ['inject-shim-v2.cjs', 'inject-click-shim.cjs']:
    subprocess.run(['node',str(ROOT/'apps/web/scripts'/script),'custom/jll-overview-directions'],check=True,cwd=ROOT)
for record in records:
    source=cre.PUBLIC / record['url'].lstrip('/')
    source.write_text('\n'.join(line.rstrip() for line in source.read_text().splitlines())+'\n')
    shutil.copy2(source, REVIEW / (record['id']+'.html'))
(REVIEW/'directions.json').write_text(json.dumps(records,indent=2)+'\n')
print(json.dumps({'candidates':len(records),'registered':False,'review':str(REVIEW)}))
