(function () {
  'use strict';
  var stage=document.querySelector('.stage'), pages=Array.from(document.querySelectorAll('[data-page]'));
  var editing=false, lastInput=Date.now(), current='home', floor=0, history=[], amenity=0, gallery=0, zoom=1;
  var windowEl=document.querySelector('.plan-window'), canvas=document.querySelector('.plan-canvas');
  function read(key){var e=document.querySelector('[data-field="'+key+'"]');return e?e.textContent.trim():'';}
  function write(key,value){document.querySelectorAll('[data-field="'+key+'"]').forEach(function(e){if(e.textContent!==value)e.textContent=value;});}
  function fit(){if(window.commercialFit)window.commercialFit();}
  function show(page,focus,remember){
    if(!pages.some(function(p){return p.dataset.page===page;}))page='home';
    if(remember!==false&&page!==current){history.push(current);if(history.length>30)history.shift();}
    current=page;document.querySelectorAll('[data-back]').forEach(function(b){b.disabled=history.length===0;});pages.forEach(function(p){p.hidden=p.dataset.page!==page;});
    document.querySelectorAll('.app-nav [data-go]').forEach(function(b){if(b.dataset.go===page)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});
    if(focus){var h=document.querySelector('[data-page="'+page+'"] h1');if(h){h.tabIndex=-1;h.focus({preventScroll:true});}}
    document.dispatchEvent(new Event('property-page-change'));fit();
  }
  function choose(type,index){
    var panels=Array.from(document.querySelectorAll('[data-'+type+'-panel]'));
    index=(index+panels.length)%panels.length;
    panels.forEach(function(p,i){p.hidden=i!==index;});
    document.querySelectorAll('[data-'+type+']').forEach(function(b){b.setAttribute('aria-pressed',Number(b.dataset[type])===index?'true':'false');});
    if(type==='floor'){floor=index;zoom=1;sizePlan();windowEl.scrollTop=0;windowEl.scrollLeft=0;}
    if(type==='amenity')amenity=index;
    if(type==='gallery'){gallery=index;write('gallery.count',(index+1)+' / '+panels.length);}
    fit();
  }
  function sizePlan(){
    var portrait=stage.classList.contains('portrait');
    canvas.style.width=((portrait?1920:2450)*zoom)+'px';canvas.style.height=((portrait?900:995)*zoom)+'px';
    windowEl.style.touchAction=zoom>1?'none':'pan-x pan-y';
    write('plans.zoom',Math.round(zoom*100)+'%');
    document.querySelector('[data-zoom="out"]').disabled=zoom<=1;
    document.querySelector('[data-zoom="in"]').disabled=zoom>=3;
  }
  function qr(){
    document.querySelectorAll('[data-qr]').forEach(function(el){
      var value=read(el.dataset.qr);if(el.dataset.destination===value)return;
      try{var u=new URL(value);if(!/^https?:$/.test(u.protocol))throw Error('URL');var q=window.VenueQR.create(value,{errorCorrectionLevel:'M'}),m=q.modules,n=m.size+8,path='';for(var r=0;r<m.size;r++)for(var c=0;c<m.size;c++)if(m.data[r*m.size+c])path+='M'+(c+4)+' '+(r+4)+'h1v1h-1z';var svg='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 '+n+' '+n+'" shape-rendering="crispEdges"><rect width="'+n+'" height="'+n+'" fill="white"/><path fill="black" d="'+path+'"/></svg>';el.style.backgroundImage='url("data:image/svg+xml;base64,'+btoa(svg)+'")';el.dataset.destination=value;el.removeAttribute('data-error');}
      catch(_){el.style.backgroundImage='none';el.removeAttribute('data-destination');el.dataset.error='invalid-url';}
    });
  }
  function reset(focus){choose('floor',0);choose('amenity',0);choose('gallery',0);history=[];show('home',focus,false);}
  stage.addEventListener('click',function(event){
    var b=event.target.closest('button');if(!b||editing)return;lastInput=Date.now();
    // Preview may toggle editing without reloading. Capture live navigation
    // before the shared shim's previously armed text hot zones.
    event.preventDefault();event.stopPropagation();
    if(b.hasAttribute('data-back')){if(history.length)show(history.pop(),true,false);}
    else if(b.hasAttribute('data-go')){if(b.dataset.go==='home'&&stage.classList.contains('portrait'))reset(true);else show(b.dataset.go,true);}
    else if(b.hasAttribute('data-restart'))reset(true);
    else if(b.hasAttribute('data-floor'))choose('floor',Number(b.dataset.floor));
    else if(b.hasAttribute('data-amenity'))choose('amenity',Number(b.dataset.amenity));
    else if(b.hasAttribute('data-gallery'))choose('gallery',Number(b.dataset.gallery));
    else if(b.hasAttribute('data-gallery-step'))choose('gallery',gallery+Number(b.dataset.galleryStep));
    else if(b.hasAttribute('data-zoom')){zoom=b.dataset.zoom==='fit'?1:Math.max(1,Math.min(3,zoom+(b.dataset.zoom==='in'?.5:-.5)));sizePlan();if(zoom===1){windowEl.scrollTop=0;windowEl.scrollLeft=0;}}
  },true);
  var drag=null;
  windowEl.addEventListener('pointerdown',function(e){if(editing||zoom<=1||e.button!==0)return;drag={x:e.clientX,y:e.clientY,left:windowEl.scrollLeft,top:windowEl.scrollTop};windowEl.setPointerCapture(e.pointerId);windowEl.classList.add('dragging');});
  windowEl.addEventListener('pointermove',function(e){if(!drag)return;var scale=Number(getComputedStyle(document.documentElement).getPropertyValue('--stage-scale'))||1;windowEl.scrollLeft=drag.left-(e.clientX-drag.x)/scale;windowEl.scrollTop=drag.top-(e.clientY-drag.y)/scale;});
  ['pointerup','pointercancel','lostpointercapture'].forEach(function(name){windowEl.addEventListener(name,function(){drag=null;windowEl.classList.remove('dragging');});});
  ['pointerdown','keydown','wheel'].forEach(function(name){document.addEventListener(name,function(){lastInput=Date.now();},{passive:true});});
  function config(){qr();var start=read('tour.startPage');if(start!==stage.dataset.startPage){stage.dataset.startPage=start;show(start||'home',false);}sizePlan();}
  addEventListener('message',function(e){if(e.source!==parent||!e.data)return;if(e.data.type==='educms-edit-mode'){editing=!!e.data.on;lastInput=Date.now();}if(e.data.type==='educms-overrides')requestAnimationFrame(config);});
  addEventListener('resize',sizePlan);config();
  if(!new URLSearchParams(location.search).has('freeze'))setInterval(function(){if(editing||document.hidden)return;var seconds=Math.max(30,Math.min(600,Number(read('tour.idleSeconds'))||120));if(Date.now()-lastInput>seconds*1000){reset(false);lastInput=Date.now();}},1000);
})();
