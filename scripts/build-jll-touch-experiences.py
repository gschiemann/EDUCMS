"""Three touch experiences derived from the user's approved overview directions.

Uses existing native media, V14 edit shim, text layout and QR contracts. No new
CMS control type, remote content dependency or customer data write is needed.
"""
from pathlib import Path
import importlib.util, json, shutil, subprocess

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('directions',ROOT/'scripts/build-jll-design-directions.py')
d=importlib.util.module_from_spec(spec);spec.loader.exec_module(d)
cre=d.cre
TARGET=cre.PUBLIC/'templates/custom/jll-touch-experiences'
TARGET.mkdir(parents=True,exist_ok=True)
NEW='/templates/custom/jll-overview-directions/_assets/'
OLD=cre.ASSET_URL
field=d.field

def button(key,text,attrs='',primary=False,graphic=''):
    return '<button type="button" class="control'+(' primary-control' if primary else '')+'" '+attrs+'>'+graphic+field(key,text,tag='span')+'</button>'

def media(key,files,cls='',fit='cover',film=False):
    urls=[f if f.startswith('/') else NEW+f for f in files]
    markup=cre.image(key,None,cls,fit,label=key.replace('.',' '))
    cre.MEDIA[key].update(slides=json.dumps(urls),mode='carousel' if len(urls)>1 else 'single',fit=fit)
    if urls: markup=markup.replace('data-img=""','data-img="'+urls[0]+'"').replace('class="slot ','class="slot has-img ').replace('style="','style="background-image:url('+urls[0]+');')
    if film: markup=markup[:-6]+d.video()+'</div>'
    return markup

def gallery_files(branded):
    return ['architecture.jpg','workplace.jpg','reception.jpg'] if branded else ['generic-architecture.jpg',OLD+'workspace.jpg',OLD+'lobby.jpg']

SECTIONS=[('home','Home'),('amenities','Amenities'),('plans','Plans'),('location','Location'),('details','Details'),('gallery','Gallery'),('contact','Contact')]
ICONS={
 'back':'<path d="M20 12H4m7-7-7 7 7 7"/>',
 'home':'<path d="m3 10 9-7 9 7v11h-7v-7h-4v7H3z"/>',
 'amenities':'<path d="M4 9h12v6a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5zM16 9h2a3 3 0 0 1 0 6h-2M7 3v3M12 3v3"/>',
 'plans':'<path d="M3 3h18v18H3zM3 11h8V3M11 11v10M11 15h10"/>',
 'location':'<path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/>',
 'details':'<path d="M5 3h14v18H5zM9 8h6M9 12h6M9 16h4"/>',
 'gallery':'<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8" cy="8" r="1"/><path d="m3 18 6-6 4 4 3-3 5 5"/>',
 'contact':'<path d="M21 4H3v13h5l4 4 4-4h5zM7 9h10M7 12h6"/>'
}
def icon(key):
    return '<svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+ICONS[key]+'</svg>'


def home(branded,variant):
    name='One\nLiverpool\nStreet' if branded else 'Harbor\nExchange'
    visual=media('property.hero',gallery_files(branded),'home-media',film=True)
    copy='<div class="home-copy">'+field('home.eyebrow','Touch to explore','kicker')+field('home.title',name,'home-heading','h1')+field('home.address','London · EC2M' if branded else '100 Waterfront Avenue','home-address')+'</div>'
    fact='<div class="home-fact">'+field('home.area','19,570' if branded else '19,500','big-number')+field('home.areaLabel','sq ft available','body-copy')+'</div>'
    actions='<div class="home-actions">'+button('home.begin','Begin tour','data-go="amenities"',True)+button('home.plans','View plans','data-go="plans"')+'</div>'
    story='<div class="portrait-story">'+media('property.portraitStory',['workplace.jpg' if branded else OLD+'workspace.jpg'],'story-photo')+field('home.story','Space for a better\nworking day.','story-heading','h2')+'</div>' if variant!='a' else ''
    if variant=='c':
        entries=[('amenities','Amenities','A better working day'),('plans','Floor plans','Explore every level'),('location','Location','Your neighborhood'),('details','Details','Specifications & leasing'),('gallery','Gallery','See the whole property'),('contact','Contact','Take the next step')]
        hub='<div class="hub-grid">'+''.join('<button type="button" class="hub-item" data-go="'+key+'">'+field('hub.'+key+'.title',label,'hub-title','span')+field('hub.'+key+'.detail',desc,'hub-detail','span')+'<span class="hub-arrow" aria-hidden="true">↗</span></button>' for key,label,desc in entries)+'</div>'
        return visual+'<div class="home-shade"></div>'+copy+hub+story
    return visual+'<div class="home-shade"></div>'+copy+fact+actions+story

