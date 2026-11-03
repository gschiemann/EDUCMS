"""Build approved Guest Essentials compositions with business-specific default copy.

Layout sources remain the owner-approved November 1 studies. All generated boards
are independent static URLs so gallery posters show the correct business defaults.
"""
from pathlib import Path
import html, json, re, sys

ROOT = Path(sys.argv[1]).resolve()
STUDIES = ROOT / 'docs/design/proposals/2026-11-01-guest-essentials'
DEST = ROOT / 'apps/web/public/templates/signage/essentials'
RUNTIME = Path(__file__).with_name('essentials-runtime.js').read_text()
DESIGNS = [('a-the-guest-edit', 'The Guest Edit', '#f3efe5'), ('b-easy-days', 'Easy Days', '#f8f0df'), ('c-city-guide', 'City Guide', '#1e2928')]
CONTEXTS = {
  'hospitality': {'vertical':'HOSPITALITY', 'group':'Hospitality', 'label':'Guest Essentials', 'category':'INFO', 'copy':{}, 'photo':None},
  'corporate': {'vertical':'CORPORATE', 'group':'Corporate', 'label':'Visitor Essentials', 'category':'INFO',
    'photo':'/templates/signage/corporate/commercial-touch/assets/reference-workplace.png',
    'copy':{
      'brand.name':'ALDER WORKS', 'brand.descriptor':'VISITOR GUIDE', 'brand.note':'A GOOD DAY\nSTARTS HERE.',
      'hero.kicker':'YOUR VISIT, SIMPLIFIED', 'hero.title':'Welcome in.\nFind your way.', 'hero.intro':'A warm welcome.\nA clear next step.',
      'wifi.label':'GUEST WI-FI', 'wifi.value':'Alder Guest', 'wifi.detail':'Ask reception for today’s access code.',
      'breakfast.label':'ON ARRIVAL', 'breakfast.value':'Check in here', 'breakfast.detail':'Reception · Ground floor\nHave your host’s name ready.',
      'checkout.label':'YOUR MEETING', 'checkout.value':'Meet your host', 'checkout.detail':'Take a seat in the lobby.\nWe’ll let your host know.',
      'amenities.label':'WHILE YOU WAIT', 'amenities.value':'Make yourself at home', 'amenities.detail':'Water & coffee · Lobby\nRestrooms · East corridor',
      'shuttle.label':'BEFORE YOU LEAVE', 'shuttle.value':'Return your badge', 'shuttle.detail':'Reception · Ask about parking validation',
      'help.label':'NEED A HAND?', 'help.value':'Talk to reception', 'help.detail':'Step-free entrance · East doors',
      'guide.title':'Your visit, made easy', 'guide.tag':'WELCOME IN', 'photo.seal':'Good\ndays.', 'photo.caption':'Room to\nconnect.'}},
  'gym': {'vertical':'GYM', 'group':'Gym', 'label':'First Visit', 'category':'FITNESS',
    'photo':'/templates/signage/gym/assets/club-floor-hero-v1.png',
    'copy':{
      'brand.initial':'M', 'brand.name':'MOVE CLUB', 'brand.descriptor':'YOUR FIRST VISIT', 'brand.note':'YOUR PACE.\nYOUR PLACE.',
      'hero.kicker':'A GOOD PLACE TO START', 'hero.title':'Start here.\nFeel at home.', 'hero.intro':'New to the club?\nWe’ll show you around.',
      'wifi.label':'CHECK IN', 'wifi.value':'Say hello', 'wifi.detail':'Have your membership\nor guest pass ready.',
      'breakfast.label':'GET SETTLED', 'breakfast.value':'Lockers & towels', 'breakfast.detail':'Changing rooms · Level 1\nAsk the team for a locker.',
      'checkout.label':'MEET YOUR COACH', 'checkout.value':'Book an intro', 'checkout.detail':'Our team can help you\nfind your starting point.',
      'amenities.label':'EXPLORE THE CLUB', 'amenities.value':'Find your floor', 'amenities.detail':'Strength · Ground floor\nStudios · Level 1',
      'shuttle.label':'YOUR NEXT CLASS', 'shuttle.value':'Find your session', 'shuttle.detail':'See the class board · Book at the front desk',
      'help.label':'WE’RE HERE FOR YOU', 'help.value':'Ask the club team', 'help.detail':'Access needs? Speak with reception.',
      'guide.title':'Your first visit', 'guide.tag':'START HERE', 'photo.seal':'Let’s\nmove.', 'photo.caption':'Find your\nrhythm.'}},
  'healthcare': {'vertical':'HEALTHCARE', 'group':'Healthcare', 'label':'Arrival Guide', 'category':'PATIENT',
    'photo':'/templates/signage/healthcare/assets/pexels-17829429.jpg',
    'copy':{
      'brand.name':'ALDER CARE', 'brand.descriptor':'PATIENT ARRIVAL', 'brand.note':'A LITTLE CLARITY.\nA WARM WELCOME.',
      'hero.kicker':'YOUR VISIT, ONE STEP AT A TIME', 'hero.title':'Arrive.\nWe’ll help.', 'hero.intro':'A few useful details\nbefore your visit.',
      'wifi.label':'FIRST, CHECK IN', 'wifi.value':'Visit reception', 'wifi.detail':'Let our team know you’re here for your appointment.',
      'breakfast.label':'YOUR DETAILS', 'breakfast.value':'What to have ready', 'breakfast.detail':'Appointment details · ID\nAny forms we sent you',
      'checkout.label':'WHILE YOU WAIT', 'checkout.value':'Take a seat', 'checkout.detail':'The team will let you know\nwhen it’s your turn.',
      'amenities.label':'FIND YOUR WAY', 'amenities.value':'Around the clinic', 'amenities.detail':'Restrooms · East corridor\nWater · Waiting area',
      'shuttle.label':'BEFORE YOU LEAVE', 'shuttle.value':'Your next step', 'shuttle.detail':'Ask reception about follow-up and appointment details',
      'help.label':'NEED ASSISTANCE?', 'help.value':'Please ask our team', 'help.detail':'Language or access needs? Let us know.',
      'guide.title':'Your arrival guide', 'guide.tag':'WELCOME', 'photo.seal':'Here\nfor you.', 'photo.caption':'A welcome\nwith care.'}}
}

