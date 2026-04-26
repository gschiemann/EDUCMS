"use client";

/**
 * HsZineWidget — Photocopied cut-and-paste zine lobby scene, 3840×2160.
 *
 * APPROVED 2026-04-23 — matches scratch/design/hs/zine.html
 *
 * Concept: DIY student zine. Photocopied paper texture, rotated
 * panels with tape strips, marker annotations, ransom-letter
 * announcement with yellow highlight, polaroid event photos.
 */

import { HsStage } from './HsStage';

export interface HsZineConfig {
  schoolName?: string;
  schoolSub?: string;
  brandStamp1?: string;
  brandStamp2?: string;
  brandStamp3?: string;
  greetingEyebrow?: string;
  greetingHeadline1?: string;
  greetingHeadline2?: string;
  greetingHeadline3?: string;
  greetingSubtitle?: string;
  teacherCaption?: string;
  teacherSub?: string;
  attendanceValue?: string;
  attendanceCap?: string;
  countdownLabel?: string;
  countdownValue?: string | number;
  countdownSub?: string;
  event0When?: string;
  event0Name?: string;
  event1When?: string;
  event1Name?: string;
  event2When?: string;
  event2Name?: string;
  countdownBigValue?: string | number;
  countdownBigLabel?: string;
  announcementTag?: string;
  announcementHeadline?: string;
  announcementBody?: string;
  announcementDate?: string;
  clockLabel?: string;
  clockTime?: string;
  weatherCondition?: string;
  tickerTag?: string;
  tickerMessage?: string;
}

const DEFAULTS: Required<HsZineConfig> = {
  schoolName: 'WESTRIDGE!',
  schoolSub: 'vol. 142 · morning edition · photocopied by hand · free',
  brandStamp1: '★ WILDCATS FOREVER',
  brandStamp2: '// issue 142',
  brandStamp3: '4/21 · tue · 7:53am',
  greetingEyebrow: '// hi everybody,',
  greetingHeadline1: 'BE',
  greetingHeadline2: 'LOUD',
  greetingHeadline3: 'TODAY.',
  greetingSubtitle: "the bell rings at 8:05. bring a pen. eat something. tell somebody good morning. you've got this — we all do. xo — the zine kids.",
  teacherCaption: 'MS. KOWALSKI!!',
  teacherSub: '>> teacher of the week · ap physics · rm 214 <<',
  attendanceValue: '1,217',
  attendanceCap: '98.2% · nice work',
  countdownLabel: '// grad in',
  countdownValue: 41,
  countdownSub: 'days & counting!!',
  event0When: 'MON 3:30',
  event0Name: 'stu. gov. open mtg · library',
  event1When: 'WED 7pm',
  event1Name: 'spring band concert · aud.',
  event2When: 'FRI 7pm',
  event2Name: '"into the woods" — opening!',
  countdownBigValue: 41,
  countdownBigLabel: "DAYS 'TIL GRAD!!",
  announcementTag: 'URGENT & COOL',
  announcementHeadline: 'PEP RALLY — 7TH PERIOD · GYM A',
  announcementBody: 'seniors front row! marching band enters south doors. no backpacks in gym. go back to 8th when the bell rings. be loud!',
  announcementDate: '→ today · 2:15 to 3:00 ←',
  clockLabel: '// right now',
  clockTime: '7:53',
  weatherCondition: 'tue · apr 21 · 46° · clear · high 62°',
  tickerTag: 'xeroxwire',
  tickerMessage: 'bus 14 running late !! · lunch: chicken bowl, salad bar, vegan opt · ap psych → library · LOST: silver earbuds — front desk · sports photos tmrw bring your jersey · submit to the zine rm 217 · ',
};