def amenities(branded):
    options=[('Social','A place to\ncome together.','Café, shared lounges and spaces for events and everyday conversations.','reception.jpg' if branded else OLD+'lobby.jpg'),('Wellbeing','Space to\nrecharge.','Wellness areas and facilities for cycling and showering support the working day.','architecture-2.jpg' if branded else OLD+'office.jpg'),('Workspaces','A different\nway to work.','Co-working areas, a library and presentation spaces bring more choice to the office.','workplace.jpg' if branded else OLD+'workspace.jpg')]
    content=field('amenities.title','A better working day.','page-heading','h1')+'<div class="amenity-tabs">'+''.join(button('amenity.'+str(i)+'.tab',o[0],f'data-amenity="{i}" aria-pressed="'+('true' if i==0 else 'false')+'"') for i,o in enumerate(options))+'</div>'
    for i,(tab,title,copy,photo) in enumerate(options):
        content+='<article data-amenity-panel="'+str(i)+'"'+(' hidden' if i else '')+'>'+media('amenity.'+str(i)+'.photo',[photo],'amenity-photo')+'<div class="amenity-copy">'+field('amenity.'+str(i)+'.title',title,'section-heading','h2')+field('amenity.'+str(i)+'.copy',copy,'body-copy')+'</div></article>'
    return content

def plans(branded):
    names=['Ground','Level 1','Level 2','Levels 3–6','Level 7','Level 8','Level 9','Level 10'] if branded else ['Ground']+['Level '+str(i) for i in range(1,8)]
    files=['plan-'+name+'.jpg' for name in ['ground','level-1','level-2','level-3-to-6','level-7','level-8','level-9','level-10']] if branded else [OLD+('plan-office.svg' if i%2==0 else 'plan-flex.svg') for i in range(8)]
    out=field('plans.title','Explore the floor plans.','page-heading','h1')+button('plans.availability','Check availability','data-go="contact"')
    out+='<div class="floor-rail">'+field('plans.select','Select a level','floor-label')+''.join(button('floor.'+str(i)+'.name',n,f'data-floor="{i}" aria-pressed="'+('true' if i==0 else 'false')+'"') for i,n in enumerate(names))+'</div>'
    out+='<div class="plan-window" tabindex="0" aria-label="Floor plan viewer; use zoom controls, then drag to pan"><div class="plan-canvas">'+''.join('<div data-floor-panel="'+str(i)+'"'+(' hidden' if i else '')+'>'+media('plan.'+str(i),[file],'plan-art','contain')+'</div>' for i,file in enumerate(files))+'</div></div>'
    out+='<div class="plan-controls">'+button('plans.zoomOut','−','data-zoom="out" aria-label="Zoom out"')+field('plans.zoom','100%','zoom-value')+button('plans.zoomIn','+','data-zoom="in" aria-label="Zoom in"')+button('plans.fit','Fit plan','data-zoom="fit"')+'</div>'
    out+=field('plans.note','Confirm availability\nwith JLL.' if branded else 'Sample plans.\nUpload final drawings.','plan-note body-copy')
    out+=field('plans.help','Drag to explore.','plan-help body-copy')
    return out

def location(branded):
    return field('location.title','A connected address.','page-heading','h1')+media('location.photo',['architecture-2.jpg' if branded else 'generic-architecture.jpg'],'location-photo')+'<div class="location-copy">'+field('location.heading','Liverpool\nStreet' if branded else 'Connected\nto the city.','section-heading','h2')+field('location.copy','Liverpool Street station\nand the Elizabeth line.' if branded else 'Your workplace.\nYour neighborhood.','body-copy')+'<div class="location-address">'+field('location.label','Find us','kicker')+field('location.address','London EC2M 7PP' if branded else '100 Waterfront Avenue\nSample City','body-copy')+'</div></div>'