def replace_field(source, key, value):
    pattern = r'(<[^>]+data-field="' + re.escape(key) + r'"[^>]*>)[^<]*(</[^>]+>)'
    return re.sub(pattern, lambda m: m[1] + html.escape(value) + m[2], source)

entries = []
for business, context in CONTEXTS.items():
    folder = DEST / business
    folder.mkdir(parents=True, exist_ok=True)
    for index, (slug, name, bg) in enumerate(DESIGNS):
        source = (STUDIES / (slug + '.html')).read_text()
        source = source.replace('<html lang=\"en\">','<html lang=\"en\" data-native-carousels=\"true\">')
        source = re.sub(r'<script>[\s\S]*?</script>', '', source)
        source = source.replace('assets/', '/templates/signage/corporate/commercial-touch/assets/')
        for filename, photo in [('lobby.jpg','hospitality-lobby-grand-room-v1.jpg'), ('pool.jpg','hospitality-lobby-goldenhour-pool-v1.jpg')]:
            source = source.replace('/templates/signage/corporate/commercial-touch/assets/' + filename, '/templates/signage/hospitality/assets/' + photo)
        for key, value in context['copy'].items():
            if index == 0 and key == 'brand.note':
                value = {'corporate':'WELCOME TO ALDER WORKS', 'gym':'YOUR PACE. YOUR PLACE.', 'healthcare':'WE’RE HERE TO HELP'}.get(business, value)
            if index == 2 and key == 'hero.title' and business == 'gym': value = 'Start here.\nMove well.'
            source = replace_field(source, key, value)
        if context['photo']:
            source = re.sub(r'data-img="[^"]+"', 'data-img="' + context['photo'] + '"', source)
        source = source.replace('aria-label="Hotel atmosphere"', 'aria-label="' + context['label'] + ' photograph"').replace('aria-label="Hotel logo"', 'aria-label="Organization logo"')
        # Section labels follow the editable labels; avoid stale hotel text in reused versions.
        source = re.sub(r'(<section class="info[^"]*") aria-label="[^"]*"', r'\1', source)
        source = source.replace('<div class="sun" aria-hidden="true">', '<div class="sun">')
        photo = re.search(r'data-imgslot="hero.photo" data-img="([^"]+)"', source).group(1)
        controls = {'carousel.autoplay':'yes', 'carousel.transition':'fade', 'carousel.intervalSeconds':'10',
            'media.hero.photo.fit':'cover', 'media.hero.photo.position':'50% 50%', 'media.hero.photo.alt':context['label'] + ' photograph',
            'media.hero.photo.mode':'single', 'media.hero.photo.slides':json.dumps([photo]),
            'media.brand.logo.fit':'contain', 'media.brand.logo.position':'center', 'media.brand.logo.alt':'Organization logo',
            'media.brand.logo.mode':'single', 'media.brand.logo.slides':'[]'}
        if business == 'healthcare': controls['media.hero.photo.position'] = '50% 25%'
        source = source.replace('<div class="viewport">', '<div data-controls hidden>' + ''.join('<span data-field="'+k+'">'+html.escape(v)+'</span>' for k,v in controls.items()) + '</div><div class="viewport">')
        # Host follows the authored photo frame; no container-level transform that could move text.
        source = source.replace('</style>', '.image-slot{position:relative}.logo{overflow:hidden}.logo-fallback{position:relative;z-index:1}.has-img .placeholder{display:none}</style>')
        source = re.sub(r'<title>.*?</title>', '<title>'+html.escape(context['label']+' · '+name)+'</title>', source)
        source = source.replace('</body>', '<script>'+RUNTIME+'</script><script defer src="/templates/_native-image-carousel.js"></script></body>')
        filename = slug[2:] + '.html'
        (folder / filename).write_text(source)
        entries.append({'business':business, 'vertical':context['vertical'], 'group':context['group'], 'name':context['label']+' · '+name, 'category':context['category'], 'bgColor':bg, 'id':'preset-essentials-'+business+'-'+slug[2:], 'url':'/templates/signage/essentials/'+business+'/'+filename})

(Path(__file__).with_name('essentials-catalog.json')).write_text(json.dumps(entries, indent=2)+'\n')
print('Built', len(entries), 'business boards from 3 approved compositions')
