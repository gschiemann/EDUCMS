from pathlib import Path
import subprocess, re, html, json
here=Path(__file__).resolve().parent
root=here.parents[2]
runtime=(here/'essentials-runtime.js').read_text()+'\n'+(here/'legacy-template-clock.js').read_text()
fontpath='/templates/signage/corporate/commercial-touch/assets/'
common='''
@font-face{font-family:Manrope;src:url("FONTManrope.ttf");font-weight:200 800;font-display:block}
@font-face{font-family:"Space Mono";src:url("FONTSpaceMono.ttf");font-display:block}
@font-face{font-family:"Cormorant Garamond";src:url("/templates/signage/refresh-assets/CormorantGaramond.ttf");font-weight:300 700;font-display:block}
@font-face{font-family:Fraunces;src:url("/templates/signage/refresh-assets/Fraunces.ttf");font-weight:100 900;font-display:block}
:root{--fg:var(--ink);--primary:var(--brand);--primary2:var(--brand);--paper:var(--brand2);--mute:var(--accent2);--good:var(--pos);--ready:var(--pos);--font-display:var(--f-display);--font-grotesk:var(--f-body);--font-mono:var(--f-mono);--font-condensed:var(--f-body);--rule:rgba(255,255,255,.18)}
html,body{background:var(--bg)}.stage{width:var(--stage-w);height:var(--stage-h);transform:translate(-50%,-50%) scale(var(--stage-scale));background:var(--bg)}
[data-field]{min-width:0;line-height:1.2;white-space:pre-line;overflow:visible}.frame>*{min-width:0;min-height:0}
.logo[data-imgslot],.mark[data-imgslot]{position:relative;overflow:hidden;background-size:contain;background-position:center;background-repeat:no-repeat}
[data-imgslot].has-img>svg,[data-imgslot].has-img>.placeholder{visibility:hidden}.photo{position:relative;overflow:hidden}.scrim{pointer-events:none}.tagpill,.pill{z-index:2}
.brand .n{font-size:100px;line-height:1.12}.brand .t{font-size:50px;line-height:1.3;letter-spacing:.13em;margin-top:12px}
.live{font-size:50px;line-height:1.25;letter-spacing:.08em}.clock{font-size:84px}.top{min-height:190px}.date .d{font-size:50px}.date .h{font-size:70px}
.feature .b{padding:60px}.feature .k{font-size:52px;line-height:1.4;letter-spacing:.12em}.feature .nm{font-size:180px;line-height:1.15;margin-top:15px}
.feature .scrim{background:linear-gradient(180deg,transparent 20%,var(--bg) 96%)}.feature .tagpill,.feature .pill{font-size:50px;line-height:1.3;max-width:90%;white-space:normal}
.feature .specs{display:grid;grid-template-columns:1fr 1fr;gap:20px 45px;font-size:62px;margin-top:18px}.feature .specs span{display:block}
.feature .price{display:flex;align-items:baseline;gap:26px;font-size:104px}.feature .price small{font-size:50px;line-height:1.3;color:var(--ink)}
.feature .meta{font-family:var(--f-body);font-size:66px;line-height:1.4;max-width:100%;color:var(--ink)}.feature .where{font-size:52px;line-height:1.35}
.frame{grid-template-columns:1.1fr 1fr;grid-template-rows:200px minmax(0,1fr) 330px;gap:40px;padding:80px}
.avail,.prog{padding:45px 50px}.avail .h,.prog .h{align-items:center;gap:30px;min-height:140px}.avail .h .ttl,.prog .h .ttl{font-size:86px;line-height:1.15}.avail .h .sub,.prog .h .sub{font-size:50px;line-height:1.3;letter-spacing:.06em;max-width:530px;text-align:right}
.urow{grid-template-columns:230px minmax(0,1fr) 400px;gap:35px}.usuite{font-size:105px;width:auto;line-height:1.15}.uinfo .ut{font-size:64px;line-height:1.25}.uinfo .ud{font-size:52px;line-height:1.4;margin-top:12px}.uprice{white-space:normal}.uprice .up{font-size:94px;line-height:1.1}.uprice .us{font-size:50px;line-height:1.25;letter-spacing:.03em;padding:10px 15px;white-space:normal;max-width:100%}
.prow{grid-template-columns:225px minmax(0,1fr) 270px;gap:35px}.ptime{font-size:90px;line-height:1.15}.ptime small{font-size:50px;line-height:1.2}.pname{font-size:65px;line-height:1.25}.pname small{font-size:50px;line-height:1.4;margin-top:15px}.ploc{font-size:55px;line-height:1.3;white-space:normal}.prow.now{background:none;margin:0;padding:0}
.foot{padding-top:28px;grid-template-columns:1.5fr 1fr 1.1fr;gap:30px}.fc{padding:30px 36px;gap:20px}.fc>*{min-width:0;max-width:100%;overflow-wrap:anywhere}.fc .l{font-size:50px;line-height:1.3;letter-spacing:.08em}.fc .v,.fc.gold .v,.fc.feat .v{font-size:65px;line-height:1.3}.fc.gold .l,.fc.gold .v{color:var(--bg)}.fc.feat .l,.fc.feat .v{color:var(--ink)}
.stage[data-orient=portrait] .frame{grid-template-columns:1fr;grid-template-rows:210px 1260px minmax(0,1fr) 440px;gap:40px;padding:80px}
.stage[data-orient=portrait] .feature{min-height:0}.stage[data-orient=portrait] .feature .b{padding:50px 60px}.stage[data-orient=portrait] .feature .specs{grid-template-columns:repeat(4,1fr);gap:25px;font-size:60px}
.stage[data-orient=portrait] .foot{grid-template-columns:1.4fr 1fr 1fr;gap:24px}.stage[data-orient=portrait] .fc{padding:28px}.stage[data-orient=portrait] .brand .n{font-size:88px}.stage[data-orient=portrait] .brand{max-width:1180px}.stage[data-orient=portrait] .date{max-width:600px}.stage[data-orient=portrait] .live{display:none}
'''.replace('FONT',fontpath)
bar='''
.frame{grid-template-columns:1fr}.top{grid-row:1;grid-column:1}.body{grid-row:2;grid-column:1}.foot{grid-row:3;grid-column:1}
.frame{grid-template-rows:230px minmax(0,1fr) 230px;gap:40px;padding:80px}.top{gap:45px}.top>div:first-child{display:grid;grid-template-columns:115px 1fr;grid-template-rows:110px 100px;gap:0 30px;max-width:1500px;min-width:0}.mark{grid-row:1/3;width:110px;height:110px;align-self:center;border:2px solid var(--accent);border-radius:50%;display:grid;place-items:center}.logo{font-size:96px;line-height:1.1;min-width:0}.tag{margin:0;font-size:50px;line-height:1.3;letter-spacing:.1em;grid-column:2}.title{font-size:86px;line-height:1.2;max-width:800px}.clock{font-size:82px;min-width:430px;text-align:right}
.body{grid-template-columns:1.12fr 1fr;gap:70px}.hours{padding:50px 60px;border-radius:0;background:var(--brand2)}.hours h2{font-size:92px;line-height:1.2;margin-bottom:20px;letter-spacing:.12em}.hr{flex:1;font-size:88px;line-height:1.2;gap:35px;padding:22px 0;grid-template-columns:minmax(0,1fr) minmax(0,1fr)}.hr .v{font-size:70px;line-height:1.2;text-align:right;color:var(--ink)}.hr.today{background:transparent;padding:22px 0}.hr.today .v{color:var(--ink)}
.right{display:grid;grid-template-rows:minmax(0,1fr) 430px 540px;gap:30px}.venue-photo{position:relative;overflow:hidden;border-radius:180px 0 0 0;min-height:0;background:var(--brand2)}.right .panel{padding:40px 50px;border-radius:0;gap:18px}.right .panel.accent{background:var(--brand);color:var(--ink)}.right .panel .l{font-size:50px;line-height:1.3;letter-spacing:.12em;color:var(--accent2)}.right .panel .v{font-family:var(--f-display);font-size:96px;line-height:1.15;letter-spacing:0}.right .panel .a{font-family:var(--f-body);font-size:60px;line-height:1.3;color:var(--ink)}
.foot{grid-template-columns:repeat(4,minmax(0,1fr));gap:30px;padding-top:30px}.ft .k{font-size:50px;line-height:1.2;letter-spacing:.14em}.ft .v{font-size:72px;line-height:1.3;margin-top:20px}
.stage[data-orient=portrait] .frame{grid-template-rows:310px minmax(0,1fr) 430px;gap:45px;padding:85px}.stage[data-orient=portrait] .top{display:grid;grid-template-columns:1fr 480px;grid-template-rows:180px 100px;gap:15px}.stage[data-orient=portrait] .top>div:first-child{grid-column:1/3;max-width:none}.stage[data-orient=portrait] .title{grid-column:1;grid-row:2;font-size:80px}.stage[data-orient=portrait] .clock{grid-column:2;grid-row:2;min-width:0}.stage[data-orient=portrait] .body{grid-template-columns:1fr;grid-template-rows:1.15fr 1fr;gap:45px}.stage[data-orient=portrait] .hours{padding:45px 55px}.stage[data-orient=portrait] .right{grid-template-columns:1fr 1fr;grid-template-rows:650px minmax(0,1fr);gap:30px}.stage[data-orient=portrait] .venue-photo{grid-column:1/3;border-radius:120px 0 0 0}.stage[data-orient=portrait] .right .panel{padding:35px}.stage[data-orient=portrait] .right .panel .v{font-size:90px}.stage[data-orient=portrait] .right .panel .a{font-size:60px}.stage[data-orient=portrait] .foot{grid-template-columns:1fr 1fr;grid-template-rows:1fr 1fr;gap:25px}.stage[data-orient=portrait] .ft{border:0;padding:0}.stage[data-orient=portrait] .ft .v{margin-top:14px;font-size:70px}
'''
configs={
 'real-estate/01-availability-flagship':dict(theme=['#c8a45c','#171b21','#5ec8c0','#c3cbd5','#f3f5f8','#0f1216','Cormorant Garamond'],photo='/templates/signage/refresh-assets/apartment-living-v1.png'),
 'museum/01-today-flagship':dict(theme=['#d9b06a','#1b1726','#a84468','#b9b0c7','#f5f1ea','#120f1a','Fraunces'],photo='/templates/signage/refresh-assets/museum-light-time-v1.png'),
 'bar/09-hours-location':dict(theme=['#914a2a','#19120f','#d8b35c','#c2b29a','#f1e3c8','#0c0807','Cormorant Garamond'],photo='/templates/signage/hospitality/assets/hospitality-lobby-grand-room-v1.jpg')
}
for name,config in configs.items():
 rel='apps/web/public/templates/signage/'+name+'.html'
 s=subprocess.check_output(['git','show','d24392a7d:'+rel],cwd=root,text=True)
 # Keep content keys and authored identity; replace obsolete apply/fit engines.
 s=s.replace('<html lang=\"en\">','<html lang=\"en\" data-native-carousels=\"true\">')
 s=re.sub(r'<script\b[^>]*>[\s\S]*?</script>','',s)
 s=s.replace('<head>','<head><meta name="viewport" content="width=device-width,initial-scale=1">')
 s=re.sub(r' data-feed="[^"]*"| data-refresh="[^"]*"','',s)
 s=s.replace('class="logo" data-widget="logo" aria-hidden="true"','class="logo" data-widget="logo" data-imgslot="brand.logo" data-img="" aria-label="Venue logo"')
 s=s.replace('class="photo placeholder" data-imgslot="feat.photo" aria-hidden="true"','class="photo" data-imgslot="feat.photo" data-img="'+config['photo']+'" aria-label="Featured photograph"')
 s=s.replace('<div class="live">● Available now</div>','<div class="live" data-field="availability.label">Leasing information</div>')
 s=re.sub(r'<div class="pname" data-field="([^"]+)">([^<]+)(<small[\s\S]*?</small>)</div>',r'<div class="pname"><div data-field="\1">\2</div>\3</div>',s)
 s=re.sub(r'<div class="ptime" data-field="(prog\.(\d)\.time)">([^<]+)<small>[^<]+</small></div>',lambda m:'<div class="ptime"><div data-field="'+m[1]+'">'+m[3]+'</div><small data-field="prog.'+m[2]+'.period">'+('AM' if m[2]=='0' else 'PM')+'</small></div>',s)
 if name.startswith('bar/'):
  s=s.replace('<header class="top"><div>', '<header class="top"><div><div class="mark" data-imgslot="brand.logo" data-img="" aria-label="Venue logo"><span class="placeholder" data-field="brand.initial">L</span></div>')
  s=s.replace('<aside class="right">','<aside class="right"><div class="venue-photo" data-imgslot="venue.photo" data-img="'+config['photo']+'" aria-label="Venue photograph"></div>')
  s=s.replace('<section class="hours">','<section class="hours" data-repeat-max="6">')
  s=s.replace('<h2>Hours</h2>','<h2 data-field="hours.title">Make an evening of it.</h2>')
  labels={'Where':'addr.label','Phone':'contact.phoneLabel','Reservations':'contact.webLabel','ID':'foot.idLabel','Dress':'foot.dressLabel','Last call':'foot.lastcallLabel','Parking':'foot.parkingLabel'}
  for label,key in labels.items(): s=re.sub(r'(<div class="[lk]"[^>]*)>'+label+r'</div>',r'\1 data-field="'+key+'">'+label+'</div>',s)
  s=s.replace('Tonight · Friday','Friday').replace('Pier 47 · Bar','The Lantern Bar')
  s=s.replace('style="font-size:56px;color:var(--accent)"','style="font-size:76px;color:var(--accent)"')
 # Every visible field gets a fitting contract. Body copy uses the 60px floor.
 def fitattr(m):
  opening=m[0];key=re.search(r'data-field="([^"]+)"',opening)[1]
  floor=50 if re.search(r'(tag|tagline|period|status|note|label|Label|kicker|where|priceunit|dow)$',key) else 60
  return opening[:-1]+' data-fit data-fit-min="'+str(floor)+'">'
 s=re.sub(r'<[^/!][^>]*\bdata-field="[^"]+"[^>]*>',fitattr,s)
 theme=dict(zip(['brand','brand2','accent','accent2','ink','bg','fDisplay'],config['theme']))|dict(pos='#5fd08a',neg='#d95d5d',fBody='Manrope',fMono='Space Mono',scale='1')
 hidden='<div data-widget="theme" hidden>'+''.join('<span data-field="theme.'+k+'">'+html.escape(v)+'</span>' for k,v in theme.items())+'</div>'
 s=s.replace('<div class=\"ulist\">','<div class=\"ulist\" data-repeat-max=\"4\">').replace('<div class=\"plist\">','<div class=\"plist\" data-repeat-max=\"4\">')
 controls={'clock.mode':'live','clock.timeZone':'','clock.locale':'en-US','clock.hour12':'yes','carousel.autoplay':'yes','carousel.transition':'fade','carousel.intervalSeconds':'10'}
 slots=re.findall(r'data-imgslot="([^"]+)" data-img="([^"]*)"',s)
 for key,url in slots:
  controls.update({'media.'+key+'.slides':json.dumps([url] if url else []),'media.'+key+'.mode':'single','media.'+key+'.fit':'contain' if 'logo' in key else 'cover','media.'+key+'.position':'center','media.'+key+'.alt':'Venue logo' if 'logo' in key else 'Featured photograph'})
 hidden+='<div data-controls hidden>'+''.join('<span data-field="'+k+'">'+html.escape(v)+'</span>' for k,v in controls.items())+'</div>'
 s=s.replace('<body>','<body>'+hidden)
 s=s.replace('</head>','<style>'+common+(bar if name.startswith('bar/') else '')+'[data-fit]{padding-top:12px;padding-bottom:12px}.date .d{min-height:90px}.date .h{min-height:110px}.mark .placeholder{display:block;font-size:68px;line-height:1.3}'+ '</style></head>')
 s=s.replace('</body>','<script>'+runtime+'</script><script defer src="/templates/_native-image-carousel.js"></script></body>')
 (root/rel).write_text(s)
 print(rel)