def details(branded):
    rows=[('Available space','19,570 sq ft' if branded else '19,500 sq ft'),('Total building','170,416 sq ft' if branded else '170,000 sq ft'),('Property use','Office'),('Leasing terms','Contact the team'),('Building systems','Smart management'),('Amenities','Work & wellbeing')]
    return field('details.title','The details that matter.','page-heading','h1')+'<div class="details-grid">'+''.join('<div class="detail">'+field('detail.'+str(i)+'.label',k,'detail-label')+field('detail.'+str(i)+'.value',v,'detail-value')+'</div>' for i,(k,v) in enumerate(rows))+'</div>'+field('details.note','Contact the team for the full specification.','details-note body-copy')

def contact(branded):
    url='https://property.jll.co.uk/listings/1-liverpool-street' if branded else 'https://example.com/property'
    return '<div class="contact-copy">'+field('contact.title','The full story.\nOn your phone.','page-heading','h1')+field('contact.copy','Scan for the property listing, brochure and leasing team. Continue the conversation when you’re ready.','body-copy')+field('broker.team','JLL · City office leasing' if branded else 'Meridian · Leasing team','broker-team')+'</div><div class="contact-qr" data-qr="contact.url" role="img" aria-label="Scan for the property listing"></div>'+field('contact.scan','Scan to take the next step.','contact-caption')+'<div hidden>'+field('contact.url',url)+'</div>'

def gallery(branded):
    labels=['Architecture','Workplace','Reception']
    return field('gallery.title','Picture yourself here.','page-heading','h1')+''.join('<div data-gallery-panel="'+str(i)+'"'+(' hidden' if i else '')+'>'+media('gallery.'+str(i),[file],'gallery-photo')+'</div>' for i,file in enumerate(gallery_files(branded)))+'<div class="gallery-tabs">'+''.join(button('gallery.'+str(i)+'.label',label,'data-gallery="'+str(i)+'" aria-pressed="'+('true' if i==0 else 'false')+'"') for i,label in enumerate(labels))+'</div><div class="gallery-controls">'+button('gallery.previous','← Previous','data-gallery-step="-1"')+field('gallery.count','1 / 3','gallery-count')+button('gallery.next','Next →','data-gallery-step="1"')+'</div>'

def scene(branded,variant):
    header='<div class="app-header">'+cre.logo(branded)+field('property.name','One Liverpool Street' if branded else 'Harbor Exchange','header-name')+button('app.back','← Back','data-back disabled')+button('app.restart','Start over','data-restart')+'</div>'
    builders=[('home',lambda:home(branded,variant)),('amenities',lambda:amenities(branded)),('plans',lambda:plans(branded)),('location',lambda:location(branded)),('details',lambda:details(branded)),('contact',lambda:contact(branded)),('gallery',lambda:gallery(branded))]
    pages=''.join('<section class="experience-page page-'+key+'" data-page="'+key+'"'+(' hidden' if key!='home' else '')+'>'+fn()+'</section>' for key,fn in builders)
    nav='<nav class="app-nav" aria-label="Property sections">'+''.join(button('nav.'+key,label,'data-go="'+key+'"'+(' aria-current="page"' if key=='home' else ''),graphic=icon(key)) for key,label in SECTIONS)+button('nav.back','Back','data-back disabled',graphic=icon('back'))+'</nav>'
    config='<div hidden>'+field('tour.idleSeconds','120')+field('tour.startPage','home')+field('video.autoplay','yes')+field('video.loop','yes')+field('media.property.film.fit','cover')+field('media.property.film.position','center')+'</div>'
    return header+pages+nav+config

