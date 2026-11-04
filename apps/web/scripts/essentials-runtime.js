/* Guest Essentials: layout/fit only. Editing and carousels use the shipped CMS companions. */
(function () {
  var stage = document.querySelector('.stage');
  var params = new URLSearchParams(location.search);
  var forced = params.get('o') || params.get('orientation');
  var portrait = forced === 'portrait' || (forced !== 'landscape' && innerHeight > innerWidth);
  stage.setAttribute('data-orient', portrait ? 'portrait' : 'landscape');
  var width = portrait ? 2160 : 3840, height = portrait ? 3840 : 2160;
  stage.style.setProperty('--stage-w', width + 'px');
  stage.style.setProperty('--stage-h', height + 'px');
  var fields = Array.from(document.querySelectorAll('[data-field]'));
  var defaults = new Map(fields.map(function (el) { return [el, el.textContent]; }));
  var visible = Array.from(stage.querySelectorAll('[data-fit]'));
  var bases = new Map(visible.map(function (el) { return [el, parseFloat(getComputedStyle(el).fontSize)]; }));
  var authoredStyles = new Map(fields.map(function (el) { return [el, el.getAttribute('style') || '']; }));
  var manual = {};
  function decode(key) {
    try { return JSON.parse(decodeURIComponent(escape(atob((params.get(key) || '').replace(/-/g, '+').replace(/_/g, '/'))))); }
    catch (_) { return {}; }
  }
  manual = decode('textStyles');
  var tokens = { brand:'--brand', brand2:'--brand2', accent:'--accent', accent2:'--accent2', ink:'--ink', bg:'--bg', pos:'--pos', neg:'--neg', fDisplay:'--f-display', fBody:'--f-body', fMono:'--f-mono', scale:'--scale' };
  function theme() {
    fields.forEach(function (el) {
      var key = el.dataset.field;
      if (key.indexOf('theme.') !== 0) return;
      var token = key.slice(6), value = el.textContent.trim();
      if (tokens[token]) document.documentElement.style.setProperty(tokens[token], /^f[A-Z]/.test(token) ? '"' + value.replace(/["\\]/g, '') + '"' : value);
    });
  }
  function fit() {
    var scale = Number(getComputedStyle(stage).getPropertyValue('--scale')) || 1;
    visible.forEach(function (el) {
      var chosen = manual[el.dataset.field];
      if (chosen && chosen.fontSize != null) { el.style.fontSize = typeof chosen.fontSize === 'number' ? chosen.fontSize + 'px' : chosen.fontSize; return; }
      if (!el.clientWidth || !el.clientHeight) return;
      var floor = Number(el.dataset.fitMin) || 50;
      var size = Math.max(floor, bases.get(el) * scale);
      el.style.fontSize = size + 'px';
      function exceeds() {
        var box = el.getBoundingClientRect(), range = document.createRange();
        range.selectNodeContents(el); var text = range.getBoundingClientRect();
        return el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1 || text.right > box.right + 1 || text.left < box.left - 1 || text.top < box.top - 1 || text.bottom > box.bottom + 1;
      }
      while (size > floor && exceeds()) { size = Math.max(floor, size - 1); el.style.fontSize = size + 'px'; }
    });
    window.__essentialsReady = true;
  }
  function size() {
    var nextPortrait = forced === 'portrait' || (forced !== 'landscape' && innerHeight > innerWidth);
    if (nextPortrait !== portrait) {
      portrait = nextPortrait; width = portrait ? 2160 : 3840; height = portrait ? 3840 : 2160;
      stage.setAttribute('data-orient', portrait ? 'portrait' : 'landscape');
      stage.style.setProperty('--stage-w', width + 'px'); stage.style.setProperty('--stage-h', height + 'px');
      visible.forEach(function (el) { el.style.removeProperty('font-size'); bases.set(el, parseFloat(getComputedStyle(el).fontSize)); });
    }
    stage.style.setProperty('--stage-scale', Math.min(innerWidth / width, innerHeight / height)); fit();
  }
  var queued = false;
  function queue() { if (queued) return; queued = true; Promise.resolve().then(function () { queued = false; theme(); fit(); }); }
  // Restore removes an override; Remove is an explicit empty value. Keep these distinct.
  var previousText = new Set(), previousImages = new Set();
  function restoreMissing(data) {
    // Each message may carry only media, menu data or text. Omitted maps mean
    // unchanged; an explicit empty map is the editor's Restore command.
    if (Object.prototype.hasOwnProperty.call(data, 'text')) {
      var text = data.text || {};
      fields.forEach(function (el) {
        var key = el.dataset.field;
        if (previousText.has(key) && !Object.prototype.hasOwnProperty.call(text, key)) el.textContent = defaults.get(el);
      });
      previousText = new Set(Object.keys(text));
    }
    if (Object.prototype.hasOwnProperty.call(data, 'img')) {
      var images = data.img || {};
      previousImages.forEach(function (key) {
        if (Object.prototype.hasOwnProperty.call(images, key)) return;
        fields.forEach(function (el) { if (el.dataset.field === 'media.' + key + '.slides' || el.dataset.field === 'media.' + key + '.mode') el.textContent = defaults.get(el); });
      });
      previousImages = new Set(Object.keys(images));
    }
  }
  previousText = new Set(Object.keys(decode('text'))); previousImages = new Set(Object.keys(decode('img')));
  addEventListener('message', function (event) {
    if (event.source !== parent || !event.data || event.data.type !== 'educms-overrides') return;
    restoreMissing(event.data);
    var next = Object.prototype.hasOwnProperty.call(event.data, 'textStyles') ? event.data.textStyles || {} : manual;
    var styleProperties = { color:'color', fontSize:'font-size', fontWeight:'font-weight', bold:'font-weight', fontStyle:'font-style', italic:'font-style', fontFamily:'font-family', textDecoration:'text-decoration', underline:'text-decoration', strikethrough:'text-decoration', textAlign:'text-align', backgroundColor:'background-color', lineHeight:'line-height', hidden:'display', visibility:'visibility' };
    fields.forEach(function (el) {
      var key = el.dataset.field, before = manual[key] || {}, after = next[key] || {};
      Object.keys(before).forEach(function (property) {
        var css = styleProperties[property];
        if (!css || Object.keys(after).some(function (p) { return styleProperties[p] === css; })) return;
        var original = document.createElement('span'); original.setAttribute('style', authoredStyles.get(el));
        if (original.style.getPropertyValue(css)) el.style.setProperty(css, original.style.getPropertyValue(css));
        else el.style.removeProperty(css);
      });
    });
    manual = next; queue();
  });
  // Watch text/controls only; observing inline styles would loop on every fit.
  new MutationObserver(queue).observe(stage, { subtree:true, childList:true, characterData:true });
  new MutationObserver(queue).observe(document.querySelector('[data-widget="theme"]'), { subtree:true, childList:true, characterData:true });
  theme(); size();
  addEventListener('resize', size);
  addEventListener('DOMContentLoaded', queue);
  document.fonts.ready.then(queue);
  document.fonts.addEventListener('loadingdone', queue);
})();
