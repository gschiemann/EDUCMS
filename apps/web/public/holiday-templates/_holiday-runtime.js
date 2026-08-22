(function () {
  'use strict';

  var root = document.documentElement;
  var stage = document.getElementById('stage');

  function textFor(key) {
    var field = document.querySelector('[data-field="' + key.replace(/"/g, '\\"') + '"]');
    return field ? (field.textContent || '').trim() : '';
  }

  function applyTheme() {
    document.querySelectorAll('[data-css-var]').forEach(function (field) {
      var variable = field.getAttribute('data-css-var');
      var value = (field.textContent || '').trim();
      if (!variable || !value) return;
      if (field.hasAttribute('data-css-font')) value = "'" + value.replace(/'/g, '') + "', sans-serif";
      root.style.setProperty(variable, value);
    });
  }

  function fitOne(element) {
    var portrait = stage && stage.getAttribute('data-orient') === 'port';
    var min = Number(element.getAttribute('data-fit-min') || 30);
    var max = Number((portrait && element.getAttribute('data-fit-max-port')) || element.getAttribute('data-fit-max') || parseFloat(getComputedStyle(element).fontSize) || min);
    var heightLimit = Number((portrait && element.getAttribute('data-fit-height-port')) || element.getAttribute('data-fit-height') || 0);
    var single = element.getAttribute('data-fit') === 'single';
    if (single) element.style.whiteSpace = 'nowrap';
    var low = min;
    var high = Math.max(min, max);
    var best = min;
    for (var index = 0; index < 14; index += 1) {
      var size = (low + high) / 2;
      element.style.fontSize = size + 'px';
      var widthOk = element.scrollWidth <= element.clientWidth + 1;
      var heightOk = heightLimit > 0
        ? element.scrollHeight <= heightLimit + 1
        : (single || element.scrollHeight <= element.clientHeight + 1);
      if (widthOk && heightOk) { best = size; low = size; }
      else high = size;
    }
    element.style.fontSize = best + 'px';
  }

  function autofit() {
    document.querySelectorAll('[data-fit]').forEach(fitOne);
  }

  function applyMedia(key, url) {
    document.querySelectorAll('[data-imgslot="' + String(key).replace(/"/g, '\\"') + '"]').forEach(function (slot) {
      var clean = typeof url === 'string' ? url.trim() : '';
      if (clean) {
        slot.setAttribute('data-img', clean);
        slot.style.backgroundImage = 'url("' + clean.replace(/"/g, '') + '")';
        slot.classList.add('has-img');
      } else {
        slot.removeAttribute('data-img');
        slot.style.backgroundImage = '';
        slot.classList.remove('has-img');
      }
    });
  }

  function hydrateMedia() {
    document.querySelectorAll('[data-imgslot][data-img]').forEach(function (slot) {
      applyMedia(slot.getAttribute('data-imgslot'), slot.getAttribute('data-img'));
    });
  }

  function safeTimeZone() {
    var requested = textFor('clock.timezone') || 'America/Los_Angeles';
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: requested }).format(new Date());
      return requested;
    } catch (error) {
      String(error);
      return 'America/Los_Angeles';
    }
  }

  function dateParts(timeZone) {
    var parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).formatToParts(new Date());
    var output = {};
    parts.forEach(function (part) { if (part.type !== 'literal') output[part.type] = Number(part.value); });
    return output;
  }

  function setLiveText(selector, value) {
    document.querySelectorAll(selector).forEach(function (field) {
      if (field.textContent !== value) field.textContent = value;
    });
  }

  function liveOutputs() {
    var zone = safeTimeZone();
    var now = new Date();
    var longDate = textFor('date.format').toLowerCase() === 'long';
    var day = new Intl.DateTimeFormat('en-US', { timeZone: zone, weekday: longDate ? 'long' : 'short' }).format(now);
    var month = new Intl.DateTimeFormat('en-US', { timeZone: zone, month: longDate ? 'long' : 'short', day: 'numeric' }).format(now);
    var hour12 = textFor('clock.hour12').toLowerCase() !== 'false';
    var time = new Intl.DateTimeFormat('en-US', { timeZone: zone, hour: 'numeric', minute: '2-digit', hour12: hour12 }).format(now);
    setLiveText('[data-live="date"]', day + ' · ' + month);
    setLiveText('[data-live="time"]', time);
  }

  function targetDate(targetText, today) {
    var value = targetText.trim().toLowerCase();
    var months = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
    var match;
    var year;
    var month;
    var day;
    var exactYear = false;

    match = value.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (match) {
      year = Number(match[1]); month = Number(match[2]) - 1; day = Number(match[3]); exactYear = true;
    } else {
      match = value.match(/^(\d{1,2})[\/-](\d{1,2})(?:[\/-](\d{4}))?$/);
      if (match) {
        month = Number(match[1]) - 1; day = Number(match[2]); year = match[3] ? Number(match[3]) : today.year; exactYear = Boolean(match[3]);
      } else {
        match = value.match(/^([a-z]+)\s+(\d{1,2})(?:,?\s+(\d{4}))?$/);
        if (!match || months[match[1].slice(0, 3)] == null) return null;
        month = months[match[1].slice(0, 3)]; day = Number(match[2]); year = match[3] ? Number(match[3]) : today.year; exactYear = Boolean(match[3]);
      }
    }

    if (month < 0 || month > 11 || day < 1 || day > 31) return null;
    var target = Date.UTC(year, month, day);
    var todayUtc = Date.UTC(today.year, today.month - 1, today.day);
    if (!exactYear && target < todayUtc) target = Date.UTC(year + 1, month, day);
    return { target: target, today: todayUtc, exactYear: exactYear };
  }

  function countdown() {
    var parsed = targetDate(textFor('countdown.target') || '10-31', dateParts(safeTimeZone()));
    if (!parsed) return;
    var days = Math.max(0, Math.ceil((parsed.target - parsed.today) / 86400000));
    setLiveText('[data-field="countdown.value"]', String(days));
  }

  function reviewChanged() {
    setTimeout(function () {
      var event;
      try { event = new Event('holiday-review:changed'); }
      catch (error) {
        String(error);
        event = document.createEvent('Event');
        event.initEvent('holiday-review:changed', false, false);
      }
      dispatchEvent(event);
    }, 140);
  }

  function editableFields() {
    var seen = {};
    return Array.prototype.map.call(document.querySelectorAll('[data-field]'), function (field) {
      var key = field.getAttribute('data-field') || '';
      if (!key || seen[key]) return null;
      seen[key] = true;
      return {
        key: key,
        value: (field.textContent || '').trim(),
        readOnly: field.hasAttribute('data-readonly'),
        source: field.getAttribute('data-readonly') || 'authored'
      };
    }).filter(Boolean);
  }

  function announceReady() {
    // No `window.parent === window` guard on purpose: every shipped holiday
    // board announces even at top level (posting to itself), which is how the
    // cross-browser bridge gate and standalone QA observe the field schema.
    try { window.parent.postMessage({
      type: 'holiday:ready',
      title: document.title,
      fields: editableFields(),
      mediaSlots: Array.prototype.map.call(document.querySelectorAll('[data-imgslot]'), function (slot) {
        return slot.getAttribute('data-imgslot');
      }).filter(function (key, index, values) { return key && values.indexOf(key) === index; })
    }, window.location.origin); } catch (e) {}
  }

  function refresh() {
    applyTheme();
    liveOutputs();
    countdown();
    autofit();
    setTimeout(autofit, 80);
    reviewChanged();
  }

  addEventListener('message', function (event) {
    if (event.origin !== location.origin || !event.data || typeof event.data !== 'object') return;
    var data = event.data;
    if (data.type === 'holiday:setField' && data.key) {
      document.querySelectorAll('[data-field="' + String(data.key).replace(/"/g, '\\"') + '"]').forEach(function (field) {
        if (!field.hasAttribute('data-readonly')) field.textContent = data.value == null ? '' : String(data.value);
      });
      refresh();
    }
    if ((data.type === 'holiday:setMedia' || data.type === 'template-set-media') && data.key) {
      applyMedia(data.key, data.url || data.value || '');
      autofit();
      reviewChanged();
    }
  });

  addEventListener('click', function (event) {
    var field = event.target && event.target.closest ? event.target.closest('[data-field]') : null;
    if (!field) {
      // A media slot is editable too, and its own decoration can sit above the
      // text inside it (the logo hex draws a ::after border over its initials),
      // so a click there must still reach the editor instead of going nowhere.
      var slot = event.target && event.target.closest ? event.target.closest('[data-imgslot]') : null;
      if (!slot) return;
      event.stopPropagation();
      try {
        window.parent.postMessage({
          type: 'holiday:fieldClicked',
          key: slot.getAttribute('data-imgslot'),
          kind: 'img'
        }, window.location.origin);
      } catch (e) {}
      return;
    }
    event.stopPropagation();
    window.parent.postMessage({
      type: 'holiday:fieldClicked',
      key: field.getAttribute('data-field'),
      value: (field.textContent || '').trim(),
      readOnly: field.hasAttribute('data-readonly')
    }, window.location.origin);
  });

  var theme = document.querySelector('[data-widget="theme"]');
  if (theme) new MutationObserver(refresh).observe(theme, { subtree: true, childList: true, characterData: true });
  var scene = document.querySelector('.scene');
  if (scene) new MutationObserver(autofit).observe(scene, { subtree: true, childList: true, characterData: true });

  hydrateMedia();
  refresh();
  announceReady();
  addEventListener('resize', refresh);
  setInterval(function () { liveOutputs(); countdown(); reviewChanged(); }, 30000);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(refresh);
}());