CSS=r'''
.experience{background:var(--paper);color:var(--ink)}
.experience .app-header{position:absolute;left:120px;right:120px;top:75px;height:190px;border-bottom:2px solid var(--line)}
.experience .logo{width:380px;height:150px}.experience .wordmark{width:680px;height:150px}.experience .brand-name{font-size:calc(108px * var(--scale))}.experience .brand-descriptor{display:none}
.experience .header-name{position:absolute;left:740px;top:25px;font:600 calc(104px * var(--scale))/1.15 var(--f-head);max-width:2130px;max-height:125px}
.experience .app-header>.control{position:absolute;right:0;top:0;width:530px}
.experience .control{min-height:160px;padding:25px 45px;background:var(--paper);color:var(--ink);border:3px solid var(--line);font:600 calc(96px * var(--scale))/1.1 var(--f-body);text-align:center;border-radius:0;display:flex;align-items:center;justify-content:center;gap:20px}
.experience .control span{display:block;max-height:230px}
.experience .control:hover,.experience .control[aria-pressed=true]{background:var(--accent2);border-color:var(--ink)}
.experience .primary-control,.experience .primary-control:hover{background:var(--brand);border-color:var(--brand);color:var(--inverse)}
.experience .control:disabled{opacity:.35;cursor:default}
.experience .experience-page{position:absolute;left:120px;top:355px;width:3600px;height:1500px}
.experience .app-nav{position:absolute;left:120px;right:120px;bottom:70px;height:175px;display:grid;grid-template-columns:repeat(6,1fr);gap:20px}
.experience .app-nav .control{border:0;border-top:8px solid var(--line);background:var(--paper);padding:25px 16px}
.experience .app-nav [aria-current=page]{border-top-color:var(--brand);color:var(--brand)}
.experience .page-heading{font:600 calc(196px * var(--scale))/1.05 var(--f-display);letter-spacing:-.03em;white-space:pre-line;max-height:430px}
.experience .section-heading{font:600 calc(185px * var(--scale))/1.06 var(--f-display);letter-spacing:-.025em;white-space:pre-line;max-height:620px;margin-bottom:65px}
.experience .body-copy{font:400 calc(104px * var(--scale))/1.28 var(--f-body);white-space:pre-line;max-height:620px}
.experience .kicker{font:600 calc(96px * var(--scale))/1.15 var(--f-body);color:var(--brand);max-height:240px}
.experience .home-media{position:absolute;left:1540px;top:0;width:2060px;height:1500px}
.experience .home-copy{position:absolute;left:0;top:20px;width:1420px}
.experience .home-heading{font:600 calc(244px * var(--scale))/1.02 var(--f-display);letter-spacing:-.035em;white-space:pre-line;margin-top:50px;max-height:800px}
.experience .home-address{font:400 calc(108px * var(--scale))/1.15 var(--f-body);margin-top:45px;max-height:250px}
.experience .home-fact{position:absolute;left:0;top:1120px;display:flex;align-items:baseline;gap:45px}
.experience .big-number{font:600 calc(150px * var(--scale))/1 var(--f-display);max-height:200px}
.experience .home-fact .body-copy{font-size:calc(96px * var(--scale))}
.experience .home-actions{position:absolute;left:0;bottom:0;width:1420px;display:grid;grid-template-columns:1fr 1fr;gap:25px}
.experience .home-actions .control{min-height:190px}
.experience .home-shade{display:none;pointer-events:none}
.experience.b .home-media{left:0;width:3600px}
.experience.b .home-shade{display:block;position:absolute;top:0;left:0;width:3600px;height:1500px;background:linear-gradient(90deg,var(--shade),var(--shade) 40%,transparent 78%)}
.experience.b .home-copy{left:100px;top:85px;color:var(--inverse)}
.experience.b .home-copy .kicker{color:var(--inverse)}
.experience.b .home-heading{font-size:calc(254px * var(--scale))}
.experience.b .home-fact{display:none}
.experience.b .home-actions{left:100px;bottom:85px}
.experience.c .home-media{left:0;width:1660px}
.experience.c .home-shade{display:block;position:absolute;top:0;left:0;width:1660px;height:1500px;background:linear-gradient(0deg,var(--shade),var(--shade) 80%)}
.experience.c .home-copy{left:95px;top:auto;bottom:90px;width:1470px;color:var(--inverse)}
.experience.c .home-copy .kicker{color:var(--inverse)}
.experience.c .home-heading{font-size:calc(225px * var(--scale))}
.experience .hub-grid{position:absolute;left:1790px;top:0;width:1810px;height:1500px;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));grid-template-rows:repeat(3,minmax(0,1fr));gap:30px}
.experience .hub-item{position:relative;min-height:0;min-width:0;background:var(--paper);border:3px solid var(--line);border-top:12px solid var(--brand);padding:45px;text-align:left}
.experience .hub-item:hover{background:var(--accent2)}
.experience .hub-title{display:block;font:600 calc(118px * var(--scale))/1.05 var(--f-head);max-height:260px;margin-bottom:25px}
.experience .hub-detail{display:block;font:400 calc(96px * var(--scale))/1.2 var(--f-body);max-height:240px}
.experience .hub-arrow{position:absolute;right:35px;top:28px;color:var(--brand);font-size:85px}
.experience .amenity-tabs{position:absolute;left:0;top:285px;display:grid;grid-template-columns:repeat(3,1fr);width:2230px;gap:25px}
.experience .amenity-photo{position:absolute;left:0;top:505px;width:2230px;height:995px}
.experience .amenity-copy{position:absolute;left:2370px;top:390px;width:1230px}
.experience .page-plans>.control{position:absolute;right:0;top:15px;width:950px}
.experience .page-plans>.page-heading{max-width:2520px;font-size:calc(180px * var(--scale))}
.experience .floor-rail{position:absolute;left:2610px;top:305px;width:990px}
.experience .floor-label{font:600 calc(110px * var(--scale))/1.1 var(--f-head);margin-bottom:30px;max-height:140px}
.experience .floor-rail .control{width:990px;margin-bottom:20px;min-height:150px}
.experience .plan-window{position:absolute;left:0;top:305px;width:2450px;height:995px;background:var(--bg);overflow:auto;touch-action:pan-x pan-y;cursor:grab;border:2px solid var(--line)}
.experience .plan-window.dragging{cursor:grabbing;touch-action:none}
.experience .plan-canvas{position:relative;width:2450px;height:995px}
.experience [data-floor-panel],.experience .plan-art{position:absolute;top:0;left:0;width:100%;height:100%;background-color:var(--paper)}
.experience .plan-controls{position:absolute;left:0;top:1350px;display:flex;align-items:center;gap:25px}
.experience .plan-controls .control{min-width:200px}
.experience .zoom-value{font:600 calc(104px * var(--scale))/1 var(--f-body);width:310px;text-align:center;max-height:130px}
.experience .plan-note{position:absolute;left:2610px;top:1220px;width:990px;font-size:calc(96px * var(--scale))}
.experience .plan-help{position:absolute;left:1400px;top:1400px;width:1050px;text-align:right;font-size:calc(96px * var(--scale))}
.experience .location-photo{position:absolute;left:0;top:315px;width:2280px;height:1185px}
.experience .location-copy{position:absolute;left:2420px;top:315px;width:1180px}
.experience .location-copy .section-heading{font-size:calc(170px * var(--scale));margin-bottom:45px}
.experience .location-address{margin-top:60px;padding-top:35px;border-top:3px solid var(--line)}
.experience .location-address .kicker{margin-bottom:20px}
.experience .details-grid{position:absolute;left:0;top:325px;width:3600px;display:grid;grid-template-columns:1fr 1fr;gap:35px 150px}
.experience .detail{border-top:3px solid var(--line);padding-top:25px;min-height:285px}
.experience .detail-label{font:400 calc(96px * var(--scale))/1.15 var(--f-body);max-height:250px;margin-bottom:22px}
.experience .detail-value{font:600 calc(140px * var(--scale))/1.08 var(--f-display);max-height:355px}
.experience .details-note{position:absolute;left:0;top:1390px;width:3550px;font-size:calc(96px * var(--scale))}
.experience .contact-copy{position:absolute;left:0;top:90px;width:1880px}
.experience .contact-copy .page-heading{font-size:calc(245px * var(--scale));max-height:850px}
.experience .contact-copy .body-copy{margin-top:80px;width:1700px}
.experience .broker-team{font:600 calc(110px * var(--scale))/1.2 var(--f-head);margin-top:110px;max-height:260px;color:var(--brand)}
.experience .contact-qr{position:absolute;left:2330px;top:155px;width:1080px;height:1080px;background-size:contain;background-repeat:no-repeat;background-color:var(--paper)}
.experience .contact-caption{position:absolute;left:2200px;top:1320px;width:1350px;text-align:center;font:600 calc(104px * var(--scale))/1.2 var(--f-body);max-height:250px}
.experience .gallery-photo{position:absolute;left:0;top:295px;width:3600px;height:965px}
.experience .gallery-tabs{position:absolute;left:0;top:1320px;display:flex;gap:25px}
.experience .gallery-tabs .control{min-width:600px}
.experience .gallery-controls{position:absolute;right:0;top:1320px;display:flex;align-items:center;gap:35px}
.experience .gallery-count{font:400 calc(100px * var(--scale))/1.2 var(--f-body);max-height:145px;min-width:250px;text-align:center}
'''

