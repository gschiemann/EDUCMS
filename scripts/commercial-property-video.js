/* Uses the existing data-videoslot / data-posterslot CMS upload contract.
 * A missing, blocked or failed video leaves the native photo carousel visible.
 */
(function () {
  'use strict';
  var editing = false, frozen = new URLSearchParams(location.search).has('freeze');
  var videos = Array.prototype.slice.call(document.querySelectorAll('[data-property-video]'));
  function read(key, fallback) {
    var el = document.querySelector('[data-field="' + key + '"]');
    return el ? el.textContent.trim() : fallback;
  }
  function sync(video) {
    var key = video.dataset.videoslot, source = video.getAttribute('src') || '';
    video.style.objectFit = read('media.' + key + '.fit', 'cover');
    video.style.objectPosition = read('media.' + key + '.position', 'center');
    video.loop = read('video.loop', 'yes') !== 'no';
    video.muted = true;
    if (!source || video.dataset.failedSource === source) video.classList.remove('video-ready');
    var visible = !!video.offsetWidth && !document.hidden && !editing && !frozen;
    if (!visible || read('video.autoplay', 'yes') === 'no') video.pause();
    else if (source) { var promise = video.play(); if (promise) promise.catch(function () { video.classList.remove('video-ready'); }); }
  }
  videos.forEach(function (video) {
    video.addEventListener('loadeddata', function () { video.dataset.failedSource = ''; video.classList.add('video-ready'); sync(video); });
    video.addEventListener('playing', function () { video.classList.add('video-ready'); });
    video.addEventListener('error', function () { video.dataset.failedSource = video.getAttribute('src') || ''; video.classList.remove('video-ready'); });
    new MutationObserver(function () { video.classList.remove('video-ready'); sync(video); }).observe(video, { attributes: true, attributeFilter: ['src'] });
    sync(video);
  });
  function refresh() { videos.forEach(sync); }
  addEventListener('message', function (event) {
    if (event.source !== parent || !event.data) return;
    if (event.data.type === 'educms-edit-mode') editing = !!event.data.on;
    if (event.data.type === 'educms-edit-mode' || event.data.type === 'educms-overrides') requestAnimationFrame(refresh);
  });
  document.addEventListener('visibilitychange', refresh);
  document.addEventListener('property-page-change', refresh);
})();
