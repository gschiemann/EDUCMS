/* Preserve the original live clock/date keys without overriding operator copy. */
(function () {
  var overrides = {};
  try { var encoded = new URLSearchParams(location.search).get('text'); if (encoded) overrides = JSON.parse(decodeURIComponent(escape(atob(encoded.replace(/-/g,'+').replace(/_/g,'/'))))); } catch (_) {}
  function read(key, fallback) {
    var el = Array.from(document.querySelectorAll('[data-field]')).find(function (node) { return node.dataset.field === key; });
    return el ? el.textContent.trim() : fallback;
  }
  function tick() {
    if (read('clock.mode','live') !== 'live') return;
    var locale=read('clock.locale','en-US') || 'en-US', zone=read('clock.timeZone','');
    var time={hour:'numeric',minute:'2-digit',hour12:read('clock.hour12','yes') !== 'no'}, date={weekday:'long',month:'long',day:'numeric'};
    if(zone){time.timeZone=zone;date.timeZone=zone;}
    try {
      var now=new Date();
      document.querySelectorAll('[data-field="clock.hhmm"],[data-field="date.dow"]').forEach(function(el){
        var key=el.dataset.field;if(Object.prototype.hasOwnProperty.call(overrides,key))return;
        var value=new Intl.DateTimeFormat(locale,key==='clock.hhmm'?time:date).format(now);
        if(el.textContent!==value)el.textContent=value;
      });
    } catch (_) { /* Keep authored copy when a supplied locale/timezone is invalid. */ }
  }
  addEventListener('message',function(event){if(event.source===parent&&event.data&&event.data.type==='educms-overrides'&&Object.prototype.hasOwnProperty.call(event.data,'text')){overrides=event.data.text||{};Promise.resolve().then(tick);}});
  new MutationObserver(tick).observe(document.querySelector('[data-controls]'),{subtree:true,childList:true,characterData:true});
  addEventListener('DOMContentLoaded',tick);tick();setInterval(tick,15000);
})();