CSS+=r'''
/* Direct, touch-first navigation: every destination and floor stays visible. */
.experience .control{border-radius:36px;transition:background-color .18s,color .18s,transform .12s;touch-action:manipulation}
.experience .control:active:not(:disabled),.experience .hub-item:active{transform:scale(.975)}
.experience button:focus-visible{outline:8px solid var(--brand);outline-offset:8px}
.experience .app-header>.control[data-back]{right:580px;width:430px}
.experience .header-name{max-width:1770px}
.experience .app-nav{bottom:50px;height:240px;grid-template-columns:repeat(7,minmax(0,1fr));gap:8px;padding:16px;background:var(--accent2);border-radius:64px}
.experience .app-nav .control{min-width:0;border:0;border-radius:48px;background:transparent;padding:20px 10px;flex-direction:column;gap:14px}
.experience .nav-icon{width:66px;height:66px;flex:none}
.experience .app-nav [aria-current=page]{background:var(--brand);color:var(--inverse)}
.experience .app-nav .control:hover:not([aria-current]){background:var(--paper)}
.experience .app-nav .control span{max-height:110px}
.experience .experience-page:not([hidden]){animation:page-enter .22s ease-out both}
@keyframes page-enter{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}
.experience .home-media,.experience .amenity-photo,.experience .location-photo,.experience .gallery-photo,.experience .home-shade{border-radius:48px;overflow:hidden}
.experience .home-actions .control{border-radius:44px}
.experience .hub-item{border-radius:36px;border:3px solid var(--line);border-top:3px solid var(--line);transition:background-color .18s,transform .12s;display:flex;flex-direction:column;align-items:flex-start;justify-content:flex-start;padding-top:45px}
.experience .hub-arrow{top:auto;bottom:24px;right:30px;font-size:72px}
.experience .floor-rail{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:20px}
.experience .floor-label{grid-column:1/-1;margin-bottom:10px}
.experience .floor-rail .control{width:auto;min-height:190px;margin:0;padding:22px 14px}
.experience .floor-rail .control[aria-pressed=true],.experience .amenity-tabs .control[aria-pressed=true],.experience .gallery-tabs .control[aria-pressed=true]{background:var(--brand);color:var(--inverse);border-color:var(--brand)}
.experience .plan-note{top:1280px}
.experience .plan-window{border-radius:36px}
.experience .plan-controls{top:1320px;padding:12px;border-radius:48px;background:var(--accent2)}
.experience .plan-controls .control{background:var(--paper);border-color:transparent}
.experience .plan-help{top:1370px}
@media(prefers-reduced-motion:reduce){.experience .experience-page:not([hidden]){animation:none}.experience .control,.experience .hub-item{transition:none}}
'''

