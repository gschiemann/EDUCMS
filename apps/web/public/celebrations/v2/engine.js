/* VenueOS · Celebration Engine v2 — modern stadium aesthetic.
 * Two output formats from one cue definition:
 *   • scoreboard (1920×1080) — one-shot cinematic, plays once and fades
 *   • ribbon    (any × 256)  — seamless loop tile for 3.9mm pitch LED ribbon
 *
 * Cues live in cues-*.js and register themselves with VENUE.register(key, cue).
 * Pass ?cue=KEY&format=scoreboard|ribbon&team=21e6ff to render.
 *
 * Aesthetic system:
 *   – Display type: Anton (Bebas-ish, ultra-condensed)
 *   – Mono numbers: JetBrains Mono
 *   – Body / scorebug: Inter
 *   – Backgrounds: abstract — no toy dioramas. Color, light, geometry.
 *   – Phases:  anticipation → IMPACT (flash + slam) → settle → hold → exit
 */
(function () {
  "use strict";

  // ───────────────────────────────────────────── utils
  function $(s){return document.querySelector(s);}
  function hexToRgb(h){h=String(h).replace('#','');if(h.length===3)h=h.split('').map(function(x){return x+x;}).join('');return [parseInt(h.slice(0,2),16),parseInt(h.slice(2,4),16),parseInt(h.slice(4,6),16)];}
  function rgba(c,a){return 'rgba('+c[0]+','+c[1]+','+c[2]+','+a+')';}
  function lighten(c,f){return [Math.min(255,c[0]+(255-c[0])*f)|0,Math.min(255,c[1]+(255-c[1])*f)|0,Math.min(255,c[2]+(255-c[2])*f)|0];}
  function darken(c,f){return [c[0]*(1-f)|0,c[1]*(1-f)|0,c[2]*(1-f)|0];}
  function mix(a,b,t){return [lerp(a[0],b[0],t)|0,lerp(a[1],b[1],t)|0,lerp(a[2],b[2],t)|0];}
  function clamp(v,a,b){return v<a?a:(v>b?b:v);}
  function lerp(a,b,t){return a+(b-a)*t;}
  function seg(t,a,b){return clamp((t-a)/(b-a),0,1);}
  function easeOutCubic(t){return 1-Math.pow(1-t,3);}
  function easeOutQuint(t){return 1-Math.pow(1-t,5);}
  function easeInOutCubic(t){return t<0.5?4*t*t*t:1-Math.pow(-2*t+2,3)/2;}
  function easeOutBack(t){var c=1.6,d=c+1;return 1+d*Math.pow(t-1,3)+c*Math.pow(t-1,2);}
  function easeInQuad(t){return t*t;}
  function easeOutExpo(t){return t===1?1:1-Math.pow(2,-10*t);}

  // ───────────────────────────────────────────── registry
  var REGISTRY = {};
  function register(key, cfg){ REGISTRY[key] = cfg; }
  function get(key){ return REGISTRY[key]; }
  function list(){ return Object.keys(REGISTRY); }

  // ───────────────────────────────────────────── particle systems
  function ParticleSystem(){
    this.parts = [];
  }
  ParticleSystem.prototype.spawnWaterBurst = function(x, y, opts){
    opts = opts || {};
    var foam = opts.foam || [223,246,255];
    var team = opts.team || [33,230,255];
    var n = opts.count || 240;
    var up = opts.up || 9;
    for(var i=0;i<n;i++){
      var a = (-Math.PI/2) + (Math.random()-0.5)*2.3;
      var sp = 7 + Math.random()*28;
      var col;
      var r = Math.random();
      if(r<0.5) col = '#ffffff';
      else if(r<0.85) col = rgba(foam,1);
      else col = rgba(team,1);
      this.parts.push({
        x:x, y:y, vx:Math.cos(a)*sp, vy:Math.sin(a)*sp-up,
        life:0.8+Math.random()*0.8, r:2+Math.random()*7,
        col:col, grav:0.55, kind:'drop'
      });
    }
    // central column
    for(var i=0;i<60;i++){
      var sp2 = 18+Math.random()*30;
      this.parts.push({
        x:x+(Math.random()-0.5)*60, y:y,
        vx:(Math.random()-0.5)*6, vy:-sp2,
        life:0.9+Math.random()*0.6, r:3+Math.random()*7,
        col: Math.random()<0.5 ? '#ffffff' : rgba(foam,1),
        grav:0.55, kind:'drop'
      });
    }
    // sparks
    for(var i=0;i<30;i++){
      var a3 = (-Math.PI/2)+(Math.random()-0.5)*2.6;
      var sp3 = 18+Math.random()*30;
      this.parts.push({
        x:x, y:y, vx:Math.cos(a3)*sp3, vy:Math.sin(a3)*sp3,
        life:0.8, r:0, col:'#ffffff', grav:0.35, kind:'spark'
      });
    }
    // mist puffs
    for(var i=0;i<36;i++){
      var a4 = Math.random()*Math.PI*2, sp4 = 1+Math.random()*5;
      this.parts.push({
        x:x, y:y, vx:Math.cos(a4)*sp4, vy:Math.sin(a4)*sp4-3,
        life:1+Math.random()*0.7, r:18+Math.random()*30,
        col:rgba(foam,1), grav:0, kind:'mist'
      });
    }
  };
  ParticleSystem.prototype.step = function(dt){
    for(var i=this.parts.length-1;i>=0;i--){
      var p=this.parts[i];
      if(p.kind==='mist'){ p.vy -= 0.07; p.vx *= 0.96; p.vy *= 0.97; p.r += 22*dt; p.life -= dt*0.7; }
      else if(p.kind==='spark'){ p.vy += p.grav; p.vx*=0.99; p.life -= dt*1.6; }
      else { p.vy += p.grav; p.vx *= 0.995; p.life -= dt*0.85; }
      p.x += p.vx; p.y += p.vy;
      if(p.life<=0) this.parts.splice(i,1);
    }
  };
  ParticleSystem.prototype.draw = function(ctx, foam){
    foam = foam || [223,246,255];
    ctx.globalCompositeOperation = 'lighter';
    // mist
    for(var i=0;i<this.parts.length;i++){
      var p=this.parts[i]; if(p.kind!=='mist') continue;
      var a = clamp(p.life,0,1)*0.16;
      var g = ctx.createRadialGradient(p.x,p.y,0,p.x,p.y,p.r);
      g.addColorStop(0,'rgba(235,250,255,'+a+')');
      g.addColorStop(1,'rgba(180,230,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(p.x,p.y,p.r,0,Math.PI*2); ctx.fill();
    }
    // sparks
    for(var i=0;i<this.parts.length;i++){
      var p=this.parts[i]; if(p.kind!=='spark') continue;
      ctx.globalAlpha = clamp(p.life,0,1);
      ctx.strokeStyle = '#ffffff';
      ctx.shadowColor = '#ffffff';
      ctx.shadowBlur = 12;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(p.x,p.y);
      ctx.lineTo(p.x-p.vx*1.6, p.y-p.vy*1.6);
      ctx.stroke();
    }
    // droplets
    for(var i=0;i<this.parts.length;i++){
      var p=this.parts[i]; if(p.kind!=='drop') continue;
      ctx.globalAlpha = clamp(p.life,0,1);
      ctx.fillStyle = p.col;
      ctx.shadowColor = rgba(foam,1);
      ctx.shadowBlur = 9;
      ctx.beginPath();
      ctx.arc(p.x,p.y,p.r*clamp(p.life+0.2,0,1.2),0,Math.PI*2);
      ctx.fill();
    }
    ctx.globalAlpha = 1; ctx.shadowBlur = 0;
    ctx.globalCompositeOperation = 'source-over';
  };

  // ───────────────────────────────────────────── shared draw helpers
  // Pool atmosphere: void above, animated water below (no goal illustration).
  function drawPoolAtmos(ctx, t, W, H, team){
    var waterY = H * 0.58;
    // void above
    var g = ctx.createLinearGradient(0,0,0,waterY);
    g.addColorStop(0, '#03070d');
    g.addColorStop(1, '#062234');
    ctx.fillStyle = g;
    ctx.fillRect(0,0,W,waterY);

    // arena spotlights — small soft dots in upper third
    ctx.globalCompositeOperation = 'lighter';
    for(var i=0;i<9;i++){
      var lx = (i+0.5) * (W/9);
      var ly = 50 + ((i*53)%80);
      var gg = ctx.createRadialGradient(lx,ly,0,lx,ly,140);
      gg.addColorStop(0,'rgba(190,225,255,0.10)');
      gg.addColorStop(1,'rgba(190,225,255,0)');
      ctx.fillStyle = gg;
      ctx.beginPath(); ctx.arc(lx,ly,140,0,Math.PI*2); ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';

    // water body
    var wg = ctx.createLinearGradient(0,waterY,0,H);
    wg.addColorStop(0, '#0a6b94');
    wg.addColorStop(0.5,'#063f60');
    wg.addColorStop(1, '#020e1c');
    ctx.fillStyle = wg;
    ctx.fillRect(0,waterY,W,H-waterY);

    // animated caustics
    ctx.globalCompositeOperation = 'lighter';
    var rows = 14;
    for(var c=0;c<rows;c++){
      var yy = waterY + 18 + c * ((H-waterY-18)/rows);
      var amp = 6 + c*1.2;
      var phase = t*0.0011*(0.45+c*0.11) + c*0.7;
      ctx.strokeStyle = 'rgba(190,235,255,'+(0.04+0.04*Math.sin(phase*2))+')';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      for(var x=0;x<=W;x+=22){
        var yo = Math.sin(x*0.011 + phase*3) * amp + Math.sin(x*0.005 - phase*2) * amp*0.5;
        if(x===0) ctx.moveTo(x,yy+yo); else ctx.lineTo(x,yy+yo);
      }
      ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';

    // surface line — clean, bright
    var surf = ctx.createLinearGradient(0,waterY-2,0,waterY+3);
    surf.addColorStop(0,'rgba(0,0,0,0)');
    surf.addColorStop(0.5,'rgba(220,245,255,0.7)');
    surf.addColorStop(1,'rgba(0,0,0,0)');
    ctx.fillStyle = surf;
    ctx.fillRect(0,waterY-2,W,5);

    // team-color underglow at surface
    ctx.globalCompositeOperation = 'lighter';
    var ug = ctx.createLinearGradient(0,waterY,0,waterY+90);
    ug.addColorStop(0, rgba(team,0.18));
    ug.addColorStop(1, rgba(team,0));
    ctx.fillStyle = ug;
    ctx.fillRect(0,waterY,W,90);
    ctx.globalCompositeOperation = 'source-over';

    return waterY;
  }

  // Vignette + scanline overlay applied last for broadcast feel.
  function drawVignette(ctx, W, H){
    var g = ctx.createRadialGradient(W*0.5, H*0.5, Math.min(W,H)*0.35, W*0.5, H*0.5, Math.max(W,H)*0.7);
    g.addColorStop(0,'rgba(0,0,0,0)');
    g.addColorStop(1,'rgba(0,0,0,0.55)');
    ctx.fillStyle = g;
    ctx.fillRect(0,0,W,H);
  }
  function drawScanlines(ctx, W, H, opacity){
    opacity = opacity || 0.06;
    ctx.globalAlpha = opacity;
    ctx.fillStyle = '#000';
    for(var y=0;y<H;y+=3) ctx.fillRect(0,y,W,1);
    ctx.globalAlpha = 1;
  }

  // ── chevron sweep — diagonal team-color wedge slamming across screen
  function drawChevronSweep(ctx, t, T, W, H, team, hot){
    var p = seg(t, T.impact-20, T.impact+520);
    if(p<=0||p>=1) return;
    var ep = easeOutQuint(p);
    var x0 = lerp(-W*0.4, W*1.2, ep);
    ctx.save();
    ctx.translate(x0, 0);
    ctx.fillStyle = rgba(team, 0.95 * (1-p*0.4));
    ctx.beginPath();
    var w = W*0.34, sk = H*0.25;
    ctx.moveTo(0,0); ctx.lineTo(w,0); ctx.lineTo(w-sk,H); ctx.lineTo(-sk,H); ctx.closePath();
    ctx.fill();
    // bright leading edge
    ctx.fillStyle = 'rgba(255,255,255,'+(0.7*(1-p))+')';
    ctx.beginPath();
    ctx.moveTo(w,0); ctx.lineTo(w+18,0); ctx.lineTo(w+18-sk,H); ctx.lineTo(w-sk,H); ctx.closePath();
    ctx.fill();
    // hot trailing edge
    ctx.fillStyle = rgba(hot,0.55*(1-p));
    ctx.beginPath();
    ctx.moveTo(-26,0); ctx.lineTo(0,0); ctx.lineTo(-sk,H); ctx.lineTo(-sk-26,H); ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  // ── shockwave ring
  function drawShock(ctx, t, T, x, y, team, foam){
    if(t<T.impact || t>T.impact+800) return;
    var p = seg(t,T.impact,T.impact+800);
    ctx.globalCompositeOperation = 'lighter';
    var coreP = seg(t,T.impact,T.impact+260);
    var coreR = lerp(12,210,easeOutCubic(coreP)) * (1-coreP*0.35);
    var cg = ctx.createRadialGradient(x,y,0,x,y,coreR);
    cg.addColorStop(0,'rgba(255,255,255,'+(1-coreP)+')');
    cg.addColorStop(0.4, rgba(foam,(1-coreP)*0.8));
    cg.addColorStop(1,'rgba(255,255,255,0)');
    ctx.fillStyle = cg;
    ctx.beginPath(); ctx.arc(x,y,coreR,0,Math.PI*2); ctx.fill();
    ctx.globalCompositeOperation = 'source-over';

    // expanding stroke ring
    var R = easeOutCubic(p)*640;
    ctx.strokeStyle = rgba(lighten(team,0.4),(1-p)*0.85);
    ctx.lineWidth = 10*(1-p)+2;
    ctx.shadowColor = rgba(team,1);
    ctx.shadowBlur = 28;
    ctx.beginPath(); ctx.arc(x,y,R,0,Math.PI*2); ctx.stroke();
    ctx.shadowBlur = 0;
  }

  // ── white impact flash
  function drawFlash(ctx, t, T, W, H, intensity){
    var f = 0;
    if(t>=T.impact && t<T.impact+220) f = 1-(t-T.impact)/220;
    if(f>0){
      // `intensity` (default 1) lets a cue soften the impact flash so the
      // action stays visible — e.g. the goal needs to SEE the ball enter
      // the net, not be washed out.
      var k = (intensity==null ? 1 : intensity);
      ctx.fillStyle = 'rgba(245,250,255,'+(f*0.78*k)+')';
      ctx.fillRect(0,0,W,H);
    }
  }

  // ── full-bleed fade in/out
  function drawFades(ctx, t, T, W, H){
    if(t < T.fadeIn){
      ctx.fillStyle = 'rgba(3,7,13,'+(1-t/T.fadeIn)+')';
      ctx.fillRect(0,0,W,H);
    }
    if(t > T.hold){
      var fo = seg(t, T.hold, T.end);
      ctx.fillStyle = 'rgba(3,7,13,'+fo+')';
      ctx.fillRect(0,0,W,H);
    }
  }

  // ── eyebrow + headline + slash
  function drawHeadline(ctx, t, T, W, H, opts){
    var headIn = T.impact + 60;
    var p = seg(t, headIn, headIn + 460);
    if(p<=0) return;

    var glitch = t < headIn + 240 ? (Math.random()-0.5)*8 : 0;
    var headline = opts.headline || 'GOAL';
    var size     = opts.size     || 540;
    var team     = opts.team;
    var hot      = opts.hot || [255,45,85];
    var pos      = opts.pos || { x: W/2, y: H*0.42 };
    var align    = opts.align || 'center';

    var s = lerp(1.5, 1.0, easeOutQuint(p));
    ctx.save();
    ctx.translate(pos.x + glitch, pos.y);
    ctx.scale(s, s);
    ctx.textAlign = align;
    ctx.textBaseline = 'middle';
    ctx.font = '400 ' + size + 'px "Anton", "Bebas Neue", Impact, sans-serif';
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = rgba(hot, 0.9);
    ctx.fillText(headline, -10, 0);
    ctx.fillStyle = rgba(team, 0.9);
    ctx.fillText(headline, 10, 0);
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = rgba(team,1);
    ctx.shadowBlur = 60;
    ctx.fillText(headline, 0, 0);
    ctx.shadowBlur = 0;
    ctx.globalCompositeOperation = 'source-over';
    ctx.restore();

    // team-color underbar follows the headline
    var bp = seg(t, headIn+220, headIn+620);
    if(bp>0){
      var ew = easeOutQuint(bp);
      var textW = size * headline.length * 0.48;  // rough metric
      var barW = lerp(0, textW, ew);
      var barH = 14;
      var barY = pos.y + size*0.38;
      var barX = align==='left' ? pos.x
               : align==='right' ? pos.x - barW
               : pos.x - barW/2;
      ctx.fillStyle = rgba(team, 0.95);
      ctx.shadowColor = rgba(team,1);
      ctx.shadowBlur = 20;
      ctx.fillRect(barX, barY, barW, barH);
      ctx.shadowBlur = 0;
      ctx.fillStyle = rgba(hot, 0.95);
      ctx.fillRect(barX + barW - barW*0.18, barY, barW*0.18, barH);
    }
  }

  // ── compact info line: player + context, below the headline
  function drawInfoLine(ctx, t, T, W, H, opts){
    var inT = T.impact + 360;
    var p = seg(t, inT, inT + 380);
    if(p<=0) return;
    var pos   = opts.pos   || { x: W/2, y: H*0.66 };
    var align = opts.align || 'center';
    ctx.save();
    ctx.globalAlpha = p;
    var slide = (1-easeOutCubic(p)) * 22;

    if(opts.player){
      ctx.textAlign = align;
      ctx.textBaseline = 'middle';
      ctx.font = '900 56px "Inter", sans-serif';
      ctx.fillStyle = '#ffffff';
      ctx.shadowColor = 'rgba(0,0,0,0.8)';
      ctx.shadowBlur = 12;
      ctx.fillText('#' + opts.player.number + '   ' + opts.player.name, pos.x, pos.y + slide);
      ctx.shadowBlur = 0;
    }
    if(opts.context){
      ctx.font = '700 26px "JetBrains Mono", monospace';
      ctx.fillStyle = rgba(lighten(opts.team,0.5), 0.95);
      ctx.fillText(opts.context, pos.x, pos.y + 50 + slide);
    }
    ctx.restore();
  }

  // ── scorebug: HOME | center context | AWAY
  function drawScorebug(ctx, t, T, W, H, opts){
    var inT = T.impact + 380;
    var p = seg(t, inT, inT + 460);
    if(p<=0) return;
    var slide = lerp(80, 0, easeOutCubic(p));

    var barY = H - 168 - slide;
    var barH = 168;

    // backing — dark with subtle gradient
    var bg = ctx.createLinearGradient(0, barY, 0, barY+barH);
    bg.addColorStop(0, 'rgba(8,12,20,0.0)');
    bg.addColorStop(0.18,'rgba(8,12,20,0.88)');
    bg.addColorStop(1,   'rgba(8,12,20,0.95)');
    ctx.fillStyle = bg;
    ctx.fillRect(0, barY, W, barH);
    ctx.globalAlpha = p;

    // top accent line in team color
    ctx.fillStyle = rgba(opts.team, 0.85);
    ctx.fillRect(0, barY, W, 3);
    ctx.fillStyle = rgba(opts.hot || [255,45,85], 0.9);
    ctx.fillRect(W*0.78, barY, W*0.22, 3);

    var score = opts.score;
    var home = score.home, away = score.away;

    // HOME block
    drawTeamBlock(ctx, 80, barY+24, 720, barH-48, home, true, opts);
    // AWAY block (mirrored)
    drawTeamBlock(ctx, W-80-720, barY+24, 720, barH-48, away, false, opts);

    // center context
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '900 36px "Inter", sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.fillText(opts.headline || 'GOAL', W/2, barY + 50);

    ctx.font = '700 26px "JetBrains Mono", monospace';
    ctx.fillStyle = rgba(lighten(opts.team,0.45),1);
    ctx.fillText('#' + opts.player.number + '  ·  ' + opts.player.name, W/2, barY + 92);

    ctx.font = '500 22px "JetBrains Mono", monospace';
    ctx.fillStyle = 'rgba(180,200,220,0.85)';
    ctx.fillText(opts.context || '', W/2, barY + 128);

    ctx.globalAlpha = 1;
  }

  function drawTeamBlock(ctx, x, y, w, h, team, isHome, opts){
    // color block: tall vertical bar in team color
    var barW = 14;
    ctx.fillStyle = team.color;
    ctx.fillRect(isHome ? x : x+w-barW, y, barW, h);

    // abbr
    ctx.textBaseline = 'middle';
    ctx.font = '900 64px "Inter", sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = isHome ? 'left' : 'right';
    ctx.fillText(team.abbr, isHome ? x+34 : x+w-34, y + h*0.34);

    // full name (smaller)
    ctx.font = '600 22px "Inter", sans-serif';
    ctx.fillStyle = 'rgba(180,200,220,0.8)';
    ctx.fillText(team.name.toUpperCase(), isHome ? x+34 : x+w-34, y + h*0.68);

    // score on the inner side
    ctx.font = '700 100px "JetBrains Mono", monospace';
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = isHome ? 'right' : 'left';
    var sx = isHome ? x+w-16 : x+16;
    ctx.fillText(String(team.goals), sx, y + h*0.50);
  }

  // ── light shaft slamming down (visual anchor for IMPACT)
  function drawLightShaft(ctx, t, T, x, y, W, team){
    var ent = seg(t, T.impact-160, T.impact);     // arriving
    var hold = seg(t, T.impact, T.impact+420);    // fades after impact
    var alpha = ent * (1 - hold);
    if(alpha<=0) return;
    ctx.globalCompositeOperation = 'lighter';
    var topX = x + (Math.random()-0.5)*4;
    var width = lerp(280, 80, ent) * (1 - hold*0.4);
    var g = ctx.createLinearGradient(topX, 0, topX, y);
    g.addColorStop(0, rgba(team, 0));
    g.addColorStop(0.4, rgba(lighten(team,0.45), alpha*0.5));
    g.addColorStop(0.9, rgba(lighten(team,0.45), alpha*0.95));
    g.addColorStop(1, 'rgba(255,255,255,'+alpha+')');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(topX - width*0.06, 0);
    ctx.lineTo(topX + width*0.06, 0);
    ctx.lineTo(x + width*0.5, y);
    ctx.lineTo(x - width*0.5, y);
    ctx.closePath();
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
  }

  // ── corner brackets — broadcast frame
  function drawBrackets(ctx, t, T, W, H, team){
    var p = seg(t, T.impact+200, T.impact+600);
    if(p<=0) return;
    var ep = easeOutQuint(p);
    var len = lerp(0, 90, ep);
    ctx.strokeStyle = rgba(lighten(team,0.5), 0.85);
    ctx.lineWidth = 4;
    var pad = 32;
    var corners = [
      [pad,pad,1,1], [W-pad,pad,-1,1],
      [pad,H-pad-180,1,-1], [W-pad,H-pad-180,-1,-1]
    ];
    for(var i=0;i<corners.length;i++){
      var c=corners[i];
      ctx.beginPath();
      ctx.moveTo(c[0], c[1]); ctx.lineTo(c[0]+len*c[2], c[1]);
      ctx.moveTo(c[0], c[1]); ctx.lineTo(c[0], c[1]+len*c[3]);
      ctx.stroke();
    }
  }

  // ───────────────────────────────────────────── scoreboard run
  function runScoreboard(canvas, key){
    var ctx = canvas.getContext('2d');
    var W = canvas.width, H = canvas.height;
    var cfg = REGISTRY[key];
    if(!cfg){
      ctx.fillStyle='#04060b'; ctx.fillRect(0,0,W,H);
      ctx.fillStyle='#ff2d55'; ctx.font='700 48px Inter';
      ctx.fillText('Unknown cue: '+key, 40, 80);
      return null;
    }

    var query = new URLSearchParams(location.search);
    var team = hexToRgb(cfg.team || '#21e6ff');
    if(query.get('team')) team = hexToRgb('#'+query.get('team').replace('#',''));
    var hot = [255,45,85];
    var foam = [223,246,255];

    var T = Object.assign({fadeIn:380, impact:900, hold:3600, end:4400}, cfg.T||{});

    var startMs=0, prevMs=0, rafId=0;
    var ps = new ParticleSystem();
    var fired = false;
    var impactPt = cfg.impactPoint ? cfg.impactPoint(W,H) : {x:W*0.5, y:H*0.62};

    // setTimeout-based render loop (rAF is throttled in unfocused iframes,
    // unacceptable for a stadium player and breaks our dev preview too).
    // 2026-06-15 — plays the cinematic ONCE by default. The board + ribbon
    // embed this launcher and hold each cue for a FIXED window, then unmount
    // the iframe. The old auto-loop restarted the scene here, so a goal cue
    // began a SECOND play that the hold window then cut off mid-air — the
    // operator's exact report: "starts playing a second time then cuts off
    // real quick." Only an explicit ?loop=1 (design gallery / a continuous-
    // deck preview) loops; otherwise we stop ticking and freeze the final
    // (faded-out) frame until the parent surface removes the iframe.
    var doLoop = query.get('loop') === '1';
    function tick(){
      var ms = performance.now();
      frame(ms);
      var t = ms - (startMs||ms);
      if(!doLoop){
        // Play ONCE: run to the hold/peak, then STOP. frame() clamps time at
        // T.hold below, so the last painted frame is the HERO frame (ball in
        // net + GOAL) — it stays frozen until the parent surface removes the
        // iframe, instead of fading out and sitting dark, or restarting.
        if(t >= T.hold){ clearTimeout(rafId); rafId = 0; return; }
      } else if(t >= T.end + 800){
        startMs = 0; fired = false; ps = new ParticleSystem();
      }
      rafId = setTimeout(tick, 16);
    }

    function frame(ms){
      if(!startMs){ startMs = ms; prevMs = ms; }
      var t = ms - startMs;
      // Live one-shot: never advance past the hold/peak, so the cinematic
      // holds its hero frame (no authored fade-out, which only made sense for
      // the old auto-loop's gap-then-restart). ?loop=1 keeps the full cycle.
      if(!doLoop && t > T.hold) t = T.hold;
      var dt = Math.min(0.05, (ms-prevMs)/1000);
      prevMs = ms;

      var shake = (t>=T.impact && t<T.impact+520) ? (1-(t-T.impact)/520)*22 : 0;
      ctx.setTransform(1,0,0,1,0,0);
      ctx.clearRect(0,0,W,H);
      ctx.save();
      ctx.translate((Math.random()-0.5)*shake, (Math.random()-0.5)*shake);

      // background
      if(cfg.scene === 'pool') drawPoolAtmos(ctx, t, W, H, team);
      else drawPoolAtmos(ctx, t, W, H, team);

      // cue-specific scene composition (goal+net, props, etc.)
      if(cfg.drawScene) cfg.drawScene(ctx, t, T, W, H, team, impactPt);

      // anticipation: a horizontal scan line moves up from bottom
      if(t < T.impact){
        var ap = seg(t, T.impact-700, T.impact);
        var sy = lerp(H*0.95, H*0.50, easeInOutCubic(ap));
        ctx.globalCompositeOperation = 'lighter';
        var lg = ctx.createLinearGradient(0, sy-30, 0, sy+10);
        lg.addColorStop(0,'rgba(255,255,255,0)');
        lg.addColorStop(1, rgba(lighten(team,0.5), 0.45*ap));
        ctx.fillStyle = lg;
        ctx.fillRect(0, sy-30, W, 40);
        ctx.globalCompositeOperation = 'source-over';
      }

      // cue-specific pre-impact draw (e.g. ball flight) hook
      if(cfg.drawPreImpact) cfg.drawPreImpact(ctx, t, T, W, H, team, impactPt);

      // chevron sweep
      if(!cfg.noChevron) drawChevronSweep(ctx, t, T, W, H, team, hot);

      // light shaft
      if(!cfg.noLightShaft) drawLightShaft(ctx, t, T, impactPt.x, impactPt.y, W, team);

      // particle burst at impact
      if(t >= T.impact && !fired){
        fired = true;
        if(cfg.burst === 'water' || !cfg.burst){
          ps.spawnWaterBurst(impactPt.x, impactPt.y, {foam:foam, team:team});
        }
      }
      drawShock(ctx, t, T, impactPt.x, impactPt.y, team, foam);
      ps.step(dt); ps.draw(ctx, foam);

      // cue-specific overlay
      if(cfg.drawOverlay) cfg.drawOverlay(ctx, t, T, W, H, team, impactPt);

      // typography
      drawHeadline(ctx, t, T, W, H, {
        headline: cfg.headline, eyebrow: cfg.eyebrow, size: cfg.headSize,
        pos: cfg.headPos, align: cfg.headAlign,
        team: team, hot: hot
      });
      drawInfoLine(ctx, t, T, W, H, {
        player: cfg.player, context: cfg.context, team: team,
        pos: cfg.infoPos, align: cfg.infoAlign
      });

      drawFlash(ctx, t, T, W, H, cfg.flash);
      drawVignette(ctx, W, H);
      drawScanlines(ctx, W, H, 0.05);
      drawFades(ctx, t, T, W, H);

      ctx.restore();
    }

    rafId = setTimeout(tick, 0);
    return {
      stop: function(){ clearTimeout(rafId); },
      replay: function(){ clearTimeout(rafId); startMs=0; fired=false; ps=new ParticleSystem(); rafId=setTimeout(tick, 0); },
      setTeam: function(hex){ team = hexToRgb(hex); }
    };
  }

  // ───────────────────────────────────────────── ribbon run (full animation, ultra-wide)
  // Plays the same cue animation as the scoreboard but laid out for the ribbon's
  // aspect ratio. Auto-loops. You tile horizontally in your CMS — we don't repeat.
  function runRibbon(canvas, key){
    var ctx = canvas.getContext('2d');
    var W = canvas.width, H = canvas.height;       // ~2400 × 256 typical
    var cfg = REGISTRY[key];
    if(!cfg) return null;

    var query = new URLSearchParams(location.search);
    var team = hexToRgb(cfg.team || '#21e6ff');
    if(query.get('team')) team = hexToRgb('#'+query.get('team').replace('#',''));
    var hot = [255,45,85];
    var foam = [223,246,255];

    var T = Object.assign({fadeIn:240, impact:700, hold:2600, end:3200}, cfg.T||{}, cfg.ribbonT||{});

    var startMs=0, prevMs=0, rafId=0;
    var ps = new ParticleSystem();
    var fired = false;
    var impactPt = cfg.ribbonImpactPoint ? cfg.ribbonImpactPoint(W,H) : { x: W*0.72, y: H*0.55 };

    // Plays ONCE by default — same fix as runScoreboard (2026-06-15). The
    // ribbon's loop gap was even shorter (+500ms) and the ribbon holds each
    // cue for 4500ms vs the cinematic's ~3200ms, so a goal cue re-fired at
    // ~3700ms and got cut off — the operator's exact report. ?loop=1 opts
    // into the continuous-deck preview loop.
    var doLoop = query.get('loop') === '1';
    function tick(){
      var ms = performance.now();
      frame(ms);
      var t = ms - (startMs||ms);
      if(!doLoop){
        // Play ONCE → run to hold/peak then STOP, freezing the hero frame
        // (clamped in frame() below) until the parent removes the iframe.
        if(t >= T.hold){ clearTimeout(rafId); rafId = 0; return; }
      } else if(t >= T.end + 500){
        startMs = 0; fired = false; ps = new ParticleSystem();
      }
      rafId = setTimeout(tick, 16);
    }

    function frame(ms){
      if(!startMs){ startMs = ms; prevMs = ms; }
      var t = ms - startMs;
      // Live one-shot: freeze at the hold/peak (no authored fade-out / loop).
      if(!doLoop && t > T.hold) t = T.hold;
      var dt = Math.min(0.05, (ms-prevMs)/1000);
      prevMs = ms;

      var shake = (t>=T.impact && t<T.impact+460) ? (1-(t-T.impact)/460)*8 : 0;
      ctx.setTransform(1,0,0,1,0,0);
      ctx.clearRect(0,0,W,H);
      ctx.save();
      ctx.translate((Math.random()-0.5)*shake, (Math.random()-0.5)*shake);

      // base — dark + waterline at lower third
      drawRibbonAtmos(ctx, t, W, H, team);

      // cue-specific scene (ribbon-tuned)
      if(cfg.drawRibbonScene) cfg.drawRibbonScene(ctx, t, T, W, H, team, impactPt);

      // cue-specific projectile (ribbon-tuned)
      if(cfg.drawRibbonPreImpact) cfg.drawRibbonPreImpact(ctx, t, T, W, H, team, impactPt);

      // burst
      if(t >= T.impact && !fired){
        fired = true;
        if(!cfg.noBurst && cfg.burstStyle !== 'none'){
          ps.spawnWaterBurst(impactPt.x, impactPt.y, {foam:foam, team:team, count:140, up:6});
        }
      }
      if(!cfg.noShockwave) drawShock(ctx, t, T, impactPt.x, impactPt.y, team, foam);
      ps.step(dt); ps.draw(ctx, foam);

      // headline + info — ribbon layout: type left, action right
      drawRibbonHeadline(ctx, t, T, W, H, {
        headline: cfg.headline, team: team, hot: hot,
        size: (cfg.ribbon && cfg.ribbon.headSize) || Math.round(H*0.72)
      });
      drawRibbonInfoLine(ctx, t, T, W, H, {
        player: cfg.player, context: cfg.context, team: team
      });

      // flash
      drawFlash(ctx, t, T, W, H, cfg.flash);

      // scanlines
      ctx.globalAlpha = 0.05;
      ctx.fillStyle = '#000';
      for(var y=0;y<H;y+=3) ctx.fillRect(0,y,W,1);
      ctx.globalAlpha = 1;

      ctx.restore();
    }

    rafId = setTimeout(tick, 0);
    return {
      stop: function(){ clearTimeout(rafId); },
      replay: function(){ clearTimeout(rafId); startMs=0; fired=false; ps=new ParticleSystem(); rafId=setTimeout(tick, 0); },
      setTeam: function(hex){ team = hexToRgb(hex); }
    };
  }

  // ── ribbon atmosphere: water at the bottom, dark void above, cleaner than scoreboard
  function drawRibbonAtmos(ctx, t, W, H, team){
    var waterY = H * 0.50;
    var g = ctx.createLinearGradient(0,0,0,waterY);
    g.addColorStop(0, '#03070d');
    g.addColorStop(1, '#062234');
    ctx.fillStyle = g;
    ctx.fillRect(0,0,W,waterY);
    var wg = ctx.createLinearGradient(0,waterY,0,H);
    wg.addColorStop(0, '#0a6b94');
    wg.addColorStop(0.5,'#063f60');
    wg.addColorStop(1, '#020e1c');
    ctx.fillStyle = wg;
    ctx.fillRect(0,waterY,W,H-waterY);
    // caustics
    ctx.globalCompositeOperation = 'lighter';
    for(var c=0;c<4;c++){
      var yy = waterY + 10 + c*((H-waterY-10)/4);
      var amp = 3 + c*0.8;
      var phase = t*0.0015*(0.5+c*0.13)+c*0.7;
      ctx.strokeStyle = 'rgba(190,235,255,'+(0.06+0.04*Math.sin(phase*2))+')';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      for(var x=0;x<=W;x+=18){
        var yo = Math.sin(x*0.014+phase*3)*amp;
        if(x===0) ctx.moveTo(x,yy+yo); else ctx.lineTo(x,yy+yo);
      }
      ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';
    // bright surface line
    var surf = ctx.createLinearGradient(0,waterY-1,0,waterY+2);
    surf.addColorStop(0,'rgba(0,0,0,0)');
    surf.addColorStop(0.5,'rgba(220,245,255,0.7)');
    surf.addColorStop(1,'rgba(0,0,0,0)');
    ctx.fillStyle = surf;
    ctx.fillRect(0,waterY-1,W,3);
    // top accent in team color
    ctx.fillStyle = rgba(team, 0.9);
    ctx.fillRect(0, 0, W, 2);
  }

  // ── ribbon headline — anchored left, fills the height
  function drawRibbonHeadline(ctx, t, T, W, H, opts){
    var headIn = T.impact + 40;
    var p = seg(t, headIn, headIn + 360);
    if(p<=0) return;
    var glitch = t < headIn + 200 ? (Math.random()-0.5)*4 : 0;
    var size = opts.size || Math.round(H*0.72);
    var team = opts.team, hot = opts.hot || [255,45,85];
    var s = lerp(1.35, 1.0, easeOutQuint(p));
    ctx.save();
    ctx.translate(40 + glitch, H*0.50);
    ctx.scale(s, s);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.font = '400 ' + size + 'px "Anton", "Bebas Neue", Impact, sans-serif';
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = rgba(hot, 0.85);
    ctx.fillText(opts.headline, -4, 0);
    ctx.fillStyle = rgba(team, 0.85);
    ctx.fillText(opts.headline, 4, 0);
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = rgba(team,1);
    ctx.shadowBlur = 32;
    ctx.fillText(opts.headline, 0, 0);
    ctx.shadowBlur = 0;
    ctx.globalCompositeOperation = 'source-over';
    ctx.restore();
    // underbar
    var bp = seg(t, headIn+180, headIn+540);
    if(bp>0){
      var textW = size * opts.headline.length * 0.46;
      var barW = lerp(0, textW, easeOutQuint(bp));
      var barH = Math.max(3, H*0.04);
      var barY = H*0.50 + size*0.38;
      ctx.fillStyle = rgba(team, 0.95);
      ctx.shadowColor = rgba(team,1);
      ctx.shadowBlur = 10;
      ctx.fillRect(40, barY, barW, barH);
      ctx.shadowBlur = 0;
      ctx.fillStyle = rgba(hot, 0.95);
      ctx.fillRect(40 + barW - barW*0.18, barY, barW*0.18, barH);
    }
  }

  function drawRibbonInfoLine(ctx, t, T, W, H, opts){
    var inT = T.impact + 320;
    var p = seg(t, inT, inT + 360);
    if(p<=0) return;
    ctx.save();
    ctx.globalAlpha = p;
    // 2026-06-05 — scorer line sits in the CENTER-LEFT band, NOT top-right.
    // The action scene (net / goalie hand / whistle) lives on the right,
    // so a top-right name sat on top of it (the save showed the name in the
    // middle of the net). Center-left clears the left headline AND the right
    // action for EVERY cue, so placement is consistent across all of them.
    var x = Math.round(W*0.35);
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    if(opts.player){
      ctx.font = '900 ' + Math.round(H*0.17) + 'px "Inter", sans-serif';
      ctx.fillStyle = '#ffffff';
      ctx.shadowColor = 'rgba(0,0,0,0.85)';
      ctx.shadowBlur = 8;
      ctx.fillText('#' + opts.player.number + '   ' + opts.player.name, x, H*0.40);
      ctx.shadowBlur = 0;
    }
    if(opts.context){
      ctx.font = '700 ' + Math.round(H*0.11) + 'px "JetBrains Mono", monospace';
      ctx.fillStyle = rgba(lighten(opts.team,0.5), 0.95);
      ctx.shadowColor = 'rgba(0,0,0,0.7)'; ctx.shadowBlur = 6;
      ctx.fillText(opts.context, x, H*0.40 + Math.round(H*0.20));
      ctx.shadowBlur = 0;
    }
    ctx.restore();
  }

  // ───────────────────────────────────────────── exports
  window.VENUE = {
    register: register,
    get: get,
    list: list,
    runScoreboard: runScoreboard,
    runRibbon: runRibbon,
    util: {
      hexToRgb: hexToRgb, rgba: rgba, lighten: lighten, darken: darken,
      clamp: clamp, lerp: lerp, seg: seg,
      easeOutCubic: easeOutCubic, easeOutQuint: easeOutQuint,
      easeOutBack: easeOutBack, easeInOutCubic: easeInOutCubic
    }
  };
})();
