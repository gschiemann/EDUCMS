from pathlib import Path
import base64, hashlib, html, json, mimetypes, re, sys
source = Path(sys.argv[1])
public = Path(__file__).resolve().parents[1] / 'public'
asset_root = public / 'templates/signage/corporate/homebuilder/_assets'
asset_root.mkdir(parents=True, exist_ok=True)
assets = {}
for file in (source / 'assets').iterdir():
    if file.is_file(): assets[hashlib.sha256(file.read_bytes()).hexdigest()] = file.name
carousel = (source / 'source/carousel.js').read_text()
records = []
def replace_asset(match):
    mime, encoded = match.groups()
    if mime.startswith('font/') or 'font' in mime: return match[0] # Embedded fonts work in opaque-origin frames offline.
    data = base64.b64decode(encoded)
    digest = hashlib.sha256(data).hexdigest()
    name = assets.get(digest, digest[:16] + ('.svg' if mime == 'image/svg+xml' else mimetypes.guess_extension(mime) or '.bin'))
    if mime == 'image/svg+xml': data = ('\n'.join(line.rstrip() for line in data.decode().splitlines())+'\n').encode()
    target = asset_root / name
    if target.exists(): assert target.read_bytes() == data
    else: target.write_bytes(data)
    return '/templates/signage/corporate/homebuilder/_assets/' + name
for collection, directory in [('standard', 'standard/corporate'), ('brookfield', 'custom/brookfield')]:
    dest = public / ('templates/signage/corporate/homebuilder' if collection == 'standard' else 'templates/custom/brookfield')
    for file in sorted((source / directory).rglob('*.html')):
        rel = file.relative_to(source / directory)
        output = dest / rel
        output.parent.mkdir(parents=True, exist_ok=True)
        content = file.read_text()
        assert '<script>'+carousel+'</script>' in content
        content = content.replace('<script>'+carousel+'</script>', '<script src="/templates/_native-image-carousel.js"></script>')
        content = re.sub(r'data:([^;,]+);base64,([A-Za-z0-9+/=]+)', replace_asset, content)
        content = content.replace('<html lang="en">', '<html lang="en" data-native-carousels="true">', 1)
        content = content.replace('<div data-controls hidden>', '<div data-controls hidden><span data-field="carousel.autoplay">yes</span><span data-field="carousel.transition">fade</span>', 1)
        output.write_text(content)
        board_id = file.stem
        n = int(board_id[:2])
        names = ['Welcome · Cinematic', 'Welcome · Editorial', 'Welcome · Gallery', 'Home · Floor Plans', 'Home · Availability', 'Community · Story', 'Tour · Takeaway']
        portrait = 'portrait' in rel.parts
        records.append({
            'id': ('preset-sig-corporate-'+str(n+12).zfill(2) if collection == 'standard' else 'brookfield-homebuilder-'+str(n).zfill(2)) + ('-portrait' if portrait else ''),
            'name': ('Corporate · Homebuilder · ' if collection == 'standard' else 'Brookfield · ') + names[n-1] + (' — Portrait' if portrait else ''),
            'description': 'Approved homebuilder signage with editable copy, branding, colors, fonts, media and QR destination. Images and floor plans use the native image carousel, seven seconds per slide.',
            'category': 'LOBBY' if collection == 'standard' else 'CUSTOM',
            'orientation': 'PORTRAIT' if portrait else 'LANDSCAPE',
            'schoolLevel': 'UNIVERSAL', 'vertical': 'CORPORATE',
            'screenWidth': 2160 if portrait else 3840, 'screenHeight': 3840 if portrait else 2160,
            'bgColor': '#f5f1e9' if collection == 'standard' else '#012a5e',
            'collection': collection, 'url': '/' + output.relative_to(public).as_posix(),
            'sha256': hashlib.sha256(content.encode()).hexdigest(),
        })
Path('docs/templates/homebuilder-install-manifest.json').write_text(json.dumps(records, indent=2)+'\n')
standard = [record for record in records if record['collection'] == 'standard']
presets = [{k:v for k,v in record.items() if k not in ['collection','url','sha256','vertical']} | {'zones':[{'name':'Scene','widgetType':'EXTERNAL_HTML','x':0,'y':0,'width':100,'height':100,'zIndex':1,'sortOrder':0,'defaultConfig':{'url':record['url']}}]} for record in standard]
Path('apps/api/src/templates/homebuilder-presets.ts').write_text("import type { SystemPreset } from './system-presets';\n\nexport const HOMEBUILDER_TEMPLATE_PRESETS: SystemPreset[] = "+json.dumps(presets,indent=2)+";\n")
print(json.dumps({'boards':len(records),'sharedAssets':len(list(asset_root.iterdir())),'htmlBytes':sum((public/r['url'].lstrip('/')).stat().st_size for r in records)}))