CSS+=r'''
.experience .portrait-story,.experience .app-nav [data-back]{display:none}
/* Portrait kiosk: navigation stays in the middle, with local controls nearby.
   Screen mounting height still determines the physical reach of this band. */
.experience.portrait .app-header{top:90px;height:200px}
.experience.portrait .header-name{left:740px;top:25px;width:1180px;max-width:1180px;font-size:calc(100px * var(--scale));max-height:135px}
.experience.portrait .app-header>.control{display:none}
.experience.portrait .experience-page{left:120px;top:390px;width:1920px;height:3330px}
.experience.portrait .app-nav{top:1660px;bottom:auto;height:440px;grid-template-columns:repeat(4,minmax(0,1fr));gap:16px;padding:16px;border-radius:52px;z-index:5}
.experience.portrait .app-nav .control{font-size:calc(96px * var(--scale));padding:12px 8px;gap:10px;min-height:0}
.experience.portrait .app-nav [data-back]{display:flex}
.experience.portrait .page-heading{font-size:calc(180px * var(--scale));max-height:245px;white-space:nowrap}
.experience.portrait .home-media{left:0;top:0;width:1920px;height:970px}
.experience.portrait .home-copy{left:0;top:1900px;width:1920px}
.experience.portrait .home-heading{font-size:calc(252px * var(--scale));white-space:normal;max-height:800px;margin-top:45px}
.experience.portrait .home-address{font-size:calc(112px * var(--scale));max-height:270px;margin-top:45px}
.experience.portrait .home-fact{left:0;top:2930px;gap:50px;display:flex;align-items:baseline}
.experience.portrait .home-fact .big-number{font-size:calc(200px * var(--scale))}
.experience.portrait .home-actions{left:0;top:1030px;bottom:auto;width:1920px;gap:30px}
.experience.portrait .home-actions .control{min-height:190px}
.experience.b.portrait .home-media,.experience.c.portrait .home-media{height:1220px}
.experience.b.portrait .home-shade,.experience.c.portrait .home-shade{top:0;left:0;width:1920px;height:1220px;background:linear-gradient(90deg,var(--shade),var(--shade) 30%,transparent)}
.experience.b.portrait .home-copy,.experience.c.portrait .home-copy{left:90px;top:150px;bottom:auto;width:1740px}
.experience.b.portrait .home-heading,.experience.c.portrait .home-heading{font-size:calc(225px * var(--scale));max-height:750px}
.experience.b.portrait .home-fact,.experience.b.portrait .home-actions,.experience.c.portrait .hub-grid{display:none}
.experience.portrait .portrait-story{display:block;position:absolute;left:0;top:1900px;width:1920px}
.experience.portrait .story-photo{width:1920px;height:920px;border-radius:48px;overflow:hidden}
.experience.portrait .story-heading{font:600 calc(180px * var(--scale))/1.08 var(--f-display);letter-spacing:-.025em;max-height:400px;margin-top:60px;white-space:pre-line}
.experience.portrait .amenity-photo{left:0;top:300px;width:1920px;height:900px}
.experience.portrait .amenity-tabs{top:1760px;width:1920px;gap:25px}
.experience.portrait .amenity-copy{left:0;top:2220px;width:1920px}
.experience.portrait .section-heading{font-size:calc(190px * var(--scale));max-height:450px;margin-bottom:55px}
.experience.portrait .amenity-copy .body-copy{font-size:calc(112px * var(--scale));max-height:550px}
.experience.portrait .page-plans>.page-heading{max-width:1920px;font-size:calc(180px * var(--scale))}
.experience.portrait .page-plans>.control{display:none}
.experience.portrait .plan-window{left:0;top:300px;width:1920px;height:900px}
.experience.portrait .plan-canvas{width:1920px;height:900px}
.experience.portrait .floor-rail{left:0;top:1760px;width:1920px;grid-template-columns:repeat(4,minmax(0,1fr));gap:20px}
.experience.portrait .floor-label{display:none}
.experience.portrait .floor-rail .control{width:auto;min-height:180px;padding:18px 12px}
.experience.portrait .plan-controls{left:0;top:2190px;width:1920px;justify-content:center;gap:45px}
.experience.portrait .plan-note{left:0;top:2740px;width:1920px;font-size:calc(112px * var(--scale));max-height:300px}
.experience.portrait .plan-help{display:block;left:0;top:3150px;width:1920px;text-align:left;font-size:calc(104px * var(--scale))}
.experience.portrait .location-photo{left:0;top:300px;width:1920px;height:900px}
.experience.portrait .location-copy{left:0;top:1930px;width:1920px}
.experience.portrait .location-copy .section-heading{white-space:normal;max-height:245px}
.experience.portrait .location-copy .body-copy{font-size:calc(112px * var(--scale))}
.experience.portrait .location-address{margin-top:100px;padding-top:70px}
.experience.portrait .location-address .kicker{margin-bottom:40px}
.experience.portrait .details-grid{left:0;top:0;width:1920px;display:block}
.experience.portrait .detail{position:absolute;width:920px;min-height:400px;padding-top:45px}
.experience.portrait .detail:nth-child(odd){left:0}.experience.portrait .detail:nth-child(even){left:1000px}
.experience.portrait .detail:nth-child(-n+2){top:330px}
.experience.portrait .detail:nth-child(n+3):nth-child(-n+4){top:790px}
.experience.portrait .detail:nth-child(n+5){top:2130px}
.experience.portrait .detail-value{font-size:calc(144px * var(--scale));max-height:355px}
.experience.portrait .details-note{left:0;top:2880px;width:1920px;max-height:250px}
.experience.portrait .contact-copy{left:0;top:0;width:1920px}
.experience.portrait .contact-copy .page-heading{font-size:calc(230px * var(--scale));white-space:pre-line;max-height:700px}
.experience.portrait .contact-copy .body-copy{margin-top:60px;width:1920px;font-size:calc(108px * var(--scale));max-height:520px}
.experience.portrait .broker-team{margin-top:55px;max-height:150px}
.experience.portrait .contact-qr{left:430px;top:1890px;width:1060px;height:1060px}
.experience.portrait .contact-caption{left:0;top:3060px;width:1920px;max-height:250px}
.experience.portrait .gallery-photo{left:0;top:300px;width:1920px;height:2950px}
.experience.portrait .gallery-tabs{left:0;top:1760px;width:1920px;display:grid;grid-template-columns:repeat(3,1fr);gap:25px;padding:20px;background:var(--paper);border-radius:44px}
.experience.portrait .gallery-tabs .control{min-width:0;padding:25px 18px}
.experience.portrait .gallery-controls{left:0;right:0;top:2020px;padding:20px;justify-content:space-between;background:var(--paper);border-radius:44px}
'''