export function HsZineWidget({ config }: { config?: HsZineConfig }) {
  const c = { ...DEFAULTS, ...(config || {}) } as Required<HsZineConfig>;
  return (
    <HsStage
      stageStyle={{
        background: '#f2ecd9',
        backgroundImage:
          'radial-gradient(circle at 20% 30%, rgba(0,0,0,.04), transparent 40%), radial-gradient(circle at 80% 70%, rgba(0,0,0,.05), transparent 40%), repeating-linear-gradient(0deg, rgba(0,0,0,.02) 0 1px, transparent 1px 3px)',
        fontFamily: "'Courier Prime', monospace",
        color: '#15120d',
      }}
    >
      <style>{CSS}</style>
      <div className="hs-zn-streaks" />

      <div className="hs-zn-mast">
        <div className="hs-zn-title">
          <span data-field="schoolName" style={{ whiteSpace: 'pre-wrap' as const }}>{c.schoolName}</span>
          <span className="hs-zn-title-sub" data-field="schoolSub" style={{ whiteSpace: 'pre-wrap' as const }}>{c.schoolSub}</span>
        </div>
        <div className="hs-zn-stamps">
          <span className="hs-zn-stamp" data-field="brandStamp1" style={{ whiteSpace: 'pre-wrap' as const }}>{c.brandStamp1}</span>
          <span className="hs-zn-stamp hs-zn-stamp-ink2" data-field="brandStamp2" style={{ whiteSpace: 'pre-wrap' as const }}>{c.brandStamp2}</span>
          <span className="hs-zn-stamp hs-zn-stamp-cyan" data-field="brandStamp3" style={{ whiteSpace: 'pre-wrap' as const }}>{c.brandStamp3}</span>
        </div>
      </div>

      <div className="hs-zn-hero">
        <div className="hs-zn-sheet">
          <div className="hs-zn-eyebrow" data-field="greetingEyebrow" style={{ whiteSpace: 'pre-wrap' as const }}>{c.greetingEyebrow}</div>
          <h1 className="hs-zn-h1">
            <span data-field="greetingHeadline1" style={{ whiteSpace: 'pre-wrap' as const }}>{c.greetingHeadline1}</span> <em data-field="greetingHeadline2" style={{ whiteSpace: 'pre-wrap' as const }}>{c.greetingHeadline2}</em> <span data-field="greetingHeadline3" style={{ whiteSpace: 'pre-wrap' as const }}>{c.greetingHeadline3}</span>
          </h1>
          <p className="hs-zn-sub" data-field="greetingSubtitle" style={{ whiteSpace: 'pre-wrap' as const }}>{c.greetingSubtitle}</p>
        </div>
      </div>

      <div className="hs-zn-side">
        <div className="hs-zn-poster">
          <div className="hs-zn-img" />
          <div className="hs-zn-caption">
            <span data-field="teacherCaption" style={{ whiteSpace: 'pre-wrap' as const }}>{c.teacherCaption}</span>
            <span className="hs-zn-caption-sub" data-field="teacherSub" style={{ whiteSpace: 'pre-wrap' as const }}>{c.teacherSub}</span>
          </div>
        </div>
        <div className="hs-zn-stats">
          <div className="hs-zn-stat">
            <div className="hs-zn-lbl">// here today</div>
            <div className="hs-zn-val" data-field="attendanceValue" style={{ whiteSpace: 'pre-wrap' as const }}>{c.attendanceValue}</div>
            <div className="hs-zn-cap" data-field="attendanceCap" style={{ whiteSpace: 'pre-wrap' as const }}>{c.attendanceCap}</div>
          </div>
          <div className="hs-zn-stat">
            <div className="hs-zn-lbl" data-field="countdownLabel" style={{ whiteSpace: 'pre-wrap' as const }}>{c.countdownLabel}</div>
            <div className="hs-zn-val" data-field="countdownValue" style={{ whiteSpace: 'pre-wrap' as const }}>{c.countdownValue}</div>
            <div className="hs-zn-cap" data-field="countdownSub" style={{ whiteSpace: 'pre-wrap' as const }}>{c.countdownSub}</div>
          </div>
        </div>
      </div>

      <div className="hs-zn-strip">
        <div className="hs-zn-polaroid hs-zn-p1">
          <div className="hs-zn-pic" />
          <div className="hs-zn-when" data-field="event0When" style={{ whiteSpace: 'pre-wrap' as const }}>{c.event0When}</div>
          <div className="hs-zn-name" data-field="event0Name" style={{ whiteSpace: 'pre-wrap' as const }}>{c.event0Name}</div>
        </div>
        <div className="hs-zn-polaroid hs-zn-p2">
          <div className="hs-zn-pic" />
          <div className="hs-zn-when" data-field="event1When" style={{ whiteSpace: 'pre-wrap' as const }}>{c.event1When}</div>
          <div className="hs-zn-name" data-field="event1Name" style={{ whiteSpace: 'pre-wrap' as const }}>{c.event1Name}</div>
        </div>
        <div className="hs-zn-polaroid hs-zn-p3">
          <div className="hs-zn-pic" />
          <div className="hs-zn-when" data-field="event2When" style={{ whiteSpace: 'pre-wrap' as const }}>{c.event2When}</div>
          <div className="hs-zn-name" data-field="event2Name" style={{ whiteSpace: 'pre-wrap' as const }}>{c.event2Name}</div>
        </div>
        <div className="hs-zn-polaroid hs-zn-count">
          <div className="hs-zn-num" data-field="countdownBigValue" style={{ whiteSpace: 'pre-wrap' as const }}>{c.countdownBigValue}</div>
          <div className="hs-zn-lb" data-field="countdownBigLabel" style={{ whiteSpace: 'pre-wrap' as const }}>{c.countdownBigLabel}</div>
        </div>
      </div>

      <div className="hs-zn-alert">
        <div className="hs-zn-alert-tag" data-field="announcementTag" style={{ whiteSpace: 'pre-wrap' as const }}>{c.announcementTag}</div>
        <h3 className="hs-zn-alert-h3" data-field="announcementHeadline" style={{ whiteSpace: 'pre-wrap' as const }}>{c.announcementHeadline}</h3>
        <p className="hs-zn-alert-p" data-field="announcementBody" style={{ whiteSpace: 'pre-wrap' as const }}>{c.announcementBody}</p>
        <div className="hs-zn-alert-when" data-field="announcementDate" style={{ whiteSpace: 'pre-wrap' as const }}>{c.announcementDate}</div>
      </div>

      <div className="hs-zn-fc">
        <div className="hs-zn-fc-lbl" data-field="clockLabel" style={{ whiteSpace: 'pre-wrap' as const }}>{c.clockLabel}</div>
        <div className="hs-zn-fc-v" data-field="clockTime" style={{ whiteSpace: 'pre-wrap' as const }}>{c.clockTime}</div>
        <div className="hs-zn-fc-c" data-field="weatherCondition" style={{ whiteSpace: 'pre-wrap' as const }}>{c.weatherCondition}</div>
      </div>

      <div className="hs-zn-ticker">
        <div className="hs-zn-tk-tag" data-field="tickerTag" style={{ whiteSpace: 'pre-wrap' as const }}>{c.tickerTag}</div>
        <div className="hs-zn-tk-msg">
          <span data-field="tickerMessage" style={{ whiteSpace: 'pre-wrap' as const }}>{c.tickerMessage}</span>
          <span data-field="tickerMessage" style={{ whiteSpace: 'pre-wrap' as const }}>{c.tickerMessage}</span>
        </div>
      </div>
    </HsStage>
  );
}

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Archivo+Black&family=Special+Elite&family=Permanent+Marker&family=Courier+Prime:wght@400;700&display=swap');
.hs-zn-streaks { position: absolute; inset: 0; pointer-events: none; background: linear-gradient(90deg, transparent 40%, rgba(0,0,0,.04) 60%, transparent 80%), linear-gradient(90deg, transparent 10%, rgba(0,0,0,.05) 13%, transparent 17%); }
.hs-zn-mast { position: absolute; top: 60px; left: 80px; right: 80px; height: 260px; display: flex; justify-content: space-between; align-items: flex-start; }
.hs-zn-title { font-family: 'Archivo Black', sans-serif; font-size: 200px; line-height: .85; letter-spacing: -.02em; color: #15120d; transform: rotate(-2deg); text-transform: uppercase; position: relative; }
.hs-zn-title::after { content: ''; position: absolute; top: 40%; left: -20px; right: -20px; height: 20px; background: #ffd84d; z-index: -1; transform: rotate(1.5deg); }
.hs-zn-title-sub { display: block; font-family: 'Special Elite', monospace; font-size: 38px; line-height: 1; color: #15120d; margin-top: 18px; letter-spacing: .1em; transform: rotate(1deg); text-transform: none; font-weight: normal; }
.hs-zn-stamps { display: flex; flex-direction: column; gap: 16px; align-items: flex-end; margin-top: 20px; }
.hs-zn-stamp { font-family: 'Special Elite', monospace; font-size: 28px; letter-spacing: .16em; color: #c1281a; padding: 10px 20px; border: 3px solid #c1281a; transform: rotate(3deg); text-transform: uppercase; background: rgba(255,255,255,.3); }
.hs-zn-stamp-ink2 { color: #15120d; border-color: #15120d; transform: rotate(-2deg); }
.hs-zn-stamp-cyan { color: #2dbce6; border-color: #2dbce6; transform: rotate(1deg); }
.hs-zn-hero { position: absolute; top: 360px; left: 80px; width: 2400px; }
.hs-zn-sheet { background: #fff; padding: 56px 64px 72px; position: relative; box-shadow: 6px 6px 0 rgba(0,0,0,.12); transform: rotate(-.6deg); }
.hs-zn-sheet::before { content: ''; position: absolute; top: -24px; left: 180px; width: 200px; height: 56px; background: rgba(255,216,77,.85); transform: rotate(-6deg); box-shadow: 0 2px 4px rgba(0,0,0,.15); }
.hs-zn-sheet::after { content: ''; position: absolute; bottom: -20px; right: 240px; width: 160px; height: 48px; background: rgba(45,188,230,.75); transform: rotate(3deg); }
.hs-zn-eyebrow { font-family: 'Permanent Marker', sans-serif; font-size: 50px; color: #c1281a; transform: rotate(-1deg); display: inline-block; margin-bottom: 20px; }
.hs-zn-h1 { font-family: 'Archivo Black', sans-serif; font-size: 320px; line-height: .88; letter-spacing: -.02em; color: #15120d; margin: 0; text-transform: uppercase; }
.hs-zn-h1 em { color: #c1281a; font-style: normal; background: #ffd84d; padding: 0 16px; }
.hs-zn-sub { font-family: 'Special Elite', monospace; font-size: 42px; line-height: 1.3; color: #15120d; margin-top: 36px; max-width: 2000px; }
.hs-zn-side { position: absolute; top: 360px; right: 80px; width: 1200px; display: grid; gap: 32px; }
.hs-zn-poster { background: #e8e2d0; padding: 28px; position: relative; transform: rotate(1.5deg); box-shadow: 4px 4px 0 rgba(0,0,0,.12); }
.hs-zn-poster::before { content: ''; position: absolute; top: -18px; left: 80px; width: 140px; height: 40px; background: rgba(193,40,26,.75); transform: rotate(-4deg); }
.hs-zn-img { width: 100%; height: 560px; background: #444; background-image: radial-gradient(circle at 35% 35%, #888 0 60px, transparent 60px), radial-gradient(circle at 35% 35%, transparent 0 55px, #222 55px 140px, transparent 140px), linear-gradient(180deg, #666 0%, #333 100%); filter: contrast(1.6) grayscale(1); position: relative; overflow: hidden; }
.hs-zn-img::after { content: ''; position: absolute; inset: 0; background: repeating-linear-gradient(0deg, rgba(255,255,255,.05) 0 3px, rgba(0,0,0,.15) 3px 5px); mix-blend-mode: multiply; }
.hs-zn-caption { font-family: 'Permanent Marker', sans-serif; font-size: 52px; color: #15120d; transform: rotate(-1deg); margin-top: 18px; line-height: 1; }
.hs-zn-caption-sub { display: block; font-family: 'Special Elite', monospace; font-size: 24px; color: #c1281a; margin-top: 10px; letter-spacing: .12em; }
.hs-zn-stats { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
.hs-zn-stat { background: #fff; padding: 20px 24px; position: relative; border: 3px solid #15120d; transform: rotate(-.8deg); box-shadow: 3px 3px 0 rgba(0,0,0,.12); }
.hs-zn-stat:nth-child(2) { transform: rotate(.8deg); background: #ffd84d; }
.hs-zn-lbl { font-family: 'Special Elite', monospace; font-size: 22px; letter-spacing: .18em; color: #c1281a; text-transform: uppercase; }
.hs-zn-val { font-family: 'Archivo Black', sans-serif; font-size: 110px; line-height: .9; color: #15120d; margin-top: 4px; }
.hs-zn-cap { font-family: 'Courier Prime', monospace; font-weight: 700; font-size: 20px; color: #15120d; margin-top: 4px; }
.hs-zn-strip { position: absolute; top: 1480px; left: 80px; right: 80px; height: 500px; display: grid; grid-template-columns: repeat(3, 1fr) 1fr; gap: 40px; }
.hs-zn-polaroid { background: #fff; padding: 20px 20px 50px; position: relative; box-shadow: 6px 6px 0 rgba(0,0,0,.15); }
.hs-zn-p1 { transform: rotate(-2deg); }
.hs-zn-p2 { transform: rotate(1.5deg); }
.hs-zn-p3 { transform: rotate(-1deg); }
.hs-zn-polaroid.hs-zn-count { transform: rotate(2.5deg); background: #c1281a; padding: 28px; color: #fff; text-align: center; }
.hs-zn-polaroid::before { content: ''; position: absolute; top: -20px; left: 40%; width: 180px; height: 50px; background: rgba(255,216,77,.7); transform: rotate(-4deg); }
.hs-zn-polaroid.hs-zn-count::before { background: rgba(255,216,77,.85); }
.hs-zn-pic { width: 100%; height: 280px; background: linear-gradient(135deg, #999, #333); filter: contrast(1.5) grayscale(1); position: relative; overflow: hidden; }
.hs-zn-pic::after { content: ''; position: absolute; inset: 0; background: repeating-linear-gradient(0deg, rgba(255,255,255,.06) 0 2px, rgba(0,0,0,.1) 2px 4px); mix-blend-mode: multiply; }
.hs-zn-when { font-family: 'Permanent Marker', sans-serif; font-size: 40px; color: #c1281a; margin-top: 16px; line-height: 1; }
.hs-zn-name { font-family: 'Special Elite', monospace; font-size: 28px; color: #15120d; margin-top: 8px; line-height: 1.2; }
.hs-zn-num { font-family: 'Archivo Black', sans-serif; font-size: 280px; line-height: .85; color: #fff; text-shadow: 4px 4px 0 rgba(0,0,0,.3); }
.hs-zn-lb { font-family: 'Permanent Marker', sans-serif; font-size: 36px; color: #fff; line-height: 1.1; margin-top: 8px; }
.hs-zn-alert { position: absolute; bottom: 120px; left: 80px; width: 1800px; padding: 36px 48px; background: #fff; transform: rotate(-.5deg); box-shadow: 6px 6px 0 rgba(0,0,0,.15); border: 4px solid #15120d; }
.hs-zn-alert::before { content: '!!'; position: absolute; top: -30px; left: -30px; font-family: 'Archivo Black', sans-serif; font-size: 140px; color: #c1281a; background: #ffd84d; width: 100px; height: 100px; display: grid; place-items: center; border: 4px solid #15120d; transform: rotate(-10deg); }
.hs-zn-alert-tag { font-family: 'Permanent Marker', sans-serif; font-size: 40px; color: #c1281a; transform: rotate(-1deg); display: inline-block; margin-bottom: 8px; }
.hs-zn-alert-h3 { font-family: 'Archivo Black', sans-serif; font-size: 90px; line-height: .95; letter-spacing: -.01em; color: #15120d; margin: 0; text-transform: uppercase; }
.hs-zn-alert-p { font-family: 'Special Elite', monospace; font-size: 32px; line-height: 1.3; color: #15120d; margin: 14px 0 0; }
.hs-zn-alert-when { font-family: 'Permanent Marker', sans-serif; font-size: 34px; color: #c1281a; margin-top: 10px; }
.hs-zn-fc { position: absolute; bottom: 140px; right: 80px; width: 900px; background: #ffd84d; padding: 28px 36px; border: 4px solid #15120d; transform: rotate(2deg); box-shadow: 6px 6px 0 rgba(0,0,0,.15); }
.hs-zn-fc-lbl { font-family: 'Special Elite', monospace; font-size: 24px; letter-spacing: .18em; color: #c1281a; text-transform: uppercase; }
.hs-zn-fc-v { font-family: 'Archivo Black', sans-serif; font-size: 160px; line-height: .9; color: #15120d; }
.hs-zn-fc-c { font-family: 'Courier Prime', monospace; font-weight: 700; font-size: 26px; color: #15120d; margin-top: 4px; }
.hs-zn-ticker { position: absolute; bottom: 0; left: 0; right: 0; height: 70px; background: #15120d; color: #f2ecd9; display: flex; align-items: center; overflow: hidden; }
.hs-zn-tk-tag { background: #c1281a; color: #fff; height: 100%; display: flex; align-items: center; padding: 0 30px; font-family: 'Permanent Marker', sans-serif; font-size: 30px; letter-spacing: .14em; flex-shrink: 0; }
.hs-zn-tk-msg { font-family: 'Special Elite', monospace; font-size: 30px; padding-left: 36px; white-space: nowrap; letter-spacing: .08em; animation: hsZnScroll 60s linear infinite; display: inline-flex; }
@keyframes hsZnScroll { from { transform: translateX(0); } to { transform: translateX(-50%); } }
`;
