/* Water polo cues — each one composes a unique stadium scene. */
(function () {
  "use strict";
  var U = window.VENUE.util;
  var lerp = U.lerp, seg = U.seg;
  var easeOutCubic = U.easeOutCubic, easeOutQuint = U.easeOutQuint;
  var easeOutBack = U.easeOutBack;
  var lighten = U.lighten, rgba = U.rgba, hexToRgb = U.hexToRgb;
  function easeOutQuad(t){return 1-(1-t)*(1-t);}
  function easeInQuad(t){return t*t;}

  // ═══════════════════════════════════════════════════════════════
  // SCENE PRIMITIVES — composable elements for water polo
  // ═══════════════════════════════════════════════════════════════

  // FINA water polo goal: 3.0m × 0.9m, floating on the surface.
  // Perspective net mesh; bulge = positive number pushes net BACK.
  function drawGoal(ctx, opts){
    var x = opts.x, y = opts.y, w = opts.w, h = opts.h;
    var bulge = opts.bulge || 0;
    var team = opts.team;
    var reveal = opts.reveal != null ? opts.reveal : 1;

    var dTopX = 46, dTopY = -16, dBotX = 60, dBotY = -6;
    var FTL = [x, y], FTR = [x+w, y], FBL = [x, y+h], FBR = [x+w, y+h];
    var BTL = [x+dTopX+bulge, y+dTopY];
    var BTR = [x+w+dTopX+bulge, y+dTopY];
    var BBL = [x+dBotX+bulge, y+h+dBotY];
    var BBR = [x+w+dBotX+bulge, y+h+dBotY];

    ctx.save();
    ctx.globalAlpha = reveal;
    ctx.lineCap = 'round';

    // NET — translucent white pocket, mesh of warp + weft
    ctx.strokeStyle = 'rgba(236,246,255,0.42)';
    ctx.lineWidth = 1.4;
    meshQuad(ctx, FTL, FTR, BTR, BTL, 18, 3);   // ceiling
    meshQuad(ctx, FBL, FBR, BBR, BBL, 18, 3);   // floor
    meshQuad(ctx, FTL, BTL, BBL, FBL, 3, 7);    // left wall
    meshQuad(ctx, FTR, BTR, BBR, FBR, 3, 7);    // right wall
    meshQuad(ctx, BTL, BTR, BBR, BBL, 18, 7);   // back wall

    // back rails (slightly visible)
    ctx.strokeStyle = 'rgba(205,222,236,0.55)';
    ctx.lineWidth = 4;
    L(ctx, BTL, BTR); L(ctx, FTL, BTL); L(ctx, FTR, BTR);

    // white frame — posts + crossbar with team-color glow
    ctx.strokeStyle = 'rgba(245,250,255,0.96)';
    ctx.lineWidth = 11;
    ctx.shadowColor = rgba(team, 1);
    ctx.shadowBlur = 26;
    L(ctx, FTL, FBL); L(ctx, FTR, FBR); L(ctx, FTL, FTR);
    ctx.shadowBlur = 0;

    // floats at base of each post (water polo goals float)
    ctx.fillStyle = 'rgba(245,250,255,0.95)';
    ctx.shadowColor = rgba(team, 1); ctx.shadowBlur = 16;
    ctx.beginPath(); ctx.ellipse(FBL[0], FBL[1], 20, 9, 0, 0, Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(FBR[0], FBR[1], 20, 9, 0, 0, Math.PI*2); ctx.fill();
    ctx.shadowBlur = 0;

    ctx.restore();
  }
  function L(ctx, a, b){ ctx.beginPath(); ctx.moveTo(a[0],a[1]); ctx.lineTo(b[0],b[1]); ctx.stroke(); }
  function meshQuad(ctx, a, b, c, d, nu, nv){
    function P(u, v){
      var tx = a[0]+(b[0]-a[0])*u, ty = a[1]+(b[1]-a[1])*u;
      var bx = d[0]+(c[0]-d[0])*u, by = d[1]+(c[1]-d[1])*u;
      return [tx+(bx-tx)*v, ty+(by-ty)*v];
    }
    var i, j, p;
    for(i=0;i<=nu;i++){
      ctx.beginPath();
      for(j=0;j<=nv;j++){ p = P(i/nu, j/nv); j? ctx.lineTo(p[0],p[1]) : ctx.moveTo(p[0],p[1]); }
      ctx.stroke();
    }
    for(j=0;j<=nv;j++){
      ctx.beginPath();
      for(i=0;i<=nu;i++){ p = P(i/nu, j/nv); i? ctx.lineTo(p[0],p[1]) : ctx.moveTo(p[0],p[1]); }
      ctx.stroke();
    }
  }
  // Damped sine bulge — bulges back when hit, oscillates
  function netBulge(t, T, peak){
    if(t < T.impact) return 0;
    var e = t - T.impact;
    if(e > 1000) return 0;
    return Math.exp(-e/240) * Math.sin(e*0.028) * (peak || 32);
  }

  // Yellow water polo ball
  function drawBall(ctx, x, y, r, spin){
    ctx.save();
    ctx.shadowColor = 'rgba(255,210,40,0.7)'; ctx.shadowBlur = 18;
    var g = ctx.createRadialGradient(x-r*0.3, y-r*0.34, r*0.1, x, y, r);
    g.addColorStop(0,'#fff7cf'); g.addColorStop(0.5,'#ffd21a');
    g.addColorStop(0.85,'#f0ab00'); g.addColorStop(1,'#c98a00');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI*2); ctx.fill();
    ctx.restore();
    // seams
    ctx.save();
    ctx.beginPath(); ctx.arc(x,y,r,0,Math.PI*2); ctx.clip();
    ctx.translate(x,y); ctx.rotate(spin*0.4);
    ctx.strokeStyle = 'rgba(150,96,8,0.55)';
    ctx.lineWidth = r*0.05;
    for(var k=0;k<3;k++){
      ctx.beginPath(); ctx.ellipse(0,0,r*(0.3+k*0.32),r*0.95,0,0,Math.PI*2); ctx.stroke();
    }
    ctx.restore();
    // specular
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    var hg = ctx.createRadialGradient(x-r*0.32, y-r*0.36, 1, x-r*0.32, y-r*0.36, r*0.4);
    hg.addColorStop(0,'rgba(255,255,255,0.7)'); hg.addColorStop(1,'rgba(255,255,255,0)');
    ctx.fillStyle = hg;
    ctx.beginPath(); ctx.arc(x-r*0.32, y-r*0.36, r*0.4, 0, Math.PI*2); ctx.fill();
    ctx.restore();
  }
  function drawBallTrail(ctx, trail, r){
    ctx.globalCompositeOperation = 'lighter';
    for(var i=0;i<trail.length;i++){
      var a = i/trail.length;
      ctx.fillStyle = 'rgba(255,210,40,'+(a*0.22)+')';
      ctx.beginPath(); ctx.arc(trail[i].x, trail[i].y, r*0.45*a+2, 0, Math.PI*2); ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  // Open palm — water polo goalies block bare-handed. Stylized "stop" gesture.
  function drawBlockHand(ctx, x, y, scale, alpha, team){
    ctx.save();
    ctx.translate(x, y); ctx.scale(scale, scale);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = '#f1ddc0';
    ctx.strokeStyle = '#1a1f2a';
    ctx.lineWidth = 4;
    ctx.shadowColor = rgba(team,1); ctx.shadowBlur = 32;

    // wristband (team color)
    ctx.fillStyle = rgba(team, 0.95);
    rrect(ctx, -60, 130, 120, 38, 6);
    ctx.fill(); ctx.stroke();

    // palm — broad rounded shape
    ctx.fillStyle = '#f1ddc0';
    rrect(ctx, -85, -20, 170, 160, 28);
    ctx.fill(); ctx.stroke();

    // fingers — pinky, ring, middle, index (right-to-left as we see it)
    rrect(ctx, -78, -100, 32, 100, 12); ctx.fill(); ctx.stroke();   // pinky
    rrect(ctx, -42, -130, 32, 120, 12); ctx.fill(); ctx.stroke();   // ring
    rrect(ctx, -6,  -145, 32, 132, 12); ctx.fill(); ctx.stroke();   // middle
    rrect(ctx, 30,  -125, 32, 115, 12); ctx.fill(); ctx.stroke();   // index

    // thumb angled out
    ctx.save();
    ctx.translate(78, 6);
    ctx.rotate(0.55);
    rrect(ctx, 0, 0, 36, 110, 14);
    ctx.fill(); ctx.stroke();
    ctx.restore();

    // palm shading
    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(120,80,40,0.18)';
    ctx.beginPath();
    ctx.ellipse(-12, 50, 50, 26, 0, 0, Math.PI*2);
    ctx.fill();

    ctx.restore();
  }

  // Yellow / red card flicking in
  function drawCard(ctx, x, y, rot, scale, alpha, color){
    ctx.save();
    ctx.translate(x, y); ctx.rotate(rot); ctx.scale(scale, scale);
    ctx.globalAlpha = alpha;
    ctx.shadowColor = color; ctx.shadowBlur = 40;
    ctx.fillStyle = color;
    rrect(ctx, -85, -125, 170, 250, 12);
    ctx.fill();
    // highlight
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    rrect(ctx, -85, -125, 50, 250, 12);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.restore();
  }
  function rrect(ctx, x, y, w, h, r){
    ctx.beginPath();
    ctx.moveTo(x+r,y);
    ctx.arcTo(x+w,y,x+w,y+h,r);
    ctx.arcTo(x+w,y+h,x,y+h,r);
    ctx.arcTo(x,y+h,x,y,r);
    ctx.arcTo(x,y,x+w,y,r);
    ctx.closePath();
  }

  // Referee whistle
  function drawWhistle(ctx, x, y, scale, alpha, team){
    ctx.save();
    ctx.translate(x, y); ctx.scale(scale, scale);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = '#e9eef6';
    ctx.strokeStyle = '#9aa0a8';
    ctx.lineWidth = 4;
    ctx.shadowColor = rgba(team,1); ctx.shadowBlur = 24;
    // body
    rrect(ctx, -110, -54, 180, 108, 50);
    ctx.fill(); ctx.stroke();
    // ball
    ctx.beginPath(); ctx.arc(90, 0, 48, 0, Math.PI*2); ctx.fill(); ctx.stroke();
    // hole
    ctx.fillStyle = '#1a1f2a';
    ctx.beginPath(); ctx.arc(90, 0, 16, 0, Math.PI*2); ctx.fill();
    // cord
    ctx.strokeStyle = '#3a4055'; ctx.lineWidth = 6;
    ctx.beginPath(); ctx.moveTo(-100, -40); ctx.quadraticCurveTo(-160, -120, -200, -180); ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.restore();
  }
  // Steam lines emanating from whistle ball
  function drawWhistleBlow(ctx, x, y, t, alpha){
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.lineWidth = 6;
    ctx.lineCap = 'round';
    for(var i=0;i<5;i++){
      var ang = -0.6 + i*0.3;
      var phase = (t*0.005 + i*0.4) % 1;
      var r0 = 70 + phase*200;
      var r1 = r0 + 70;
      ctx.globalAlpha = alpha * (1-phase);
      ctx.beginPath();
      ctx.moveTo(x+Math.cos(ang)*r0, y+Math.sin(ang)*r0);
      ctx.lineTo(x+Math.cos(ang)*r1, y+Math.sin(ang)*r1);
      ctx.stroke();
    }
    ctx.restore();
  }

  // Countdown clock display
  function drawCountdownClock(ctx, x, y, text, scale, alpha, team){
    ctx.save();
    ctx.translate(x, y); ctx.scale(scale, scale);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = '#0a0e16';
    ctx.strokeStyle = rgba(lighten(team,0.4), 1);
    ctx.lineWidth = 4;
    ctx.shadowColor = rgba(team,1); ctx.shadowBlur = 26;
    rrect(ctx, -170, -78, 340, 156, 16);
    ctx.fill(); ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.font = '700 110px "JetBrains Mono", monospace';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ff3b30';
    ctx.shadowColor = '#ff3b30'; ctx.shadowBlur = 18;
    ctx.fillText(text, 0, 0);
    ctx.shadowBlur = 0;
    ctx.restore();
  }

  // 5m line on water — bright yellow stripe
  function draw5mLine(ctx, y, W, alpha, label){
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = '#ffd21a';
    ctx.shadowColor = '#ffd21a'; ctx.shadowBlur = 16;
    ctx.fillRect(0, y-4, W, 8);
    ctx.shadowBlur = 0;
    // dashed under-line
    ctx.strokeStyle = 'rgba(255,210,26,0.5)';
    ctx.lineWidth = 2;
    ctx.setLineDash([20, 12]);
    ctx.beginPath(); ctx.moveTo(0, y+22); ctx.lineTo(W, y+22); ctx.stroke();
    ctx.setLineDash([]);
    // label tag
    if(label){
      ctx.fillStyle = '#0a0e16';
      rrect(ctx, 40, y-44, 140, 36, 6);
      ctx.fill();
      ctx.fillStyle = '#ffd21a';
      ctx.font = '700 22px "JetBrains Mono", monospace';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, 60, y-26);
    }
    ctx.restore();
  }

  // Penalty mark — a target on the water
  function drawPenaltyMark(ctx, x, y, scale, alpha){
    ctx.save();
    ctx.translate(x, y); ctx.scale(scale, scale*0.4);
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = '#ffd21a';
    ctx.lineWidth = 3;
    ctx.shadowColor = '#ffd21a'; ctx.shadowBlur = 12;
    for(var r=20;r<=60;r+=20){
      ctx.beginPath(); ctx.arc(0,0,r,0,Math.PI*2); ctx.stroke();
    }
    // crosshair
    ctx.beginPath(); ctx.moveTo(-80,0); ctx.lineTo(80,0); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0,-80); ctx.lineTo(0,80); ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.restore();
  }

  // Falling hat (for hat-trick)
  function drawHat(ctx, x, y, scale, rot, color){
    ctx.save();
    ctx.translate(x, y); ctx.rotate(rot); ctx.scale(scale, scale);
    ctx.fillStyle = color;
    ctx.strokeStyle = '#1a1f2a';
    ctx.lineWidth = 3;
    ctx.shadowColor = color; ctx.shadowBlur = 16;
    // brim
    ctx.beginPath();
    ctx.ellipse(0, 40, 90, 22, 0, 0, Math.PI*2);
    ctx.fill(); ctx.stroke();
    // crown
    rrect(ctx, -55, -50, 110, 90, 12);
    ctx.fill(); ctx.stroke();
    // band
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.fillRect(-55, 20, 110, 14);
    ctx.shadowBlur = 0;
    ctx.restore();
  }

  // ═══════════════════════════════════════════════════════════════
  // SHARED STATE
  // ═══════════════════════════════════════════════════════════════

  var WATER_Y = 1080 * 0.58;     // 626 — surface line in scoreboard space
  var DEFAULT_SCORE = {
    home: { abbr: 'NPT', name: 'Newport Harbor', color: '#21e6ff', goals: 9 },
    away: { abbr: 'CDM', name: 'Corona del Mar', color: '#ff2d55', goals: 8 }
  };

  // ═══════════════════════════════════════════════════════════════
  // CUE: GOAL — the canonical scoring celebration
  // ═══════════════════════════════════════════════════════════════
  (function(){
    var GOAL = { x: 1180, y: WATER_Y - 250, w: 580, h: 250 };
    // ENTRY = where the ball crosses the goal line (the mouth). REST =
    // where it ends up, nestled in the back-bottom of the net. The ball
    // travels ENTRY → REST so you SEE it go IN, then it stays there.
    var ENTRY = { x: GOAL.x + GOAL.w*0.42, y: GOAL.y + GOAL.h*0.40 };
    var REST  = { x: GOAL.x + GOAL.w*0.52, y: GOAL.y + GOAL.h*0.82 };
    var trail = [];

    VENUE.register('waterpolo-goal', {
      sport: 'WATER POLO',
      headline: 'GOAL',
      eyebrow: 'WATER POLO',
      headSize: 620,
      context: '4TH PERIOD · 1:24 LEFT',
      player: { number: '7', name: 'RIVERA' },
      score: { home:{abbr:'NPT',name:'Newport Harbor',color:'#21e6ff',goals:9},
               away:{abbr:'CDM',name:'Corona del Mar',color:'#ff2d55',goals:8}},
      team: '#21e6ff',
      scene: 'pool',
      // No downward spotlight beam (it read as "spotlit", not "scored"),
      // and soften the impact flash so the ball is VISIBLE entering the net.
      noLightShaft: true,
      flash: 0.32,
      impactPoint: function(){ return ENTRY; },
      drawScene: function(ctx, t, T, W, H, team){
        // goal reveals during anticipation; the net BULGES hard when the
        // shot hits (peak 64px back) and rings down over ~1s.
        var reveal = easeOutCubic(seg(t, 150, 1100));
        drawGoal(ctx, {
          x: GOAL.x, y: GOAL.y, w: GOAL.w, h: GOAL.h,
          bulge: netBulge(t, T, 64), team: team, reveal: reveal
        });
      },
      drawPreImpact: function(ctx, t, T, W, H, team){
        var bx, by, r;
        if(t < T.impact){
          // FLY — from far upper-left, skimming low over the water, to the
          // goal mouth (ENTRY).
          var fly = T.impact - 760;
          var p = seg(t, fly, T.impact);
          bx = lerp(-200, ENTRY.x, easeOutQuad(p));
          by = lerp(WATER_Y + 20, ENTRY.y, p) - Math.sin(Math.PI*p)*155;
          r  = lerp(54, 30, p);
          trail.push({x:bx, y:by}); if(trail.length>16) trail.shift();
        } else if(t < T.impact + 300){
          // ENTER — cross the line and decelerate INTO the back of the net.
          var pe = seg(t, T.impact, T.impact + 300);
          bx = lerp(ENTRY.x, REST.x, easeOutCubic(pe));
          by = lerp(ENTRY.y, REST.y, easeOutCubic(pe));
          r  = 29;
          trail.push({x:bx, y:by}); if(trail.length>8) trail.shift();
        } else {
          // SETTLE — the ball sits in the back-bottom of the net, bobbing
          // gently on the surface, and STAYS visible through the hold.
          bx = REST.x;
          by = REST.y + Math.sin((t - T.impact)*0.004)*5;
          r  = 29;
          if(trail.length) trail.shift();
        }
        drawBallTrail(ctx, trail, r);
        drawBall(ctx, bx, by, r, t*0.01);
      },
      // ── ribbon (ultra-wide) layout ──
      ribbonImpactPoint: function(W,H){
        var gw = H * 3.33, gh = H * 0.40;
        var gx = W - gw - 60, gy = H*0.10;
        return { x: gx + gw*0.32, y: gy + gh*0.50 };
      },
      drawRibbonScene: function(ctx, t, T, W, H, team, impact){
        var gh = H * 0.40, gw = gh * 3.33;
        var gx = W - gw - 60, gy = H*0.10;
        var reveal = easeOutCubic(seg(t, 80, 600));
        drawGoal(ctx, { x: gx, y: gy, w: gw, h: gh,
          bulge: netBulge(t, T, gh*0.18), team: team, reveal: reveal });
      },
      drawRibbonPreImpact: (function(){
        var rtrail = [];
        return function(ctx, t, T, W, H, team, impact){
          var fly = T.impact - 600;
          var p = seg(t, fly, T.impact);
          if(t > T.impact + 60){ rtrail.length = 0; return; }
          var bx = lerp(W*0.30, impact.x, easeOutQuad(p));
          var by = lerp(H*0.62, impact.y, p) - Math.sin(Math.PI*p)*(H*0.18);
          var r  = lerp(H*0.18, H*0.12, p);
          rtrail.push({x:bx, y:by}); if(rtrail.length>14) rtrail.shift();
          drawBallTrail(ctx, rtrail, r);
          drawBall(ctx, bx, by, r, t*0.01);
        };
      })(),
      ribbon: { headSize: 170 }
    });
  })();

  // ═══════════════════════════════════════════════════════════════
  // CUE: 5-METER PENALTY — buried straight shot
  // ═══════════════════════════════════════════════════════════════
  (function(){
    var GOAL = { x: 1180, y: WATER_Y - 250, w: 580, h: 250 };
    var IMPACT = { x: GOAL.x + GOAL.w*0.50, y: GOAL.y + GOAL.h*0.40 };
    var SPOT_X = 700, SPOT_Y = WATER_Y + 90;
    var trail = [];

    VENUE.register('waterpolo-penalty', {
      sport: 'WATER POLO',
      headline: '5-METER',
      eyebrow: 'PENALTY · BURIED',
      headSize: 360,
      context: '3RD PERIOD · 0:42 LEFT',
      player: { number: '11', name: 'ALMARAZ' },
      score: DEFAULT_SCORE,
      team: '#ffd21a',
      scene: 'pool',
      impactPoint: function(){ return IMPACT; },
      drawScene: function(ctx, t, T, W, H, team){
        // 5-meter yellow line — visible from start, fades on impact
        var lineAlpha = (t < T.impact + 200) ? 1 - seg(t, T.impact, T.impact + 200)*0.4 : 0.6;
        draw5mLine(ctx, WATER_Y + 50, W, lineAlpha, '5M');
        // penalty mark — at the spot
        var markAlpha = (t < T.impact) ? 0.9 + 0.1*Math.sin(t*0.012) : Math.max(0, 1 - seg(t, T.impact, T.impact + 300));
        drawPenaltyMark(ctx, SPOT_X, SPOT_Y, 1, markAlpha);
        // goal
        var reveal = easeOutCubic(seg(t, 150, 1000));
        drawGoal(ctx, {
          x:GOAL.x, y:GOAL.y, w:GOAL.w, h:GOAL.h,
          bulge: netBulge(t, T, 28), team: team, reveal: reveal
        });
      },
      drawPreImpact: function(ctx, t, T, W, H, team){
        // BULLET shot — straight line from penalty spot, no arc
        var fly = T.impact - 380;
        var p = seg(t, fly, T.impact);
        if(t > T.impact + 60){ trail.length = 0; return; }
        var bx = lerp(SPOT_X, IMPACT.x, easeInQuad(p));
        var by = lerp(SPOT_Y - 40, IMPACT.y, easeInQuad(p));
        var r  = lerp(40, 30, p);
        trail.push({x:bx, y:by}); if(trail.length>10) trail.shift();
        drawBallTrail(ctx, trail, r);
        drawBall(ctx, bx, by, r, t*0.018);
      },
      ribbon: { headSize: 130 },
      ribbonImpactPoint: function(W,H){
        var gw = H * 3.33, gh = H * 0.40;
        var gx = W - gw - 60, gy = H*0.10;
        return { x: gx + gw*0.50, y: gy + gh*0.42 };
      },
      drawRibbonScene: function(ctx, t, T, W, H, team, impact){
        // 5m yellow line
        var lineAlpha = (t < T.impact + 200) ? 1 - seg(t, T.impact, T.impact + 200)*0.4 : 0.6;
        draw5mLine(ctx, H*0.70, W, lineAlpha, '5M');
        // penalty mark on water
        var markAlpha = (t < T.impact) ? 0.9 + 0.1*Math.sin(t*0.012) : Math.max(0, 1 - seg(t, T.impact, T.impact + 300));
        drawPenaltyMark(ctx, W*0.40, H*0.78, H*0.018, markAlpha);
        // goal
        var gh = H * 0.40, gw = gh * 3.33;
        var gx = W - gw - 60, gy = H*0.10;
        var reveal = easeOutCubic(seg(t, 80, 600));
        drawGoal(ctx, { x: gx, y: gy, w: gw, h: gh,
          bulge: netBulge(t, T, gh*0.15), team: team, reveal: reveal });
      },
      drawRibbonPreImpact: (function(){
        var rtrail = [];
        return function(ctx, t, T, W, H, team, impact){
          var fly = T.impact - 320;
          var p = seg(t, fly, T.impact);
          if(t > T.impact + 60){ rtrail.length = 0; return; }
          // straight bullet from the penalty spot into the goal
          var bx = lerp(W*0.40, impact.x, easeInQuad(p));
          var by = lerp(H*0.72, impact.y, easeInQuad(p));
          var r  = lerp(H*0.14, H*0.10, p);
          rtrail.push({x:bx, y:by}); if(rtrail.length>10) rtrail.shift();
          drawBallTrail(ctx, rtrail, r);
          drawBall(ctx, bx, by, r, t*0.015);
        };
      })()
    });
  })();

  // ═══════════════════════════════════════════════════════════════
  // CUE: BIG SAVE — split composition: action right, type left
  // ═══════════════════════════════════════════════════════════════
  (function(){
    // Push goal to far right so the glove + block reads in the right half
    var GOAL = { x: 1380, y: WATER_Y - 230, w: 520, h: 230 };
    // BLOCK in front of goal mouth (outside the net)
    var BLOCK = { x: GOAL.x - 80, y: GOAL.y + GOAL.h*0.42 };
    var trail = [];

    VENUE.register('waterpolo-save', {
      sport: 'WATER POLO',
      headline: 'SAVE',
      headSize: 360,
      headPos: { x: 110, y: 380 },        // top-left, smaller, left-aligned
      headAlign: 'left',
      infoPos: { x: 110, y: 600 },
      infoAlign: 'left',
      context: '2ND PERIOD · POWER PLAY KILLED',
      player: { number: '1', name: 'OKONKWO · GK' },
      team: '#ffd21a',
      scene: 'pool',
      noChevron: true,                     // not a celebratory sweep
      noLightShaft: true,                  // shaft slams DOWN — reads like a goal
      impactPoint: function(){ return BLOCK; },
      drawScene: function(ctx, t, T, W, H, team){
        // Net stays still — ball never reaches it
        var reveal = easeOutCubic(seg(t, 150, 1000));
        drawGoal(ctx, {
          x:GOAL.x, y:GOAL.y, w:GOAL.w, h:GOAL.h,
          bulge: 0, team: team, reveal: reveal
        });
        // HAND is huge and appears BEFORE the headline so it's the anchor
        var gp = seg(t, T.impact - 400, T.impact);
        if(gp > 0){
          var scale = lerp(0.6, 1.55, easeOutBack(gp));
          drawBlockHand(ctx, BLOCK.x, BLOCK.y, scale, gp, team);
        }
        // post-impact: hand HOLDS at full size, stays visible
        if(t >= T.impact && t < T.impact + 2400){
          drawBlockHand(ctx, BLOCK.x, BLOCK.y, 1.55, 1, team);
        }
        // bright defensive flash at the block point
        if(t >= T.impact && t < T.impact + 420){
          var p = seg(t, T.impact, T.impact + 420);
          ctx.save();
          ctx.globalCompositeOperation = 'lighter';
          var g = ctx.createRadialGradient(BLOCK.x, BLOCK.y, 0, BLOCK.x, BLOCK.y, 360*(1-p*0.4));
          g.addColorStop(0, 'rgba(255,255,255,'+(1-p)+')');
          g.addColorStop(0.4, 'rgba(255,210,40,'+((1-p)*0.7)+')');
          g.addColorStop(1, 'rgba(255,210,40,0)');
          ctx.fillStyle = g;
          ctx.beginPath(); ctx.arc(BLOCK.x, BLOCK.y, 360, 0, Math.PI*2); ctx.fill();
          ctx.restore();
        }
        // "DENIED" stamp — over the glove, angled, smaller and tight
        var dp = seg(t, T.impact + 80, T.impact + 380);
        if(dp > 0 && t < T.impact + 2400){
          ctx.save();
          ctx.translate(BLOCK.x + 30, BLOCK.y + 200);
          ctx.rotate(-0.18);
          var ds = lerp(1.6, 1.0, easeOutBack(dp));
          ctx.scale(ds, ds);
          ctx.fillStyle = '#ff3b30';
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 4;
          ctx.shadowColor = '#ff3b30'; ctx.shadowBlur = 26;
          rrect(ctx, -140, -42, 280, 84, 8);
          ctx.fill(); ctx.stroke();
          ctx.shadowBlur = 0;
          ctx.font = '900 50px "Inter", sans-serif';
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillStyle = '#ffffff';
          ctx.fillText('DENIED', 0, 0);
          ctx.restore();
        }
      },
      drawPreImpact: function(ctx, t, T, W, H, team){
        // ball comes in fast, STOPS at the glove face, BOUNCES back left
        var fly = T.impact - 700;
        var px, py, r;
        if(t < T.impact){
          var pre = seg(t, fly, T.impact);
          px = lerp(-220, BLOCK.x - 50, easeOutQuad(pre));
          py = lerp(WATER_Y - 80, BLOCK.y, pre) - Math.sin(Math.PI*pre)*200;
          r  = lerp(54, 36, pre);
          trail.push({x:px, y:py}); if(trail.length>16) trail.shift();
        } else if(t < T.impact + 70){
          // compression at glove face
          px = BLOCK.x - 50; py = BLOCK.y; r = 32;
        } else {
          // strong bounce back to lower-left
          var post = seg(t, T.impact + 70, T.impact + 1000);
          px = lerp(BLOCK.x - 50, -200, easeOutQuad(post));
          py = lerp(BLOCK.y, BLOCK.y + 180, easeOutCubic(post)) - Math.sin(Math.PI*post)*120;
          r  = lerp(32, 22, post);
          trail.push({x:px, y:py}); if(trail.length>24) trail.shift();
          if(post >= 1){ trail.length = 0; return; }
        }
        drawBallTrail(ctx, trail, r);
        drawBall(ctx, px, py, r, t*0.012);
      },
      ribbon: { headSize: 200 },
      noChevron: true,
      noLightShaft: true,
      ribbonImpactPoint: function(W,H){
        // block point sits in front of the goal
        var gw = H * 3.33, gh = H * 0.40;
        var gx = W - gw - 80, gy = H*0.10;
        return { x: gx - H*0.10, y: gy + gh*0.42 };
      },
      drawRibbonScene: function(ctx, t, T, W, H, team, impact){
        // goal
        var gh = H * 0.40, gw = gh * 3.33;
        var gx = W - gw - 80, gy = H*0.10;
        var reveal = easeOutCubic(seg(t, 80, 600));
        drawGoal(ctx, { x: gx, y: gy, w: gw, h: gh, bulge: 0, team: team, reveal: reveal });
        // HAND — scaled for ribbon height
        var handScale = H * 0.006;  // ~1.5 at H=256
        var gp = seg(t, T.impact - 350, T.impact);
        if(gp > 0){
          var s = lerp(0.6, handScale, easeOutBack(gp));
          drawBlockHand(ctx, impact.x, impact.y, s, gp, team);
        }
        if(t >= T.impact && t < T.impact + 2400){
          drawBlockHand(ctx, impact.x, impact.y, handScale, 1, team);
        }
        // defensive flash
        if(t >= T.impact && t < T.impact + 380){
          var p = seg(t, T.impact, T.impact + 380);
          ctx.save();
          ctx.globalCompositeOperation = 'lighter';
          var fr = H*1.0*(1-p*0.4);
          var g = ctx.createRadialGradient(impact.x, impact.y, 0, impact.x, impact.y, fr);
          g.addColorStop(0, 'rgba(255,255,255,'+(1-p)+')');
          g.addColorStop(0.4, 'rgba(255,210,40,'+((1-p)*0.7)+')');
          g.addColorStop(1, 'rgba(255,210,40,0)');
          ctx.fillStyle = g;
          ctx.beginPath(); ctx.arc(impact.x, impact.y, fr, 0, Math.PI*2); ctx.fill();
          ctx.restore();
        }
        // DENIED stamp scaled for ribbon
        var dp = seg(t, T.impact + 80, T.impact + 380);
        if(dp > 0 && t < T.impact + 2400){
          ctx.save();
          ctx.translate(impact.x + H*0.10, impact.y + H*0.42);
          ctx.rotate(-0.18);
          var ds = lerp(1.6, 1.0, easeOutBack(dp)) * (H/256);
          ctx.scale(ds, ds);
          ctx.fillStyle = '#ff3b30';
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 3;
          ctx.shadowColor = '#ff3b30'; ctx.shadowBlur = 18;
          rrect(ctx, -90, -26, 180, 52, 6);
          ctx.fill(); ctx.stroke();
          ctx.shadowBlur = 0;
          ctx.font = '900 32px "Inter", sans-serif';
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillStyle = '#ffffff';
          ctx.fillText('DENIED', 0, 0);
          ctx.restore();
        }
      },
      drawRibbonPreImpact: (function(){
        var rtrail = [];
        return function(ctx, t, T, W, H, team, impact){
          var fly = T.impact - 600;
          var px, py, r;
          if(t < T.impact){
            var pre = seg(t, fly, T.impact);
            px = lerp(W*0.05, impact.x - H*0.15, easeOutQuad(pre));
            py = lerp(H*0.55, impact.y, pre) - Math.sin(Math.PI*pre)*(H*0.20);
            r  = lerp(H*0.18, H*0.12, pre);
            rtrail.push({x:px, y:py}); if(rtrail.length>14) rtrail.shift();
          } else if(t < T.impact + 70){
            px = impact.x - H*0.15; py = impact.y; r = H*0.12;
          } else {
            var post = seg(t, T.impact + 70, T.impact + 1000);
            px = lerp(impact.x - H*0.15, -H*0.4, easeOutQuad(post));
            py = lerp(impact.y, impact.y + H*0.30, easeOutCubic(post)) - Math.sin(Math.PI*post)*(H*0.18);
            r  = lerp(H*0.12, H*0.08, post);
            rtrail.push({x:px, y:py}); if(rtrail.length>24) rtrail.shift();
            if(post >= 1){ rtrail.length = 0; return; }
          }
          drawBallTrail(ctx, rtrail, r);
          drawBall(ctx, px, py, r, t*0.012);
        };
      })()
    });
  })();

  // ═══════════════════════════════════════════════════════════════
  // CUE: POWER PLAY 6 ON 5 — type-led, with a 6-vs-5 dot row showing the
  // numerical advantage. No collage of props — reads at a glance.
  // ═══════════════════════════════════════════════════════════════
  (function(){
    VENUE.register('waterpolo-powerplay', {
      sport: 'WATER POLO',
      headline: 'POWER PLAY',
      headSize: 300,
      context: 'MAN UP · 6 ON 5',
      // Power play is a TEAM situation, not one player's moment — no name line
      // (the 6-vs-5 dot row below shows the advantage).
      player: null,
      team: '#ffd21a',
      scene: 'pool',
      impactPoint: function(W,H){ return { x: W*0.5, y: H*0.42 }; },
      drawScene: function(ctx, t, T, W, H, team){
        // 6 vs 5 dot row sits below the headline, slides in just after impact
        var p = seg(t, T.impact + 320, T.impact + 760);
        if(p<=0) return;
        ctx.save();
        ctx.globalAlpha = p;
        var rowY = H*0.78;
        var dotR = 22;
        var gap = 64;
        var labelGap = 80;
        var hot = [255,45,85];

        // HOME side: 6 dots in team color
        var hLabel = 'HOME', aLabel = 'AWAY';
        var hotalpha = rgba(hot, 0.95);
        var teamAlpha = rgba(team, 0.95);
        var litTeam  = rgba(lighten(team,0.4),1);

        // total width: home (5*gap) + center separator (160) + away (4*gap)
        var homeW = 5*gap;
        var awayW = 4*gap;
        var sepW  = 220;
        var totalW = homeW + sepW + awayW;
        var startX = W/2 - totalW/2;

        // home label
        ctx.font = '700 24px "JetBrains Mono", monospace';
        ctx.textBaseline = 'middle'; ctx.textAlign = 'right';
        ctx.fillStyle = litTeam;
        ctx.fillText('6', startX - 24, rowY);
        ctx.font = '500 18px "JetBrains Mono", monospace';
        ctx.fillText('IN', startX - 24, rowY + 28);

        // home dots (6)
        for(var i=0;i<6;i++){
          var dx = startX + i*gap + dotR;
          ctx.fillStyle = teamAlpha;
          ctx.shadowColor = rgba(team,1); ctx.shadowBlur = 16;
          ctx.beginPath(); ctx.arc(dx, rowY, dotR, 0, Math.PI*2); ctx.fill();
        }
        ctx.shadowBlur = 0;

        // vs separator
        var sepX = startX + homeW + sepW/2;
        ctx.font = '900 36px "Anton", Impact, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillStyle = 'rgba(180,200,220,0.9)';
        ctx.fillText('vs', sepX, rowY);

        // away dots (5) — 4 lit + 1 crossed out
        for(var i=0;i<5;i++){
          var dx = startX + homeW + sepW + i*gap + dotR;
          ctx.fillStyle = i===4 ? 'rgba(255,45,85,0.18)' : hotalpha;
          ctx.shadowColor = i===4 ? 'rgba(0,0,0,0)' : rgba(hot,1); ctx.shadowBlur = 16;
          ctx.beginPath(); ctx.arc(dx, rowY, dotR, 0, Math.PI*2); ctx.fill();
          if(i===4){
            // crossed out
            ctx.shadowBlur = 0;
            ctx.strokeStyle = hotalpha;
            ctx.lineWidth = 5;
            ctx.beginPath();
            ctx.moveTo(dx-dotR, rowY-dotR); ctx.lineTo(dx+dotR, rowY+dotR);
            ctx.moveTo(dx+dotR, rowY-dotR); ctx.lineTo(dx-dotR, rowY+dotR);
            ctx.stroke();
          }
        }
        ctx.shadowBlur = 0;

        // away label
        var awayEndX = startX + totalW;
        ctx.font = '700 24px "JetBrains Mono", monospace';
        ctx.textAlign = 'left';
        ctx.fillStyle = hotalpha;
        ctx.fillText('5', awayEndX + 24, rowY);
        ctx.font = '500 18px "JetBrains Mono", monospace';
        ctx.fillText('IN', awayEndX + 24, rowY + 28);

        ctx.restore();
      },
      ribbon: { headSize: 160 },
      ribbonImpactPoint: function(W,H){ return { x: W*0.5, y: H*0.42 }; },
      drawRibbonScene: function(ctx, t, T, W, H, team, impact){
        // 6 vs 5 dot row centered, spread wide
        var p = seg(t, T.impact + 320, T.impact + 760);
        if(p<=0) return;
        ctx.save();
        ctx.globalAlpha = p;
        var rowY = H * 0.74;
        var dotR = H * 0.06;
        var gap = H * 0.16;
        var hot = [255,45,85];
        // start position centered
        var homeW = 5*gap, awayW = 4*gap, sepW = H*0.50;
        var totalW = homeW + sepW + awayW;
        var startX = W*0.55 - totalW/2;
        // home 6 dots
        for(var i=0;i<6;i++){
          var dx = startX + i*gap + dotR;
          ctx.fillStyle = rgba(team, 0.95);
          ctx.shadowColor = rgba(team,1); ctx.shadowBlur = 12;
          ctx.beginPath(); ctx.arc(dx, rowY, dotR, 0, Math.PI*2); ctx.fill();
        }
        ctx.shadowBlur = 0;
        // separator
        var sepX = startX + homeW + sepW/2;
        ctx.font = '900 ' + Math.round(H*0.16) + 'px "Anton", Impact, sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillStyle = 'rgba(180,200,220,0.9)';
        ctx.fillText('vs', sepX, rowY);
        // away 5 dots (4 lit + 1 crossed)
        for(var i=0;i<5;i++){
          var dx = startX + homeW + sepW + i*gap + dotR;
          ctx.fillStyle = i===4 ? 'rgba(255,45,85,0.18)' : rgba(hot, 0.95);
          ctx.shadowColor = i===4 ? 'rgba(0,0,0,0)' : rgba(hot,1); ctx.shadowBlur = 12;
          ctx.beginPath(); ctx.arc(dx, rowY, dotR, 0, Math.PI*2); ctx.fill();
          if(i===4){
            ctx.shadowBlur = 0;
            ctx.strokeStyle = rgba(hot, 0.95);
            ctx.lineWidth = 4;
            ctx.beginPath();
            ctx.moveTo(dx-dotR, rowY-dotR); ctx.lineTo(dx+dotR, rowY+dotR);
            ctx.moveTo(dx+dotR, rowY-dotR); ctx.lineTo(dx-dotR, rowY+dotR);
            ctx.stroke();
          }
        }
        ctx.restore();
      }
    });
  })();

  // ═══════════════════════════════════════════════════════════════
  // CUE: EXCLUSION — a 20-second kick-out (ejection). Referee whistle
  // blows, a :20 countdown rises, "MAN UP" for the advantaged team.
  // This is NOT a penalty shot (that's waterpolo-penalty) — an exclusion
  // is an ejection that creates a man-advantage.
  // ═══════════════════════════════════════════════════════════════
  (function(){
    VENUE.register('waterpolo-exclusion', {
      sport: 'WATER POLO',
      headline: 'EXCLUSION',
      headSize: 300,
      headPos: { x: 100, y: 1080*0.34 },
      headAlign: 'left',
      infoPos: { x: 100, y: 1080*0.56 },
      infoAlign: 'left',
      context: 'MAN UP · 20 SEC',
      player: { number: '4', name: 'BANKS' },
      team: '#21e6ff',
      scene: 'pool',
      impactPoint: function(W,H){ return { x: W*0.70, y: H*0.42 }; },
      drawScene: function(ctx, t, T, W, H, team){
        var wx = W*0.70, wy = H*0.42;
        // Referee whistle pops in (the call) and blows steam.
        var wp = seg(t, T.impact - 250, T.impact + 120);
        if(wp > 0){
          var ws = lerp(0.55, 1.2, easeOutBack(wp));
          drawWhistle(ctx, wx, wy, ws, wp, team);
          var bp = seg(t, T.impact, T.impact + 320);
          if(bp > 0) drawWhistleBlow(ctx, wx + 95*ws, wy, t, bp);
        }
        // 20-second exclusion clock rises in below the whistle.
        var cp = seg(t, T.impact + 220, T.impact + 640);
        if(cp > 0){
          var cy = lerp(H*0.82, H*0.72, easeOutCubic(cp));
          drawCountdownClock(ctx, wx, cy, ':20', 0.8, cp, team);
        }
      },
      ribbon: { headSize: 130 },
      ribbonImpactPoint: function(W,H){ return { x: W*0.74, y: H*0.42 }; },
      drawRibbonScene: function(ctx, t, T, W, H, team){
        var wx = W*0.74, wy = H*0.40;
        var wp = seg(t, T.impact - 200, T.impact + 100);
        if(wp > 0){
          var ws = lerp(H*0.0016, H*0.0030, easeOutBack(wp));
          drawWhistle(ctx, wx, wy, ws, wp, team);
          var bp = seg(t, T.impact, T.impact + 300);
          if(bp > 0) drawWhistleBlow(ctx, wx + H*0.28*ws, wy, t, bp);
        }
        var cp = seg(t, T.impact + 200, T.impact + 560);
        if(cp > 0) drawCountdownClock(ctx, W*0.90, H*0.5, ':20', H*0.0016, cp, team);
      }
    });
  })();

  // ═══════════════════════════════════════════════════════════════
  // CUE: HAT TRICK — three balls in quick succession, three net bulges,
  // a counter of three lit balls showing the tally. No hats.
  // ═══════════════════════════════════════════════════════════════
  (function(){
    var GOAL = { x: 1200, y: WATER_Y - 250, w: 560, h: 250 };
    var IMPACT = { x: GOAL.x + GOAL.w*0.40, y: GOAL.y + GOAL.h*0.48 };
    var trails = [[],[],[]];

    // Three sequential goal events leading up to T.impact (which is the HAT TRICK reveal)
    var BALL_OFFSETS = [-1200, -800, -300]; // ms before T.impact for each ball's strike

    function ballBulge(t, T, idx){
      var hitTime = T.impact + BALL_OFFSETS[idx];
      if(t < hitTime) return 0;
      var e = t - hitTime;
      if(e > 700) return 0;
      return Math.exp(-e/200) * Math.sin(e*0.034) * 28;
    }

    VENUE.register('waterpolo-hattrick', {
      sport: 'WATER POLO',
      headline: 'HAT TRICK',
      headSize: 340,
      context: '4TH PERIOD · 8:11',
      player: { number: '7', name: 'RIVERA' },
      team: '#21e6ff',
      scene: 'pool',
      T: { impact: 1700, hold: 4200, end: 5000 },
      impactPoint: function(){ return IMPACT; },
      drawScene: function(ctx, t, T, W, H, team){
        // Goal is the ANCHOR — net bulges three times in succession
        var totalBulge = 0;
        for(var i=0;i<3;i++) totalBulge += ballBulge(t, T, i);
        var reveal = easeOutCubic(seg(t, 150, 800));
        drawGoal(ctx, {
          x:GOAL.x, y:GOAL.y, w:GOAL.w, h:GOAL.h,
          bulge: totalBulge, team: team, reveal: reveal
        });
        // Quick white flash for each ball impact
        for(var i=0;i<3;i++){
          var hit = T.impact + BALL_OFFSETS[i];
          if(t >= hit && t < hit + 300){
            var fp = seg(t, hit, hit + 300);
            ctx.save();
            ctx.globalCompositeOperation = 'lighter';
            var g = ctx.createRadialGradient(IMPACT.x, IMPACT.y, 0, IMPACT.x, IMPACT.y, 220*(1-fp*0.5));
            g.addColorStop(0, 'rgba(255,255,255,'+(1-fp)*0.9+')');
            g.addColorStop(0.5, rgba(lighten(team,0.4),(1-fp)*0.7));
            g.addColorStop(1, 'rgba(255,255,255,0)');
            ctx.fillStyle = g;
            ctx.beginPath(); ctx.arc(IMPACT.x, IMPACT.y, 220, 0, Math.PI*2); ctx.fill();
            ctx.restore();
          }
        }
        // Three-ball tally row — each lights as its goal lands
        var tallyP = seg(t, T.impact + 380, T.impact + 800);
        if(tallyP > 0){
          ctx.save();
          ctx.globalAlpha = tallyP;
          var ty = H*0.82;
          var gap = 100;
          for(var i=0;i<3;i++){
            var tx = W/2 + (i-1)*gap;
            var lit = (t > T.impact + BALL_OFFSETS[i] + 200);
            ctx.save();
            if(lit){
              ctx.shadowColor = rgba(team,1); ctx.shadowBlur = 24;
              var bg = ctx.createRadialGradient(tx-8, ty-8, 2, tx, ty, 28);
              bg.addColorStop(0,'#fff7cf'); bg.addColorStop(0.6,'#ffd21a'); bg.addColorStop(1,'#c98a00');
              ctx.fillStyle = bg;
            } else {
              ctx.fillStyle = 'rgba(80,90,110,0.3)';
              ctx.strokeStyle = 'rgba(180,200,220,0.4)'; ctx.lineWidth = 2;
            }
            ctx.beginPath(); ctx.arc(tx, ty, 28, 0, Math.PI*2); ctx.fill();
            if(!lit) ctx.stroke();
            ctx.restore();
          }
          ctx.restore();
        }
      },
      drawPreImpact: function(ctx, t, T, W, H, team){
        // Three balls arrive in succession
        var froms = [
          [-220, WATER_Y + 40],
          [-150, 200],
          [340, WATER_Y + 80]
        ];
        for(var i=0;i<3;i++){
          var hit = T.impact + BALL_OFFSETS[i];
          var fly = hit - 500;
          var p = seg(t, fly, hit);
          if(p<=0 || t > hit + 60){ trails[i].length = 0; continue; }
          var s = froms[i];
          var bx = lerp(s[0], IMPACT.x, easeOutQuad(p));
          var by = lerp(s[1], IMPACT.y, p) - Math.sin(Math.PI*p)*160;
          var r  = lerp(46, 30, p);
          trails[i].push({x:bx, y:by}); if(trails[i].length>12) trails[i].shift();
          drawBallTrail(ctx, trails[i], r);
          drawBall(ctx, bx, by, r, t*0.012 + i);
        }
      },
      ribbon: { headSize: 100 },
      ribbonT: { impact: 1500, hold: 3800, end: 4400 },
      ribbonImpactPoint: function(W,H){
        var gw = H * 3.33, gh = H * 0.40;
        var gx = W - gw - 60, gy = H*0.10;
        return { x: gx + gw*0.40, y: gy + gh*0.48 };
      },
      drawRibbonScene: function(ctx, t, T, W, H, team, impact){
        // goal with multiple bulges
        var totalBulge = 0;
        for(var i=0;i<3;i++) totalBulge += ballBulge(t, T, i);
        var gh = H * 0.40, gw = gh * 3.33;
        var gx = W - gw - 60, gy = H*0.10;
        var reveal = easeOutCubic(seg(t, 80, 500));
        drawGoal(ctx, { x: gx, y: gy, w: gw, h: gh,
          bulge: totalBulge, team: team, reveal: reveal });
        // three flashes per ball
        for(var i=0;i<3;i++){
          var hit = T.impact + BALL_OFFSETS[i];
          if(t >= hit && t < hit + 280){
            var fp = seg(t, hit, hit + 280);
            ctx.save();
            ctx.globalCompositeOperation = 'lighter';
            var fr = H*0.65*(1-fp*0.4);
            var g = ctx.createRadialGradient(impact.x, impact.y, 0, impact.x, impact.y, fr);
            g.addColorStop(0, 'rgba(255,255,255,'+(1-fp)*0.9+')');
            g.addColorStop(0.5, rgba(lighten(team,0.4),(1-fp)*0.7));
            g.addColorStop(1, 'rgba(255,255,255,0)');
            ctx.fillStyle = g;
            ctx.beginPath(); ctx.arc(impact.x, impact.y, fr, 0, Math.PI*2); ctx.fill();
            ctx.restore();
          }
        }
        // tally row — three balls bottom
        var tallyP = seg(t, T.impact + 380, T.impact + 800);
        if(tallyP > 0){
          ctx.save();
          ctx.globalAlpha = tallyP;
          var ty = H*0.88;
          var br = H*0.06;
          var bgap = H*0.20;
          var startX = W*0.40 - bgap;
          for(var i=0;i<3;i++){
            var tx = startX + i*bgap;
            var lit = (t > T.impact + BALL_OFFSETS[i] + 200);
            if(lit){
              ctx.shadowColor = rgba(team,1); ctx.shadowBlur = 14;
              var bg = ctx.createRadialGradient(tx-br*0.3, ty-br*0.3, 1, tx, ty, br);
              bg.addColorStop(0,'#fff7cf'); bg.addColorStop(0.6,'#ffd21a'); bg.addColorStop(1,'#c98a00');
              ctx.fillStyle = bg;
            } else {
              ctx.fillStyle = 'rgba(80,90,110,0.3)';
              ctx.strokeStyle = 'rgba(180,200,220,0.4)'; ctx.lineWidth = 2;
            }
            ctx.beginPath(); ctx.arc(tx, ty, br, 0, Math.PI*2); ctx.fill();
            if(!lit) ctx.stroke();
            ctx.shadowBlur = 0;
          }
          ctx.restore();
        }
      },
      drawRibbonPreImpact: (function(){
        var rtrails = [[],[],[]];
        return function(ctx, t, T, W, H, team, impact){
          var froms = [
            [-H*0.4, H*0.62],
            [-H*0.2, H*0.20],
            [W*0.20, H*0.65]
          ];
          for(var i=0;i<3;i++){
            var hit = T.impact + BALL_OFFSETS[i];
            var fly = hit - 500;
            var p = seg(t, fly, hit);
            if(p<=0 || t > hit + 60){ rtrails[i].length = 0; continue; }
            var s = froms[i];
            var bx = lerp(s[0], impact.x, easeOutQuad(p));
            var by = lerp(s[1], impact.y, p) - Math.sin(Math.PI*p)*(H*0.16);
            var r  = lerp(H*0.16, H*0.10, p);
            rtrails[i].push({x:bx, y:by}); if(rtrails[i].length>10) rtrails[i].shift();
            drawBallTrail(ctx, rtrails[i], r);
            drawBall(ctx, bx, by, r, t*0.012 + i);
          }
        };
      })()
    });
  })();

  // ═══════════════════════════════════════════════════════════════
  // GROUP MANIFEST
  // ═══════════════════════════════════════════════════════════════
  VENUE.GROUPS = window.VENUE.GROUPS || {};
  VENUE.GROUPS['Water polo'] = [
    'waterpolo-goal',
    'waterpolo-penalty',
    'waterpolo-save',
    'waterpolo-exclusion',
    'waterpolo-powerplay',
    'waterpolo-hattrick'
  ];
})();
