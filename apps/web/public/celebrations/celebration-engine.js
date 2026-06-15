/* VenueOS celebration engine — shared by every cue (celebration-deck.html?cue=KEY).
 * Reuses the approved elements: themed scene + prop, optional projectile, an
 * impact burst, a kinetic chromatic headline, a lower-third scoreline, screen
 * shake/flash, and brand-shim recolor. One engine, one registry of cues.
 * Procedural Canvas 2D · Chromium-83 / WebKit safe (no inset, no cq units). */
(function () {
  "use strict";
  var cv, ctx, W = 1920, H = 1080, CX = 960;
  var _q = new URLSearchParams(location.search);
  var PAUSE = _q.has('pause') ? parseFloat(_q.get('pause')) : null;
  var TEAM = _q.get('team') ? '#' + _q.get('team').replace('#', '') : '#21e6ff';

  function hexToRgb(h){h=String(h).replace('#','');if(h.length===3)h=h.split('').map(function(x){return x+x;}).join('');return[parseInt(h.slice(0,2),16),parseInt(h.slice(2,4),16),parseInt(h.slice(4,6),16)];}
  function rgba(c,a){return 'rgba('+c[0]+','+c[1]+','+c[2]+','+a+')';}
  function lighten(c,f){return[Math.min(255,c[0]+(255-c[0])*f)|0,Math.min(255,c[1]+(255-c[1])*f)|0,Math.min(255,c[2]+(255-c[2])*f)|0];}
  function clamp(v,a,b){return v<a?a:(v>b?b:v);}
  function lerp(a,b,t){return a+(b-a)*t;}
  function easeOutCubic(t){return 1-Math.pow(1-t,3);}
  function easeOutBack(t){var c1=1.70158,c3=c1+1;return 1+c3*Math.pow(t-1,3)+c1*Math.pow(t-1,2);}
  function easeOutQuad(t){return 1-(1-t)*(1-t);}
  function seg(t,a,b){return clamp((t-a)/(b-a),0,1);}
  var TRGB=hexToRgb(TEAM),TLT=lighten(TRGB,0.5);

  // ── particle burst (fire / energy / ice / water / dust / confetti / fireworks) ──
  var parts=[], shells=[], BURST_AT=0;
  var STYLES={
    fire:   {pal:['#fff3b0','#ff9d28','#ff3b1f'], grav:0.34, puff:'rgba(255,150,50,', up:6, spark:'#fff7d6'},
    energy: {pal:null,                            grav:0.30, puff:null,                 up:5, spark:'#ffffff'},
    ice:    {pal:['#ffffff','#dff6ff','#bfe9ff'], grav:0.5,  puff:'rgba(210,235,255,',  up:6, spark:'#ffffff'},
    water:  {pal:['#ffffff','#dff6ff','#9fd8ff'], grav:0.55, puff:'rgba(200,230,255,',  up:7, spark:'#ffffff'},
    dust:   {pal:['#ffffff','#e6e9ef','#cfd6e0'], grav:0.5,  puff:'rgba(225,232,245,',  up:5, spark:'#ffffff'},
    confetti:{pal:['#ff4d6a','#ffd23b','#4dd6ff','#7bff8a','#ffffff','#ff7be6'], grav:0.28, puff:null, up:4, spark:'#ffffff', flat:true},
    fireworks:{pal:['#ff4d4d','#ffd23b','#4dd6ff','#ffffff','#7bff8a','#ff7be6'], grav:0.10, puff:null, up:0, spark:null, shells:true}
  };
  function spawnBurst(x,y,styleName){
    var S=STYLES[styleName]||STYLES.energy;
    if(S.shells){ for(var s=0;s<8;s++)shells.push({x:x+(Math.random()-0.5)*620,y:y-220-Math.random()*240,delay:s*0.15+Math.random()*0.1,col:S.pal[s%S.pal.length],fired:false}); return; }
    var pal=S.pal||[rgba(TLT,1),'#ffffff',rgba(TRGB,1)];
    var i,n=300;
    for(i=0;i<n;i++){var a=Math.random()*Math.PI*2,sp=6+Math.random()*28;parts.push({x:x,y:y,vx:Math.cos(a)*sp,vy:Math.sin(a)*sp-S.up,life:0.7+Math.random()*0.7,r:S.flat?(3+Math.random()*4):(3+Math.random()*7),col:pal[(Math.random()*pal.length)|0],grav:S.grav,flat:S.flat});}
    if(S.spark)for(i=0;i<40;i++){var a2=(-Math.PI/2)+(Math.random()-0.5)*2.6,sp2=16+Math.random()*26;parts.push({x:x,y:y,vx:Math.cos(a2)*sp2,vy:Math.sin(a2)*sp2,life:1,r:0,spark:S.spark,grav:S.grav*0.7});}
    if(S.puff)for(i=0;i<34;i++){var a3=Math.random()*Math.PI*2,sp3=1+Math.random()*5;parts.push({x:x,y:y,vx:Math.cos(a3)*sp3,vy:Math.sin(a3)*sp3-2,life:1+Math.random()*0.6,r:14+Math.random()*22,puff:S.puff,grav:0});}
  }
  function stepShells(t){ if(!shells.length)return; var e=(t-BURST_AT)/1000; for(var i=0;i<shells.length;i++){var sh=shells[i];if(!sh.fired&&e>=sh.delay){sh.fired=true;for(var k=0;k<70;k++){var a=Math.random()*Math.PI*2,sp=3+Math.random()*8;parts.push({x:sh.x,y:sh.y,vx:Math.cos(a)*sp,vy:Math.sin(a)*sp,life:1+Math.random()*0.5,r:2+Math.random()*2.4,col:Math.random()<0.25?'#fff':sh.col,grav:0.08,flat:false});}}} }
  function stepParts(dt){var i,p;for(i=parts.length-1;i>=0;i--){p=parts[i];if(p.puff){p.vy-=0.08;p.vx*=0.96;p.vy*=0.96;p.r+=18*dt;p.life-=dt*0.7;}else{p.vy+=p.grav;p.vx*=0.99;p.life-=dt*(p.spark?1.5:0.92);}p.x+=p.vx;p.y+=p.vy;if(p.life<=0)parts.splice(i,1);}}
  function drawParts(){ctx.globalCompositeOperation='lighter';var i,p;
    for(i=0;i<parts.length;i++){p=parts[i];if(!p.puff)continue;var pa=clamp(p.life,0,1)*0.2;var g=ctx.createRadialGradient(p.x,p.y,0,p.x,p.y,p.r);g.addColorStop(0,p.puff+pa+')');g.addColorStop(1,p.puff+'0)');ctx.fillStyle=g;ctx.beginPath();ctx.arc(p.x,p.y,p.r,0,Math.PI*2);ctx.fill();}
    for(i=0;i<parts.length;i++){p=parts[i];if(p.puff)continue;ctx.globalAlpha=clamp(p.life,0,1);if(p.spark){ctx.strokeStyle=p.spark;ctx.shadowColor=p.spark;ctx.shadowBlur=10;ctx.lineWidth=2.5;ctx.beginPath();ctx.moveTo(p.x,p.y);ctx.lineTo(p.x-p.vx*1.7,p.y-p.vy*1.7);ctx.stroke();}else{ctx.fillStyle=p.col;ctx.shadowColor=p.col;ctx.shadowBlur=14;if(p.flat){ctx.fillRect(p.x-p.r,p.y-p.r,p.r*2,p.r*2.4);}else{ctx.beginPath();ctx.arc(p.x,p.y,p.r*clamp(p.life+0.2,0,1.2),0,Math.PI*2);ctx.fill();}}}
    ctx.globalAlpha=1;ctx.shadowBlur=0;ctx.globalCompositeOperation='source-over';}

  function shockwave(t,T,x,y){if(t<T.impact||t>T.impact+700)return;var p=seg(t,T.impact,T.impact+700);ctx.globalCompositeOperation='lighter';var cp=seg(t,T.impact,T.impact+240),cr=lerp(8,180,easeOutCubic(cp))*(1-cp*0.4);var cg=ctx.createRadialGradient(x,y,0,x,y,cr);cg.addColorStop(0,'rgba(255,255,255,'+(1-cp)+')');cg.addColorStop(0.4,rgba(TLT,(1-cp)*0.8));cg.addColorStop(1,'rgba(255,255,255,0)');ctx.fillStyle=cg;ctx.beginPath();ctx.arc(x,y,cr,0,Math.PI*2);ctx.fill();ctx.globalCompositeOperation='source-over';var R=easeOutCubic(p)*620;ctx.strokeStyle=rgba(TLT,(1-p)*0.9);ctx.lineWidth=11*(1-p)+2;ctx.shadowColor=TEAM;ctx.shadowBlur=30;ctx.beginPath();ctx.arc(x,y,R,0,Math.PI*2);ctx.stroke();ctx.shadowBlur=0;}

  function headline(t,T,text,size){if(t<T.head)return;var p=seg(t,T.head,T.head+420),s=lerp(1.6,1.0,easeOutCubic(p));var gl=t<T.head+320?(Math.random()-0.5)*9:0;ctx.save();ctx.translate(W/2+gl,300);ctx.scale(s,s);ctx.textAlign='center';ctx.textBaseline='middle';ctx.font='900 '+(size||230)+'px Arial Black, Arial, sans-serif';ctx.globalCompositeOperation='lighter';ctx.fillStyle='rgba(255,40,80,0.85)';ctx.fillText(text,-8,0);ctx.fillStyle=rgba(TRGB,0.9);ctx.fillText(text,8,0);ctx.fillStyle='#fff';ctx.shadowColor=TEAM;ctx.shadowBlur=42;ctx.fillText(text,0,0);ctx.globalCompositeOperation='source-over';ctx.restore();ctx.shadowBlur=0;}
  function lowerThird(t,T,s1,s2){var lp=seg(t,T.head+260,T.head+640);if(lp<=0)return;ctx.save();ctx.globalAlpha=lp;var bY=824,bH=170;var bg=ctx.createLinearGradient(0,bY,0,bY+bH);bg.addColorStop(0,'rgba(5,9,16,0)');bg.addColorStop(0.32,'rgba(5,9,16,0.88)');bg.addColorStop(0.7,'rgba(5,9,16,0.88)');bg.addColorStop(1,'rgba(5,9,16,0)');ctx.fillStyle=bg;ctx.fillRect(0,bY,W,bH);ctx.strokeStyle=rgba(TLT,0.7);ctx.lineWidth=3;ctx.shadowColor=TEAM;ctx.shadowBlur=12;ctx.beginPath();ctx.moveTo(W/2-380,bY+34);ctx.lineTo(W/2+380,bY+34);ctx.stroke();ctx.shadowBlur=0;ctx.textAlign='center';ctx.textBaseline='alphabetic';var ty=bY+96+(1-easeOutCubic(lp))*26;ctx.font='800 58px Arial';ctx.fillStyle='#eef4ff';ctx.shadowColor='rgba(0,0,0,0.85)';ctx.shadowBlur=14;ctx.fillText(s1,W/2,ty);ctx.font='700 30px Arial';ctx.fillStyle=rgba(TLT,0.95);ctx.shadowBlur=0;if(s2)ctx.fillText(s2,W/2,ty+42);ctx.restore();ctx.shadowBlur=0;}

  // ── primitives shared by scenes/props/motifs ──────────────────
  function L(a,b){ctx.beginPath();ctx.moveTo(a[0],a[1]);ctx.lineTo(b[0],b[1]);ctx.stroke();}
  function rrect(x,y,w,h,r){ctx.beginPath();ctx.moveTo(x+r,y);ctx.arcTo(x+w,y,x+w,y+h,r);ctx.arcTo(x+w,y+h,x,y+h,r);ctx.arcTo(x,y+h,x,y,r);ctx.arcTo(x,y,x+w,y,r);ctx.closePath();}
  function meshQuad(a,b,c,d,nu,nv){function P(u,v){var tx=a[0]+(b[0]-a[0])*u,ty=a[1]+(b[1]-a[1])*u,bx=d[0]+(c[0]-d[0])*u,by=d[1]+(c[1]-d[1])*u;return [tx+(bx-tx)*v,ty+(by-ty)*v];}var i,j,p;for(i=0;i<=nu;i++){ctx.beginPath();for(j=0;j<=nv;j++){p=P(i/nu,j/nv);j?ctx.lineTo(p[0],p[1]):ctx.moveTo(p[0],p[1]);}ctx.stroke();}for(j=0;j<=nv;j++){ctx.beginPath();for(i=0;i<=nu;i++){p=P(i/nu,j/nv);i?ctx.lineTo(p[0],p[1]):ctx.moveTo(p[0],p[1]);}ctx.stroke();}}
  function nightTop(toY){var g=ctx.createLinearGradient(0,0,0,toY);g.addColorStop(0,'#05080f');g.addColorStop(1,'#0a1320');ctx.fillStyle=g;ctx.fillRect(0,0,W,toY);ctx.globalCompositeOperation='lighter';for(var k=0;k<4;k++){var lx=300+k*440,ly=64;var gg=ctx.createRadialGradient(lx,ly,0,lx,ly,150);gg.addColorStop(0,'rgba(235,245,255,0.11)');gg.addColorStop(1,'rgba(235,245,255,0)');ctx.fillStyle=gg;ctx.beginPath();ctx.arc(lx,ly,150,0,Math.PI*2);ctx.fill();}ctx.globalCompositeOperation='source-over';}
  function crowd(toY){for(var c=0;c<200;c++){ctx.fillStyle='rgba('+(110+(c*37%120))+','+(120+(c*53%110))+','+(140+(c*29%100))+',0.4)';ctx.fillRect((c*19)%W,toY-86+((c*13)%80),4,4);}}

  // ── balls ─────────────────────────────────────────────────────
  var BALLS={
    soccer:function(x,y,r,sp){ctx.save();ctx.shadowColor=TEAM;ctx.shadowBlur=8;var g=ctx.createRadialGradient(x-r*0.3,y-r*0.34,r*0.1,x,y,r);g.addColorStop(0,'#fff');g.addColorStop(0.6,'#edf0f3');g.addColorStop(1,'#9aa0a8');ctx.fillStyle=g;ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.fill();ctx.restore();ctx.save();ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.clip();var blk='#16181d';pentF(x,y,r*0.3,sp,blk);for(var k=0;k<5;k++){var a=sp-Math.PI/2+k*2*Math.PI/5;pentF(x+Math.cos(a)*r*0.66,y+Math.sin(a)*r*0.66,r*0.24,a,blk);}ctx.restore();spec(x,y,r);},
    basketball:function(x,y,r,sp){ctx.save();ctx.shadowColor='#ff8c2e';ctx.shadowBlur=10;var g=ctx.createRadialGradient(x-r*0.3,y-r*0.34,r*0.1,x,y,r);g.addColorStop(0,'#ffd9a6');g.addColorStop(0.5,'#ff8c2e');g.addColorStop(1,'#a8480c');ctx.fillStyle=g;ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.fill();ctx.restore();ctx.save();ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.clip();ctx.translate(x,y);ctx.rotate(sp*0.35);ctx.strokeStyle='rgba(20,12,6,0.8)';ctx.lineWidth=r*0.06;ctx.beginPath();ctx.ellipse(0,0,r*0.98,r*0.3,0,0,Math.PI*2);ctx.stroke();ctx.beginPath();ctx.moveTo(0,-r);ctx.lineTo(0,r);ctx.stroke();ctx.beginPath();ctx.ellipse(r*0.5,0,r*0.5,r*0.99,0,0,Math.PI*2);ctx.stroke();ctx.beginPath();ctx.ellipse(-r*0.5,0,r*0.5,r*0.99,0,0,Math.PI*2);ctx.stroke();ctx.restore();spec(x,y,r);},
    baseball:function(x,y,r,sp){ctx.save();ctx.shadowColor='rgba(255,255,255,0.6)';ctx.shadowBlur=10;var g=ctx.createRadialGradient(x-r*0.3,y-r*0.34,r*0.1,x,y,r);g.addColorStop(0,'#fff');g.addColorStop(0.7,'#f3f4f6');g.addColorStop(1,'#cfd3da');ctx.fillStyle=g;ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.fill();ctx.restore();ctx.save();ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.clip();ctx.translate(x,y);ctx.rotate(sp*0.3);ctx.strokeStyle='#d8362f';ctx.lineWidth=r*0.07;for(var s=-1;s<=1;s+=2){ctx.beginPath();ctx.ellipse(s*r*0.78,0,r*0.5,r*0.95,0,0,Math.PI*2);ctx.stroke();}ctx.restore();spec(x,y,r);},
    football:function(x,y,Ln,rot){var a=Ln/2,b=Ln*0.305;ctx.save();ctx.translate(x,y);ctx.rotate(rot);ctx.shadowColor='rgba(110,55,18,0.55)';ctx.shadowBlur=10;ctx.beginPath();ctx.moveTo(-a,0);ctx.quadraticCurveTo(-a*0.5,-b,0,-b);ctx.quadraticCurveTo(a*0.5,-b,a,0);ctx.quadraticCurveTo(a*0.5,b,0,b);ctx.quadraticCurveTo(-a*0.5,b,-a,0);ctx.closePath();var g=ctx.createLinearGradient(0,-b,0,b);g.addColorStop(0,'#a8632e');g.addColorStop(0.5,'#7c4019');g.addColorStop(1,'#522810');ctx.fillStyle=g;ctx.fill();ctx.shadowBlur=0;ctx.strokeStyle='rgba(248,248,248,0.95)';ctx.lineWidth=Ln*0.06;ctx.lineCap='round';ctx.beginPath();ctx.moveTo(a*0.5,-b*0.62);ctx.quadraticCurveTo(a*0.66,0,a*0.5,b*0.62);ctx.stroke();ctx.beginPath();ctx.moveTo(-a*0.5,-b*0.62);ctx.quadraticCurveTo(-a*0.66,0,-a*0.5,b*0.62);ctx.stroke();ctx.strokeStyle='#f6f6f6';ctx.lineWidth=Ln*0.028;ctx.beginPath();ctx.moveTo(-Ln*0.14,-b*0.12);ctx.lineTo(Ln*0.14,-b*0.12);ctx.stroke();for(var i=-2;i<=2;i++){ctx.beginPath();ctx.moveTo(i*Ln*0.065,-b*0.34);ctx.lineTo(i*Ln*0.065,b*0.1);ctx.stroke();}ctx.restore();},
    volleyball:function(x,y,r,sp){ctx.save();ctx.shadowColor='rgba(255,255,255,0.5)';ctx.shadowBlur=10;var g=ctx.createRadialGradient(x-r*0.3,y-r*0.34,r*0.1,x,y,r);g.addColorStop(0,'#fff');g.addColorStop(0.7,'#eef1f5');g.addColorStop(1,'#cfd4db');ctx.fillStyle=g;ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.fill();ctx.restore();ctx.save();ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.clip();ctx.lineCap='round';var cols=['#1f5fd0','#ffce17','#1f5fd0'];for(var k=0;k<3;k++){ctx.strokeStyle=cols[k];ctx.lineWidth=r*0.44;ctx.beginPath();ctx.arc(x,y,r*0.74,sp+k*2.094,sp+k*2.094+1.4);ctx.stroke();}ctx.restore();spec(x,y,r);},
    waterpolo:function(x,y,r,sp){ctx.save();ctx.shadowColor='rgba(255,210,40,0.6)';ctx.shadowBlur=10;var g=ctx.createRadialGradient(x-r*0.3,y-r*0.34,r*0.1,x,y,r);g.addColorStop(0,'#fff7cf');g.addColorStop(0.5,'#ffd21a');g.addColorStop(1,'#c98a00');ctx.fillStyle=g;ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.fill();ctx.restore();ctx.save();ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.clip();ctx.strokeStyle='rgba(150,96,8,0.55)';ctx.lineWidth=r*0.05;ctx.translate(x,y);ctx.rotate(sp*0.4);for(var k=0;k<3;k++){ctx.beginPath();ctx.ellipse(0,0,r*(0.3+k*0.34),r*0.98,0,0,Math.PI*2);ctx.stroke();}ctx.restore();spec(x,y,r);},
    puck:function(x,y,r,sp){ctx.save();ctx.shadowColor=TEAM;ctx.shadowBlur=14;ctx.fillStyle='#0c0e12';ctx.beginPath();ctx.ellipse(x,y,r,r*0.42,0,0,Math.PI*2);ctx.fill();ctx.restore();ctx.strokeStyle='rgba(120,130,150,0.6)';ctx.lineWidth=2;ctx.beginPath();ctx.ellipse(x,y-2,r,r*0.42,0,0,Math.PI*2);ctx.stroke();}
  };
  function pentF(cx,cy,rad,rot,fill){ctx.beginPath();for(var i=0;i<5;i++){var a=rot-Math.PI/2+i*2*Math.PI/5,px=cx+Math.cos(a)*rad,py=cy+Math.sin(a)*rad;if(i===0)ctx.moveTo(px,py);else ctx.lineTo(px,py);}ctx.closePath();ctx.fillStyle=fill;ctx.fill();}
  function spec(x,y,r){ctx.save();ctx.globalCompositeOperation='lighter';var hx=x-r*0.32,hy=y-r*0.36;var hg=ctx.createRadialGradient(hx,hy,1,hx,hy,r*0.4);hg.addColorStop(0,'rgba(255,255,255,0.6)');hg.addColorStop(1,'rgba(255,255,255,0)');ctx.fillStyle=hg;ctx.beginPath();ctx.arc(hx,hy,r*0.4,0,Math.PI*2);ctx.fill();ctx.restore();}

  // ── scenes (background + sport prop) ──────────────────────────
  function grassFloor(top){var fg=ctx.createLinearGradient(0,top,0,H);fg.addColorStop(0,'#1f7a3a');fg.addColorStop(1,'#0e4f25');ctx.fillStyle=fg;ctx.fillRect(0,top,W,H-top);ctx.globalCompositeOperation='lighter';for(var m=0;m<9;m++){if(m%2){ctx.fillStyle='rgba(255,255,255,0.03)';ctx.fillRect(0,top+m*((H-top)/9),W,(H-top)/9);}}ctx.globalCompositeOperation='source-over';}
  function softGoal(x,y,w,h){ // straight-on white goal + simple net pocket
    var ins=24,dT=30,dB=92;var FTL=[x,y],FTR=[x+w,y],FBL=[x,y+h],FBR=[x+w,y+h];var BTL=[x+ins,y-dT],BTR=[x+w-ins,y-dT],BBL=[x+ins,y+h-dB],BBR=[x+w-ins,y+h-dB];
    ctx.strokeStyle='rgba(236,246,255,0.4)';ctx.lineWidth=1.4;meshQuad(FTL,FTR,BTR,BTL,14,3);meshQuad(FBL,FBR,BBR,BBL,14,4);meshQuad(FTL,BTL,BBL,FBL,3,8);meshQuad(FTR,BTR,BBR,FBR,3,8);meshQuad(BTL,BTR,BBR,BBL,14,8);
    ctx.strokeStyle='rgba(248,251,255,0.97)';ctx.lineWidth=11;ctx.lineCap='round';ctx.shadowColor=TEAM;ctx.shadowBlur=20;L(FTL,FBL);L(FTR,FBR);L(FTL,FTR);ctx.shadowBlur=0;
    return {x:x+w*0.5,y:y+h*0.45};
  }
  var SCENES={
    grass:function(t,P){nightTop(560);crowd(560);grassFloor(560);P.goal=softGoal(1200,560,520,180);},
    ice:function(t,P){var g=ctx.createLinearGradient(0,0,0,560);g.addColorStop(0,'#0a1422');g.addColorStop(1,'#16314a');ctx.fillStyle=g;ctx.fillRect(0,0,W,560);var w=ctx.createLinearGradient(0,560,0,H);w.addColorStop(0,'#dbe9f5');w.addColorStop(1,'#9fc0db');ctx.fillStyle=w;ctx.fillRect(0,560,W,H-560);
      ctx.strokeStyle='rgba(228,42,38,0.85)';ctx.lineWidth=6;L([1100,720],[1820,720]);
      // red goal — full attached net pocket (top + floor + both sides + back share corners)
      var x=1290,y=504,w2=360,h2=216,ins=30,dT=30,dB=110;var FTL=[x,y],FTR=[x+w2,y],FBL=[x,y+h2],FBR=[x+w2,y+h2];var BTL=[x+ins,y-dT],BTR=[x+w2-ins,y-dT],BBL=[x+ins,y+h2-dB],BBR=[x+w2-ins,y+h2-dB];
      ctx.strokeStyle='rgba(236,246,255,0.42)';ctx.lineWidth=1.4;meshQuad(FTL,FTR,BTR,BTL,12,3);meshQuad(FBL,FBR,BBR,BBL,12,4);meshQuad(FTL,BTL,BBL,FBL,3,7);meshQuad(FTR,BTR,BBR,FBR,3,7);meshQuad(BTL,BTR,BBR,BBL,12,7);
      ctx.strokeStyle='#ef3a33';ctx.lineWidth=12;ctx.lineCap='round';ctx.shadowColor='#ff5148';ctx.shadowBlur=20;L(FTL,FBL);L(FTR,FBR);L(FTL,FTR);L(FBL,FBR);ctx.shadowBlur=0;P.goal={x:x+w2*0.5,y:y+h2*0.5};},
    pool:function(t,P){var WS=600;var g=ctx.createLinearGradient(0,0,0,WS);g.addColorStop(0,'#040d18');g.addColorStop(1,'#06182b');ctx.fillStyle=g;ctx.fillRect(0,0,W,WS);
      ctx.globalCompositeOperation='lighter';for(var li=0;li<7;li++){var lx=(li+0.5)*(W/7),ly=70+((li*37)%120);var gg=ctx.createRadialGradient(lx,ly,0,lx,ly,120);gg.addColorStop(0,'rgba(180,225,255,0.10)');gg.addColorStop(1,'rgba(180,225,255,0)');ctx.fillStyle=gg;ctx.beginPath();ctx.arc(lx,ly,120,0,Math.PI*2);ctx.fill();}ctx.globalCompositeOperation='source-over';
      var w=ctx.createLinearGradient(0,WS,0,H);w.addColorStop(0,'#0e5a86');w.addColorStop(0.5,'#093f63');w.addColorStop(1,'#04121f');ctx.fillStyle=w;ctx.fillRect(0,WS,W,H-WS);
      ctx.globalCompositeOperation='lighter';for(var c=0;c<12;c++){var yy=WS+18+c*((H-WS)/12),amp=7+c*1.3,ph=t*0.0012*(0.5+c*0.12)+c;ctx.strokeStyle='rgba(190,235,255,'+(0.05+0.035*Math.sin(ph*2))+')';ctx.lineWidth=2;ctx.beginPath();for(var xx=0;xx<=W;xx+=26){var yo=Math.sin(xx*0.012+ph*3)*amp;xx===0?ctx.moveTo(xx,yy+yo):ctx.lineTo(xx,yy+yo);}ctx.stroke();}ctx.globalCompositeOperation='source-over';
      ctx.strokeStyle=rgba(TLT,0.5);ctx.lineWidth=2;ctx.shadowColor=TEAM;ctx.shadowBlur=14;L([0,WS],[W,WS]);ctx.shadowBlur=0;
      var x=1180,y=450,w2=560,h2=150,ins=26,dT=16,dB=10;var FTL=[x,y],FTR=[x+w2,y],FBL=[x,y+h2],FBR=[x+w2,y+h2];var BTL=[x+ins,y-dT],BTR=[x+w2-ins,y-dT],BBL=[x+ins,y+h2-dB],BBR=[x+w2-ins,y+h2-dB];
      ctx.strokeStyle='rgba(236,246,255,0.42)';ctx.lineWidth=1.4;meshQuad(FTL,FTR,BTR,BTL,16,3);meshQuad(FBL,FBR,BBR,BBL,16,3);meshQuad(FTL,BTL,BBL,FBL,3,6);meshQuad(FTR,BTR,BBR,FBR,3,6);meshQuad(BTL,BTR,BBR,BBL,16,6);
      ctx.strokeStyle='rgba(245,250,255,0.96)';ctx.lineWidth=10;ctx.lineCap='round';ctx.shadowColor=TEAM;ctx.shadowBlur=22;L(FTL,FBL);L(FTR,FBR);L(FTL,FTR);ctx.shadowBlur=0;P.goal={x:x+w2*0.5,y:y+h2*0.5};},
    court:function(t,P){var g=ctx.createLinearGradient(0,0,0,H);g.addColorStop(0,'#05070e');g.addColorStop(0.62,'#0a0a14');g.addColorStop(1,'#06040a');ctx.fillStyle=g;ctx.fillRect(0,0,W,H);
      var wg=ctx.createLinearGradient(0,875,0,H);wg.addColorStop(0,'rgba(120,70,28,0)');wg.addColorStop(1,'rgba(120,70,28,0.16)');ctx.fillStyle=wg;ctx.fillRect(0,875,W,H-875);
      var bx=1706,by=235,bw=300,bh=176;ctx.fillStyle='rgba(12,22,38,0.5)';ctx.strokeStyle=rgba(TLT,0.9);ctx.lineWidth=5;ctx.shadowColor=TEAM;ctx.shadowBlur=18;rrect(bx-bw/2,by,bw,bh,10);ctx.fill();ctx.stroke();ctx.shadowBlur=0;rrect(bx-50,by+bh-90,100,76,4);ctx.lineWidth=4;ctx.stroke();
      var ry=430;ctx.strokeStyle='#ff7a18';ctx.shadowColor='#ff7a18';ctx.shadowBlur=18;ctx.lineWidth=8;ctx.beginPath();ctx.ellipse(bx,ry,58,15,0,0,Math.PI*2);ctx.stroke();ctx.shadowBlur=0;
      ctx.strokeStyle='rgba(238,246,255,0.5)';ctx.lineWidth=2;var N=12,topR=58,botY=ry+128,botRX=27;for(var i=0;i<N;i++){var a=i/N*Math.PI*2;ctx.beginPath();ctx.moveTo(bx+Math.cos(a)*topR,ry+Math.sin(a)*15);ctx.lineTo(bx+Math.cos(a)*botRX,botY+Math.sin(a)*8);ctx.stroke();}
      ctx.strokeStyle=rgba(TRGB,0.3);ctx.lineWidth=3;ctx.shadowColor=TEAM;ctx.shadowBlur=12;ctx.beginPath();ctx.moveTo(0,915);ctx.lineTo(W,915);ctx.stroke();ctx.beginPath();ctx.ellipse(bx,915,600,150,0,0,Math.PI);ctx.stroke();ctx.shadowBlur=0;P.rim={x:bx,y:ry};},
    turf:function(t,P){nightTop(560);crowd(560);grassFloor(560);
      var cb=512,gapL=1360,gapR=1648,top=188,cx=1504;ctx.strokeStyle='#ffd21a';ctx.lineWidth=14;ctx.lineCap='round';ctx.shadowColor='#ffd21a';ctx.shadowBlur=18;L([gapL,cb],[gapR,cb]);L([gapL,cb],[gapL,top]);L([gapR,cb],[gapR,top]);ctx.beginPath();ctx.moveTo(cx,cb);ctx.quadraticCurveTo(cx,cb+90,cx+90,cb+120);ctx.stroke();L([cx+90,cb+120],[cx+90,820]);ctx.shadowBlur=0;P.up={x:cx,y:430};},
    ballpark:function(t,P){var g=ctx.createLinearGradient(0,0,0,575);g.addColorStop(0,'#070f1e');g.addColorStop(1,'#0c2036');ctx.fillStyle=g;ctx.fillRect(0,0,W,575);crowd(575);var wg=ctx.createLinearGradient(0,575,0,812);wg.addColorStop(0,'#1c7e46');wg.addColorStop(1,'#0f5a30');ctx.fillStyle=wg;ctx.fillRect(0,575,W,237);ctx.strokeStyle='#ffd23b';ctx.lineWidth=8;ctx.shadowColor='#ffd23b';ctx.shadowBlur=10;L([0,575],[W,575]);ctx.shadowBlur=0;ctx.fillStyle='rgba(255,255,255,0.85)';ctx.font='900 56px Arial';ctx.textAlign='center';ctx.fillText('330',300,703);ctx.fillText('400',960,703);ctx.fillText('330',1620,703);ctx.fillStyle='#7a4a25';ctx.fillRect(0,812,W,34);var fg=ctx.createLinearGradient(0,846,0,H);fg.addColorStop(0,'#1f7a3a');fg.addColorStop(1,'#0e4f25');ctx.fillStyle=fg;ctx.fillRect(0,846,W,H-846);P.wall={x:960,y:520};},
    gym:function(t,P){var g=ctx.createLinearGradient(0,0,0,470);g.addColorStop(0,'#070a12');g.addColorStop(1,'#0d1320');ctx.fillStyle=g;ctx.fillRect(0,0,W,470);crowd(470);
      function court(u,v){return [960+u*lerp(830,205,v),lerp(1018,470,v)];}
      ctx.fillStyle='#16110b';ctx.fillRect(0,470,W,H-470);polyF([court(-1.4,0),court(1.4,0),court(1.4,1),court(-1.4,1)],'#7a4f24');polyF([court(-1,0),court(1,0),court(1,1),court(-1,1)],'#9a6a32');
      ctx.strokeStyle='rgba(255,255,255,0.7)';ctx.lineWidth=4;L(court(-1,0),court(1,0));L(court(-1,1),court(1,1));L(court(-1,0),court(-1,1));L(court(1,0),court(1,1));L(court(-1,0.333),court(1,0.333));L(court(-1,0.667),court(1,0.667));
      var bl=court(-1,0.5),br=court(1,0.5),baseY=bl[1],tY=baseY-158;
      ctx.strokeStyle='rgba(210,224,238,0.92)';ctx.lineWidth=9;ctx.lineCap='round';ctx.shadowColor=TEAM;ctx.shadowBlur=12;L([bl[0]-26,baseY+8],[bl[0]-26,tY-14]);L([br[0]+26,baseY+8],[br[0]+26,tY-14]);ctx.shadowBlur=0;
      ctx.strokeStyle='rgba(232,242,255,0.3)';ctx.lineWidth=1.3;for(var yy=tY;yy<=baseY;yy+=20){L([bl[0],yy],[br[0],yy]);}for(var xx=bl[0];xx<=br[0];xx+=34){L([xx,tY],[xx,baseY]);}
      ctx.fillStyle='rgba(248,250,255,0.96)';ctx.fillRect(bl[0],tY-7,br[0]-bl[0],13);
      [bl[0],br[0]].forEach(function(ax){var aTop=tY-150,segs=8;ctx.lineWidth=8;ctx.lineCap='butt';for(var i=0;i<segs;i++){ctx.strokeStyle=(i%2?'#fff':'#e23a26');L([ax,tY-i*((tY-aTop)/segs)],[ax,tY-(i+1)*((tY-aTop)/segs)]);}});
      P.net={x:court(0.3,0.84)[0],y:court(0.3,0.84)[1]};},
    mat:function(t,P){var g=ctx.createLinearGradient(0,0,0,H);g.addColorStop(0,'#0a0c14');g.addColorStop(1,'#070509');ctx.fillStyle=g;ctx.fillRect(0,0,W,H);
      // wrestling mat: a big circle (the central circle) in perspective on the floor
      ctx.save();ctx.translate(CX,720);ctx.scale(1,0.4);
      ctx.fillStyle=rgba(lighten(TRGB,0.1),0.18);ctx.beginPath();ctx.arc(0,0,560,0,Math.PI*2);ctx.fill();
      ctx.strokeStyle=rgba(TLT,0.55);ctx.lineWidth=10;ctx.shadowColor=TEAM;ctx.shadowBlur=16;ctx.beginPath();ctx.arc(0,0,560,0,Math.PI*2);ctx.stroke();
      ctx.strokeStyle='rgba(255,255,255,0.4)';ctx.lineWidth=6;ctx.beginPath();ctx.arc(0,0,300,0,Math.PI*2);ctx.stroke();ctx.shadowBlur=0;ctx.restore();P.mat={x:CX,y:680};},
    plate:function(t,P){nightTop(560);crowd(560);grassFloor(560);
      // batter's box + home plate, lower-centre
      ctx.fillStyle='#7a4a25';ctx.fillRect(0,820,W,H-820);ctx.strokeStyle='rgba(255,255,255,0.6)';ctx.lineWidth=4;ctx.strokeRect(820,900,120,150);ctx.strokeRect(1000,900,120,150);
      ctx.fillStyle='#fff';ctx.beginPath();ctx.moveTo(940,1010);ctx.lineTo(990,1010);ctx.lineTo(990,1040);ctx.lineTo(965,1060);ctx.lineTo(940,1040);ctx.closePath();ctx.fill();P.zone={x:965,y:560};},
    // Neutral arena — sport-agnostic dark stands + floor glow. Used by the
    // horn cue (fired at period start/end across every sport).
    arena:function(t,P){nightTop(640);crowd(640);var g=ctx.createLinearGradient(0,640,0,H);g.addColorStop(0,'#0a121e');g.addColorStop(1,'#05070d');ctx.fillStyle=g;ctx.fillRect(0,640,W,H-640);ctx.strokeStyle=rgba(TRGB,0.25);ctx.lineWidth=3;ctx.shadowColor=TEAM;ctx.shadowBlur=14;ctx.beginPath();ctx.moveTo(0,648);ctx.lineTo(W,648);ctx.stroke();ctx.shadowBlur=0;P.up={x:W/2,y:540};}
  };
  function polyF(pts,fill){ctx.beginPath();ctx.moveTo(pts[0][0],pts[0][1]);for(var i=1;i<pts.length;i++)ctx.lineTo(pts[i][0],pts[i][1]);ctx.closePath();ctx.fillStyle=fill;ctx.fill();}

  // ── motifs (drawn centre-ish, animate in) ─────────────────────
  var MOTIFS={
    card:function(t,T,o){var p=easeOutBack(seg(t,300,820));var col=o.motifColor||'#ffd21a';ctx.save();ctx.translate(W/2,560);ctx.rotate(lerp(-0.5,0.12,p));ctx.scale(p,p);ctx.shadowColor=col;ctx.shadowBlur=40;rrect(-110,-160,220,320,16);ctx.fillStyle=col;ctx.fill();ctx.restore();},
    whistle:function(t,T,o){var p=seg(t,300,820);ctx.save();ctx.translate(W/2,560);ctx.globalAlpha=p;ctx.fillStyle='#e9eef6';ctx.shadowColor=TEAM;ctx.shadowBlur=24;rrect(-90,-44,150,88,40);ctx.fill();ctx.beginPath();ctx.arc(70,0,40,0,Math.PI*2);ctx.fill();ctx.restore();},
    glove:function(t,T,o){var p=easeOutBack(seg(t,300,820));ctx.save();ctx.translate(W/2,540);ctx.scale(p,p);ctx.fillStyle='#caa24a';ctx.shadowColor=TEAM;ctx.shadowBlur=24;ctx.beginPath();ctx.arc(0,0,120,0.2,Math.PI*2-0.2);ctx.arc(0,0,55,Math.PI*2-0.2,0.2,true);ctx.closePath();ctx.fill();ctx.restore();},
    bigK:function(t,T,o){var p=easeOutBack(seg(t,300,820));ctx.save();ctx.translate(W/2,540);ctx.scale(p,p);ctx.font='900 360px Arial Black';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillStyle=rgba(TLT,1);ctx.shadowColor=TEAM;ctx.shadowBlur=40;ctx.fillText('K',0,0);ctx.restore();},
    clock0:function(t,T,o){var p=easeOutBack(seg(t,300,820));ctx.save();ctx.translate(W/2,520);ctx.scale(p,p);ctx.fillStyle='#0a0e16';ctx.strokeStyle=rgba(TLT,1);ctx.lineWidth=8;ctx.shadowColor=TEAM;ctx.shadowBlur=26;rrect(-180,-90,360,180,20);ctx.fill();ctx.stroke();ctx.shadowBlur=0;ctx.fillStyle='#ff3b30';ctx.font='900 130px monospace';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText('0:00',0,4);ctx.restore();},
    hats:function(t,T,o){for(var i=0;i<3;i++){var p=seg(t,200+i*120,1100+i*120);var x=W*0.5+(i-1)*220,y=lerp(-120,560,p);ctx.save();ctx.translate(x,y);ctx.rotate((i-1)*0.3);ctx.fillStyle=['#e23a26','#1f5fd0',rgba(TLT,1)][i];ctx.shadowColor=TEAM;ctx.shadowBlur=18;rrect(-70,-20,140,40,8);ctx.fill();ctx.beginPath();ctx.ellipse(0,-20,46,38,0,Math.PI,0);ctx.fill();ctx.restore();}},
    shield:function(t,T,o){var p=easeOutBack(seg(t,300,820));ctx.save();ctx.translate(W/2,540);ctx.scale(p,p);ctx.fillStyle=rgba(TRGB,0.85);ctx.strokeStyle='#fff';ctx.lineWidth=8;ctx.shadowColor=TEAM;ctx.shadowBlur=30;ctx.beginPath();ctx.moveTo(0,-130);ctx.lineTo(110,-80);ctx.lineTo(95,70);ctx.quadraticCurveTo(0,160,0,160);ctx.quadraticCurveTo(0,160,-95,70);ctx.lineTo(-110,-80);ctx.closePath();ctx.fill();ctx.stroke();ctx.restore();},
    plus1:function(t,T,o){var p=easeOutBack(seg(t,300,820));ctx.save();ctx.translate(W/2,540);ctx.scale(p,p);ctx.font='900 220px Arial Black';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillStyle='#fff';ctx.shadowColor=TEAM;ctx.shadowBlur=34;ctx.fillText(o.motifText||'+1',0,0);ctx.restore();},
    arrowFD:function(t,T,o){var p=seg(t,300,860);ctx.save();ctx.translate(lerp(W*0.5-260,W*0.5,easeOutCubic(p)),540);ctx.globalAlpha=p;ctx.fillStyle='#ffd21a';ctx.shadowColor='#ffd21a';ctx.shadowBlur=26;ctx.beginPath();ctx.moveTo(-160,-40);ctx.lineTo(80,-40);ctx.lineTo(80,-90);ctx.lineTo(190,0);ctx.lineTo(80,90);ctx.lineTo(80,40);ctx.lineTo(-160,40);ctx.closePath();ctx.fill();ctx.restore();},
    swirl:function(t,T,o){var p=seg(t,300,900);ctx.save();ctx.translate(W/2,540);ctx.rotate(p*6);ctx.globalAlpha=clamp(p*1.3,0,1);ctx.strokeStyle=rgba(TLT,1);ctx.lineWidth=18;ctx.lineCap='round';ctx.shadowColor=TEAM;ctx.shadowBlur=26;for(var k=0;k<3;k++){ctx.beginPath();ctx.arc(0,0,90+k*30,k*2,k*2+4);ctx.stroke();}ctx.restore();},
    // Klaxon + emanating sound arcs — the visual for the `horn` cue (paired
    // with the synthesized air-horn in celebration-sound.js).
    soundwave:function(t,T,o){var cx=W/2,cy=520;var p=easeOutBack(seg(t,260,760));
      ctx.save();ctx.translate(cx-30,cy);ctx.scale(p,p);ctx.shadowColor=TEAM;ctx.shadowBlur=34;
      ctx.fillStyle=rgba(TLT,1);ctx.strokeStyle='#fff';ctx.lineWidth=7;
      ctx.beginPath();ctx.moveTo(-150,-30);ctx.lineTo(-50,-30);ctx.lineTo(30,-120);ctx.lineTo(30,120);ctx.lineTo(-50,30);ctx.lineTo(-150,30);ctx.closePath();ctx.fill();ctx.stroke();
      ctx.fillStyle='#0a0e16';rrect(-210,-40,70,80,10);ctx.fill();ctx.stroke();ctx.restore();ctx.shadowBlur=0;
      ctx.save();ctx.translate(cx+60,cy);ctx.lineCap='round';
      for(var k=0;k<4;k++){var ap=seg(t,360+k*200,360+k*200+1000);if(ap<=0||ap>=1)continue;var r=lerp(60,520,ap);ctx.globalAlpha=(1-ap)*0.95;ctx.strokeStyle=rgba(TLT,1);ctx.lineWidth=18*(1-ap)+4;ctx.shadowColor=TEAM;ctx.shadowBlur=22;ctx.beginPath();ctx.arc(0,0,r,-0.62,0.62);ctx.stroke();}
      ctx.restore();ctx.globalAlpha=1;ctx.shadowBlur=0;}
  };

  // ── goalie saves: the shot is STOPPED in front of the goal (never scored) ──
  function drawSave(t,T,pt){ // a GIANT X slams over the goal mouth — shot DENIED
    var pop=easeOutBack(clamp(seg(t,T.impact-160,T.impact+240),0,1)); if(pop<=0)return;
    var jolt=(t>=T.impact&&t<T.impact+160)?Math.sin((t-T.impact)/160*Math.PI)*7:0;
    var L=170;ctx.save();ctx.translate(pt.x,pt.y+jolt);ctx.scale(pop,pop);ctx.lineCap='round';
    function bars(){ctx.beginPath();ctx.moveTo(-L,-L);ctx.lineTo(L,L);ctx.moveTo(L,-L);ctx.lineTo(-L,L);ctx.stroke();}
    ctx.shadowColor=TEAM;ctx.shadowBlur=55;ctx.strokeStyle=rgba(TRGB,0.96);ctx.lineWidth=66;bars();   // team body + glow
    ctx.shadowBlur=0;ctx.strokeStyle=rgba(TLT,1);ctx.lineWidth=40;bars();                              // lighter mid
    ctx.strokeStyle='#ffffff';ctx.lineWidth=18;bars();                                                 // white core
    ctx.restore();
  }

  // ── main run ──────────────────────────────────────────────────
  var startMs=0,rafId=0,prevMs=0,fired=false,CFG=null;
  // Schedule the synthesized SFX at the cue's impact moment: a sustained
  // air-horn for the `horn` cue, an impact boom under every scoring cue
  // (cue.sound:false opts a cue out). Skipped while paused (screenshot mode).
  function playCueSound(){
    if(PAUSE!=null||!CFG||typeof window==='undefined'||!window.CELSOUND)return;
    var s=window.CELSOUND, base=s.now();
    if(!base)return; // AudioContext blocked (no gesture yet) — stay silent, don't throw
    var impactSec=base+((CFG.T&&CFG.T.impact?CFG.T.impact:1000)/1000)-0.05;
    if(CFG.horn){s.horn(impactSec,{dur:1.1});}
    else if(CFG.sound!==false){s.boom(impactSec);}
  }
  function reset(){cancelAnimationFrame(rafId);TRGB=hexToRgb(TEAM);TLT=lighten(TRGB,0.5);startMs=0;fired=false;parts=[];shells=[];playCueSound();rafId=requestAnimationFrame(frame);}
  function frame(ms){
    if(!startMs){startMs=ms;prevMs=ms;}
    var t=ms-startMs,dt=Math.min(0.05,(ms-prevMs)/1000);prevMs=ms;var T=CFG.T;
    var shake=(t>=T.impact&&t<T.impact+460)?(1-(t-T.impact)/460)*(CFG.shake||16):0;
    ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,W,H);ctx.save();ctx.translate((Math.random()-0.5)*shake,(Math.random()-0.5)*shake);
    var P={};
    (SCENES[CFG.scene]||SCENES.court)(t,P);
    var impactPt=CFG.impactPt?CFG.impactPt(P):(P.goal||P.rim||P.net||P.up||P.wall||P.mat||P.zone||{x:CX,y:560});
    if(CFG.save)drawSave(t,T,impactPt);
    if(CFG.projectile){var pr=CFG.projectile;
      if(t<=pr.t1){var bt=seg(t,pr.t0,pr.t1);var bx=lerp(pr.from[0],impactPt.x,pr.ease==='lin'?bt:easeOutQuad(bt));var by=lerp(pr.from[1],impactPt.y,bt)-Math.sin(Math.PI*bt)*(pr.arc||0);(BALLS[pr.ball]||BALLS.soccer)(bx,by,(pr.r||32)*(pr.shrink?(1-bt*0.3):1),t*0.02);}
      else if(pr.deflect){var e=(t-pr.t1)/1000;if(e<=0.85){var dx=impactPt.x+pr.deflect[0]*e*320,dy=impactPt.y+pr.deflect[1]*e*320+760*e*e;ctx.globalAlpha=clamp(1-e/0.85,0,1);(BALLS[pr.ball]||BALLS.soccer)(dx,dy,(pr.r||32),t*0.02);ctx.globalAlpha=1;}}
      else if(pr.caught){(BALLS[pr.ball]||BALLS.soccer)(impactPt.x,impactPt.y,(pr.r||32),t*0.02);}
      else if(t<=pr.t1+90){(BALLS[pr.ball]||BALLS.soccer)(impactPt.x,impactPt.y,(pr.r||32),t*0.02);}
    }
    if(CFG.motif&&MOTIFS[CFG.motif])MOTIFS[CFG.motif](t,T,CFG);
    if(t>=T.impact&&!fired){fired=true;BURST_AT=T.impact;if(CFG.burst&&CFG.burst!=='none')spawnBurst(impactPt.x,impactPt.y,CFG.burst);}
    if(CFG.burst&&CFG.burst!=='none')shockwave(t,T,impactPt.x,impactPt.y);
    stepShells(t);stepParts(dt);drawParts();
    headline(t,T,CFG.headline,CFG.headSize);lowerThird(t,T,CFG.sub1,CFG.sub2);
    var f=0;if(t>=T.impact&&t<T.impact+180)f=1-(t-T.impact)/180;if(f>0){ctx.fillStyle='rgba(255,250,235,'+(f*0.5)+')';ctx.fillRect(0,0,W,H);}
    if(t<T.fadeIn){ctx.fillStyle='rgba(5,9,16,'+(1-t/T.fadeIn)+')';ctx.fillRect(-60,-60,W+120,H+120);}
    if(t>T.hold){var fo=seg(t,T.hold,T.end);ctx.fillStyle='rgba(5,9,16,'+fo+')';ctx.fillRect(-60,-60,W+120,H+120);}
    ctx.restore();
    if(PAUSE!=null&&t>=PAUSE)return;
    if(t<T.end)rafId=requestAnimationFrame(frame);
  }

  window.VENUE={
    run:function(cfg){
      cv=document.getElementById('c');ctx=cv.getContext('2d');
      cfg.T=Object.assign({fadeIn:420,impact:1000,head:1020,hold:3300,end:4300},cfg.T||{});
      CFG=cfg;
      var rp=document.getElementById('replay');if(rp)rp.addEventListener('click',reset);
      var sw=document.querySelectorAll('.sw');for(var i=0;i<sw.length;i++)sw[i].addEventListener('click',function(e){TEAM=e.currentTarget.getAttribute('data-c');reset();});
      reset();
    },
    CUES:null
  };
})();