CSS+=r'''
.experience.c.portrait .home-media{left:980px;width:940px}
.experience.c.portrait .home-shade{display:none}
.experience.c.portrait .home-copy{left:0;top:70px;width:880px;color:var(--ink)}
.experience.c.portrait .home-copy .kicker{color:var(--brand)}
.experience.c.portrait .home-heading{font-size:calc(205px * var(--scale));white-space:pre-line;max-height:750px}
.experience.c.portrait .home-address{font-size:calc(104px * var(--scale));max-height:250px}
'''

RUNTIME=(ROOT/'scripts/commercial-property-touch.js').read_text()
rows=[]
for variant,name in [('a','Guided property tour'),('b','Immersive property showcase'),('c','Leasing information hub')]:
    for branded in [True,False]:
        cre.BUILDERS['experience']=lambda b:scene(b,variant)
        slug=('jll' if branded else 'generic')+'-'+variant
        result=cre.document(slug,name,'experience',branded)
        result=result.replace('class="stage experience"','class="stage experience '+variant+'"')
        result=result.replace('</style>',CSS+d.VIDEO_CSS+'</style>',1)
        result=result.replace('</body>','<script src="'+OLD+'qr-code.js"></script><script>'+RUNTIME+'</script><script>'+d.VIDEO_RUNTIME+'</script></body>')
        result=result.replace('>#19282d</p>','>#171c20</p>')
        (TARGET/(slug+'.html')).write_text(result)
        rows.append({'id':slug,'name':name,'brand':'JLL' if branded else 'Generic','url':'/templates/custom/jll-touch-experiences/'+slug+'.html','touchEnabled':True,'idleResetMs':120000})
for script in ['inject-shim-v2.cjs','inject-click-shim.cjs']:
    subprocess.run(['node',str(ROOT/'apps/web/scripts'/script),'custom/jll-touch-experiences'],check=True,cwd=ROOT)
review=ROOT/'scratch/design/jll-touch';review.mkdir(parents=True,exist_ok=True)
for r in rows:
    source=cre.PUBLIC/r['url'].lstrip('/')
    source.write_text('\n'.join(line.rstrip() for line in source.read_text().splitlines())+'\n')
    shutil.copy2(source,review/(r['id']+'.html'))
(review/'experiences.json').write_text(json.dumps(rows,indent=2)+'\n')
print(json.dumps({'touchTemplates':len(rows),'pagesEach':7,'orientations':2}))
