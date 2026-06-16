/* Basketball cues for the v2 engine — the BALL GOING IN is the hero, not text.
 * Same engine + ribbon renderer as water polo, so a basketball cue plays a real
 * cinematic (ball arcing through the hoop, net snap) on BOTH the scoreboard and
 * the ribbon — replacing the flat "DUNK! text strip" the ribbon used to show.
 * 2026-06-16. */
(function () {
  "use strict";
  var U = window.VENUE.util;
  var lerp = U.lerp, seg = U.seg, clamp = U.clamp;
  var easeOutCubic = U.easeOutCubic, easeOutQuint = U.easeOutQuint;
  var rgba = U.rgba, lighten = U.lighten;
  function easeOutQuad(t){ return 1-(1-t)*(1-t); }
  function easeInQuad(t){ return t*t; }

  // ── backboard (glass) + inner square ──────────────────────────
  function drawBackboard(ctx, b, team, reveal){
    ctx.save(); ctx.globalAlpha = reveal;
    ctx.fillStyle = 'rgba(14,24,40,0.55)';
    ctx.strokeStyle = rgba(lighten(team,0.5), 0.95);
    ctx.lineWidth = Math.max(4, b.w*0.018);
    ctx.shadowColor = rgba(team,1); ctx.shadowBlur = 24;
    rrect(ctx, b.x, b.y, b.w, b.h, 12); ctx.fill(); ctx.stroke();
    // inner shooter's square, low-centre
    var iw = b.w*0.34, ih = b.h*0.42, ix = b.x+(b.w-iw)/2, iy = b.y+b.h-ih-b.h*0.10;
    ctx.lineWidth = Math.max(3, b.w*0.013); ctx.shadowBlur = 0;
    rrect(ctx, ix, iy, iw, ih, 5); ctx.stroke();
    ctx.restore();
  }
  // ── rim + hanging net, with a snap-flip when the ball goes through ──
  function drawRimNet(ctx, rim, t, T, team, reveal){
    ctx.save(); ctx.globalAlpha = reveal;
    // net flip: snaps when the ball passes, settles over ~700ms
    var fl = 0;
    if(t >= T.impact){ var e = t - T.impact; if(e < 800) fl = Math.exp(-e/220)*Math.sin(e*0.02)* -1; }
    var N = 13, topR = rim.rx, depth = rim.rx*2.0, botRX = rim.rx*0.42*(1 + Math.abs(fl)*0.5);
    var botY = rim.y + depth - fl*depth*0.22;
    ctx.strokeStyle = 'rgba(244,250,255,0.55)'; ctx.lineWidth = Math.max(1.4, rim.rx*0.035);
    var tp=[], bp=[], i, a;
    for(i=0;i<N;i++){ a = i/N*Math.PI*2;
      tp.push([rim.x+Math.cos(a)*topR, rim.y+Math.sin(a)*rim.ry]);
      bp.push([rim.x+Math.cos(a)*botRX, botY+Math.sin(a)*rim.ry*0.5]); }
    for(i=0;i<N;i++){
      ctx.beginPath(); ctx.moveTo(tp[i][0],tp[i][1]); ctx.lineTo(bp[i][0],bp[i][1]); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(tp[i][0],tp[i][1]); ctx.lineTo(bp[(i+1)%N][0],bp[(i+1)%N][1]); ctx.stroke();
    }
    ctx.beginPath(); ctx.ellipse(rim.x, botY, botRX, rim.ry*0.5, 0, 0, Math.PI*2); ctx.stroke();
    // rim — bright orange, in front
    ctx.strokeStyle = '#ff7a18'; ctx.shadowColor = '#ff7a18';
    ctx.shadowBlur = 22; ctx.lineWidth = Math.max(6, rim.rx*0.14);
    ctx.beginPath(); ctx.ellipse(rim.x, rim.y, rim.rx, rim.ry, 0, 0, Math.PI*2); ctx.stroke();
    ctx.shadowBlur = 0; ctx.restore();
  }
  // ── orange basketball with black ribs ─────────────────────────
  function drawBball(ctx, x, y, r, spin){
    ctx.save(); ctx.shadowColor = 'rgba(255,140,40,0.7)'; ctx.shadowBlur = 16;
    var g = ctx.createRadialGradient(x-r*0.3,y-r*0.34,r*0.1,x,y,r);
    g.addColorStop(0,'#ffd9a6'); g.addColorStop(0.5,'#ff8c2e'); g.addColorStop(0.86,'#df6614'); g.addColorStop(1,'#a8480c');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x,y,r,0,Math.PI*2); ctx.fill(); ctx.restore();
    ctx.save(); ctx.beginPath(); ctx.arc(x,y,r,0,Math.PI*2); ctx.clip();
    ctx.strokeStyle = 'rgba(20,12,6,0.82)'; ctx.lineWidth = Math.max(2,r*0.06);
    ctx.translate(x,y); ctx.rotate(spin*0.4);
    ctx.beginPath(); ctx.ellipse(0,0,r*0.98,r*0.30,0,0,Math.PI*2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0,-r); ctx.lineTo(0,r); ctx.stroke();
    ctx.beginPath(); ctx.ellipse(r*0.5,0,r*0.5,r*0.99,0,0,Math.PI*2); ctx.stroke();
    ctx.beginPath(); ctx.ellipse(-r*0.5,0,r*0.5,r*0.99,0,0,Math.PI*2); ctx.stroke();
    ctx.restore();
    ctx.save(); ctx.globalCompositeOperation='lighter';
    var hg = ctx.createRadialGradient(x-r*0.32,y-r*0.36,1,x-r*0.32,y-r*0.36,r*0.4);
    hg.addColorStop(0,'rgba(255,255,255,0.6)'); hg.addColorStop(1,'rgba(255,255,255,0)');
    ctx.fillStyle = hg; ctx.beginPath(); ctx.arc(x-r*0.32,y-r*0.36,r*0.4,0,Math.PI*2); ctx.fill(); ctx.restore();
  }
  function drawTrail(ctx, trail, r){
    ctx.save(); ctx.globalCompositeOperation='lighter';
    for(var i=0;i<trail.length;i++){ var p=trail[i], a=i/trail.length;
      var col = a>0.6?'#fff0b0':(a>0.3?'#ff9d28':'#ff5a1f');
      ctx.fillStyle=col; ctx.shadowColor=col; ctx.shadowBlur=20;
      ctx.beginPath(); ctx.arc(p.x,p.y,r*0.5*a+3,0,Math.PI*2); ctx.fill(); }
    ctx.restore(); ctx.shadowBlur=0;
  }
  function rrect(ctx,x,y,w,h,r){ ctx.beginPath(); ctx.moveTo(x+r,y); ctx.arcTo(x+w,y,x+w,y+h,r); ctx.arcTo(x+w,y+h,x,y+h,r); ctx.arcTo(x,y+h,x,y,r); ctx.arcTo(x,y,x+w,y,r); ctx.closePath(); }

  var DEMO = {
    home:{abbr:'CAVS',name:'Cavaliers',color:'#fdb927',goals:61},
    away:{abbr:'BULL',name:'Bulls',color:'#ce1141',goals:58}
  };

  // ═══════════════════════════════ THREE-POINTER — swish from deep
  (function(){
    var BOARD = { x: 810, y: 170, w: 300, h: 176 };
    var RIM   = { x: 960, y: 402, rx: 66, ry: 17 };
    var ENTRY = { x: RIM.x, y: RIM.y };
    var REST  = { x: RIM.x, y: RIM.y + 200 };   // settles below the net
    var trail = [];
    VENUE.register('basketball-three', {
      sport:'BASKETBALL', headline:'THREE!', eyebrow:'BASKETBALL', headSize:240,
      headPos:{ x: 960, y: 902 }, infoPos:{ x: 960, y: 1012 },
      context:'4TH · 3-POINTER', player:{ number:'3', name:'REYES' },
      score: DEMO, team:'#fdb927', scene:'court', noLightShaft:true, flash:0.30,
      impactPoint:function(){ return ENTRY; },
      drawScene:function(ctx,t,T,W,H,team){
        var reveal = easeOutCubic(seg(t,120,900));
        drawBackboard(ctx, BOARD, team, reveal);
        drawRimNet(ctx, RIM, t, T, team, reveal);
      },
      drawPreImpact:function(ctx,t,T,W,H,team){
        var bx,by,r;
        if(t < T.impact){
          var fly = T.impact - 820, p = seg(t, fly, T.impact);
          bx = lerp(540, ENTRY.x, easeOutQuad(p));
          by = lerp(880, ENTRY.y, p) - Math.sin(Math.PI*p)*360;  // jump-shot arc
          r  = lerp(46, 32, p);
          trail.push({x:bx,y:by}); if(trail.length>16) trail.shift();
        } else if(t < T.impact + 260){
          var pe = seg(t, T.impact, T.impact+260);
          bx = RIM.x; by = lerp(ENTRY.y, REST.y, easeInQuad(pe)); r = 30;  // drop through net
          trail.push({x:bx,y:by}); if(trail.length>8) trail.shift();
        } else {
          bx = REST.x; by = REST.y + Math.sin((t-T.impact)*0.004)*6; r = 30;
          if(trail.length) trail.shift();
        }
        drawTrail(ctx, trail, r); drawBball(ctx, bx, by, r, t*0.012);
      },
      ribbonImpactPoint:function(W,H){ return { x: W*0.80, y: H*0.40 }; },
      drawRibbonScene:function(ctx,t,T,W,H,team){
        var bw = H*0.62, bh = bw*0.59, bx = W*0.80 - bw/2, by = H*0.06;
        var rim = { x: W*0.80, y: H*0.40, rx: H*0.13, ry: H*0.035 };
        var reveal = easeOutCubic(seg(t,60,560));
        drawBackboard(ctx, {x:bx,y:by,w:bw,h:bh}, team, reveal);
        drawRimNet(ctx, rim, t, T, team, reveal);
      },
      drawRibbonPreImpact:(function(){ var rt=[]; return function(ctx,t,T,W,H,team){
        var rim={x:W*0.80,y:H*0.40}, bx,by,r;
        if(t < T.impact){
          var p = seg(t, T.impact-620, T.impact);
          bx = lerp(W*0.12, rim.x, easeOutQuad(p));
          by = lerp(H*0.78, rim.y, p) - Math.sin(Math.PI*p)*(H*0.40);
          r  = lerp(H*0.15, H*0.10, p);
          rt.push({x:bx,y:by}); if(rt.length>14) rt.shift();
        } else if(t < T.impact+240){
          var pe = seg(t, T.impact, T.impact+240);
          bx = rim.x; by = lerp(rim.y, rim.y+H*0.42, easeInQuad(pe)); r = H*0.10;
          rt.push({x:bx,y:by}); if(rt.length>8) rt.shift();
        } else { bx=rim.x; by=rim.y+H*0.42+Math.sin((t-T.impact)*0.004)*(H*0.02); r=H*0.10; if(rt.length) rt.shift(); }
        drawTrail(ctx, rt, r); drawBball(ctx, bx, by, r, t*0.012);
      }; })(),
      ribbon:{ headSize: 150 }
    });
  })();

  // ═══════════════════════════════ DUNK — slammed straight down
  (function(){
    var BOARD = { x: 810, y: 170, w: 300, h: 176 };
    var RIM   = { x: 960, y: 402, rx: 66, ry: 17 };
    var REST  = { x: RIM.x, y: RIM.y + 200 };
    var trail = [];
    VENUE.register('basketball-dunk', {
      sport:'BASKETBALL', headline:'DUNK!', eyebrow:'BASKETBALL', headSize:240,
      headPos:{ x: 960, y: 902 }, infoPos:{ x: 960, y: 1012 },
      context:'4TH · SLAM', player:{ number:'23', name:'JORDAN' },
      score: DEMO, team:'#fdb927', scene:'court', noLightShaft:true, flash:0.40,
      shake: 26,
      impactPoint:function(){ return { x: RIM.x, y: RIM.y }; },
      drawScene:function(ctx,t,T,W,H,team){
        var reveal = easeOutCubic(seg(t,120,820));
        drawBackboard(ctx, BOARD, team, reveal);
        drawRimNet(ctx, RIM, t, T, team, reveal);
      },
      drawPreImpact:function(ctx,t,T,W,H,team){
        var bx,by,r;
        if(t < T.impact){
          var fly = T.impact - 560, p = seg(t, fly, T.impact);
          // driven down from up-and-right, steep + fast (a slam, not an arc)
          bx = lerp(1240, RIM.x, easeInQuad(p));
          by = lerp(70, RIM.y - 10, easeInQuad(p));
          r  = lerp(58, 40, p);
          trail.push({x:bx,y:by}); if(trail.length>14) trail.shift();
        } else if(t < T.impact + 240){
          var pe = seg(t, T.impact, T.impact+240);
          bx = RIM.x; by = lerp(RIM.y, REST.y, easeInQuad(pe)); r = 38;
          trail.push({x:bx,y:by}); if(trail.length>8) trail.shift();
        } else {
          bx = REST.x; by = REST.y + Math.sin((t-T.impact)*0.004)*7; r = 36;
          if(trail.length) trail.shift();
        }
        drawTrail(ctx, trail, r); drawBball(ctx, bx, by, r, t*0.02);
      },
      ribbonImpactPoint:function(W,H){ return { x: W*0.80, y: H*0.40 }; },
      drawRibbonScene:function(ctx,t,T,W,H,team){
        var bw = H*0.62, bh = bw*0.59, bx = W*0.80 - bw/2, by = H*0.06;
        var rim = { x: W*0.80, y: H*0.40, rx: H*0.13, ry: H*0.035 };
        var reveal = easeOutCubic(seg(t,60,520));
        drawBackboard(ctx, {x:bx,y:by,w:bw,h:bh}, team, reveal);
        drawRimNet(ctx, rim, t, T, team, reveal);
      },
      drawRibbonPreImpact:(function(){ var rt=[]; return function(ctx,t,T,W,H,team){
        var rim={x:W*0.80,y:H*0.40}, bx,by,r;
        if(t < T.impact){
          var p = seg(t, T.impact-520, T.impact);
          bx = lerp(W*0.95, rim.x, easeInQuad(p));
          by = lerp(-H*0.10, rim.y-H*0.02, easeInQuad(p));
          r  = lerp(H*0.16, H*0.11, p);
          rt.push({x:bx,y:by}); if(rt.length>12) rt.shift();
        } else if(t < T.impact+220){
          var pe = seg(t, T.impact, T.impact+220);
          bx = rim.x; by = lerp(rim.y, rim.y+H*0.42, easeInQuad(pe)); r = H*0.11;
          rt.push({x:bx,y:by}); if(rt.length>8) rt.shift();
        } else { bx=rim.x; by=rim.y+H*0.42+Math.sin((t-T.impact)*0.004)*(H*0.02); r=H*0.11; if(rt.length) rt.shift(); }
        drawTrail(ctx, rt, r); drawBball(ctx, bx, by, r, t*0.02);
      }; })(),
      ribbon:{ headSize: 150 }
    });
  })();
})();
