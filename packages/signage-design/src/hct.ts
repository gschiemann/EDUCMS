/**
 * @cms/signage-design — HCT (internal)
 *
 * A correct, self-contained port of Google Material Color Utilities' HCT color
 * space (CAM16 + L* tone) — the SAME algorithm Material 3 uses to build tonal
 * palettes with perceptually-even tones and guaranteed-contrast pairings.
 *
 * WHY a port and not the npm package: @material/material-color-utilities ships
 * ESM-only ("type":"module"), which fights our CommonJS build + ts-jest harness
 * (CLAUDE.md: the API must `require()` workspace packages). Porting the minimal
 * math keeps this package zero-runtime-dependency and avoids lockfile churn,
 * while remaining a *correct* HCT implementation (NOT a naive HSL ramp — the
 * plan critique was explicit about this).
 *
 * The port follows the public-domain Apache-2.0 reference implementation
 * (github.com/material-foundation/material-color-utilities). Only the pieces
 * required for `Hct.from(hue, chroma, tone)` ↔ `Hct.fromInt(argb)` and
 * `TonalPalette.tone(t)` are included.
 */

/* eslint-disable @typescript-eslint/no-non-null-assertion */

// ---------------------------------------------------------------------------
// color_utils — sRGB <-> XYZ <-> Lab, and L* <-> Y.
// ---------------------------------------------------------------------------

const SRGB_TO_XYZ = [
  [0.41233895, 0.35762064, 0.18051042],
  [0.2126, 0.7152, 0.0722],
  [0.01932141, 0.11916382, 0.95034478],
];

const XYZ_TO_SRGB = [
  [3.2413774792388685, -1.5376652402851851, -0.49885366846268053],
  [-0.9691452513005321, 1.8758853451067872, 0.04156585616912061],
  [0.05562093689691305, -0.20395524564742123, 1.0571799111220335],
];

const WHITE_POINT_D65 = [95.047, 100.0, 108.883];

function clampInt(min: number, max: number, n: number): number {
  return n < min ? min : n > max ? max : n;
}

function argbFromRgb(r: number, g: number, b: number): number {
  return (
    (255 << 24) |
    ((r & 255) << 16) |
    ((g & 255) << 8) |
    (b & 255)
  ) >>> 0;
}

function redFromArgb(argb: number): number {
  return (argb >> 16) & 255;
}
function greenFromArgb(argb: number): number {
  return (argb >> 8) & 255;
}
function blueFromArgb(argb: number): number {
  return argb & 255;
}

function linearized(rgbComponent: number): number {
  const normalized = rgbComponent / 255.0;
  if (normalized <= 0.040449936) {
    return (normalized / 12.92) * 100.0;
  }
  return Math.pow((normalized + 0.055) / 1.055, 2.4) * 100.0;
}

function delinearized(rgbComponent: number): number {
  const normalized = rgbComponent / 100.0;
  let delin: number;
  if (normalized <= 0.0031308) {
    delin = normalized * 12.92;
  } else {
    delin = 1.055 * Math.pow(normalized, 1.0 / 2.4) - 0.055;
  }
  return clampInt(0, 255, Math.round(delin * 255.0));
}

function argbFromLinrgb(linrgb: number[]): number {
  const r = delinearized(linrgb[0]!);
  const g = delinearized(linrgb[1]!);
  const b = delinearized(linrgb[2]!);
  return argbFromRgb(r, g, b);
}

function yFromLstar(lstar: number): number {
  return 100.0 * labInvf((lstar + 16.0) / 116.0);
}

function lstarFromY(y: number): number {
  return labF(y / 100.0) * 116.0 - 16.0;
}

function labF(t: number): number {
  const e = 216.0 / 24389.0;
  const kappa = 24389.0 / 27.0;
  if (t > e) {
    return Math.pow(t, 1.0 / 3.0);
  }
  return (kappa * t + 16) / 116;
}

function labInvf(ft: number): number {
  const e = 216.0 / 24389.0;
  const kappa = 24389.0 / 27.0;
  const ft3 = ft * ft * ft;
  if (ft3 > e) {
    return ft3;
  }
  return (116 * ft - 16) / kappa;
}

function whitePointD65(): number[] {
  return WHITE_POINT_D65;
}

function matrixMultiply(row: number[], matrix: number[][]): number[] {
  const a = row[0]! * matrix[0]![0]! + row[1]! * matrix[0]![1]! + row[2]! * matrix[0]![2]!;
  const b = row[0]! * matrix[1]![0]! + row[1]! * matrix[1]![1]! + row[2]! * matrix[1]![2]!;
  const c = row[0]! * matrix[2]![0]! + row[1]! * matrix[2]![1]! + row[2]! * matrix[2]![2]!;
  return [a, b, c];
}

// ---------------------------------------------------------------------------
// math_utils
// ---------------------------------------------------------------------------

function signum(num: number): number {
  return num < 0 ? -1 : num === 0 ? 0 : 1;
}

function sanitizeDegreesDouble(degrees: number): number {
  degrees = degrees % 360.0;
  if (degrees < 0) {
    degrees = degrees + 360.0;
  }
  return degrees;
}

function sanitizeDegreesInt(degrees: number): number {
  degrees = degrees % 360;
  if (degrees < 0) {
    degrees = degrees + 360;
  }
  return degrees;
}

function toDegrees(radians: number): number {
  return (radians * 180.0) / Math.PI;
}
function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180.0;
}

// ---------------------------------------------------------------------------
// ViewingConditions (default sRGB)
// ---------------------------------------------------------------------------

class ViewingConditions {
  static make(
    whitePoint = whitePointD65(),
    adaptingLuminance = (200.0 / Math.PI) * yFromLstar(50.0) / 100.0,
    backgroundLstar = 50.0,
    surround = 2.0,
    discountingIlluminant = false,
  ): ViewingConditions {
    const xyz = whitePoint;
    const rW = xyz[0]! * 0.401288 + xyz[1]! * 0.650173 + xyz[2]! * -0.051461;
    const gW = xyz[0]! * -0.250268 + xyz[1]! * 1.204414 + xyz[2]! * 0.045854;
    const bW = xyz[0]! * -0.002079 + xyz[1]! * 0.048952 + xyz[2]! * 0.953127;
    const f = 0.8 + surround / 10.0;
    const c =
      f >= 0.9
        ? lerp(0.59, 0.69, (f - 0.9) * 10.0)
        : lerp(0.525, 0.59, (f - 0.8) * 10.0);
    let d = discountingIlluminant
      ? 1.0
      : f * (1.0 - (1.0 / 3.6) * Math.exp((-adaptingLuminance - 42.0) / 92.0));
    d = d > 1.0 ? 1.0 : d < 0.0 ? 0.0 : d;
    const nc = f;
    const rgbD = [
      d * (100.0 / rW) + 1.0 - d,
      d * (100.0 / gW) + 1.0 - d,
      d * (100.0 / bW) + 1.0 - d,
    ];
    const k = 1.0 / (5.0 * adaptingLuminance + 1.0);
    const k4 = k * k * k * k;
    const k4F = 1.0 - k4;
    const fl = k4 * adaptingLuminance + 0.1 * k4F * k4F * Math.cbrt(5.0 * adaptingLuminance);
    const n = yFromLstar(backgroundLstar) / whitePoint[1]!;
    const z = 1.48 + Math.sqrt(n);
    const nbb = 0.725 / Math.pow(n, 0.2);
    const ncb = nbb;
    const rgbAFactors = [
      Math.pow((fl * rgbD[0]! * rW) / 100.0, 0.42),
      Math.pow((fl * rgbD[1]! * gW) / 100.0, 0.42),
      Math.pow((fl * rgbD[2]! * bW) / 100.0, 0.42),
    ];
    const rgbA = [
      (400.0 * rgbAFactors[0]!) / (rgbAFactors[0]! + 27.13),
      (400.0 * rgbAFactors[1]!) / (rgbAFactors[1]! + 27.13),
      (400.0 * rgbAFactors[2]!) / (rgbAFactors[2]! + 27.13),
    ];
    const aw = (2.0 * rgbA[0]! + rgbA[1]! + 0.05 * rgbA[2]!) * nbb;
    return new ViewingConditions(n, aw, nbb, ncb, c, nc, rgbD, fl, Math.pow(fl, 0.25), z);
  }

  constructor(
    public n: number,
    public aw: number,
    public nbb: number,
    public ncb: number,
    public c: number,
    public nc: number,
    public rgbD: number[],
    public fl: number,
    public flRoot: number,
    public z: number,
  ) {}

  static DEFAULT = ViewingConditions.make();
}

function lerp(start: number, stop: number, amount: number): number {
  return (1.0 - amount) * start + amount * stop;
}

// ---------------------------------------------------------------------------
// CAM16
// ---------------------------------------------------------------------------

class Cam16 {
  constructor(
    public hue: number,
    public chroma: number,
    public j: number,
    public q: number,
    public m: number,
    public s: number,
    public jstar: number,
    public astar: number,
    public bstar: number,
  ) {}

  static fromInt(argb: number): Cam16 {
    return Cam16.fromIntInViewingConditions(argb, ViewingConditions.DEFAULT);
  }

  static fromIntInViewingConditions(argb: number, viewingConditions: ViewingConditions): Cam16 {
    const red = (argb & 0x00ff0000) >> 16;
    const green = (argb & 0x0000ff00) >> 8;
    const blue = argb & 0x000000ff;
    const redL = linearized(red);
    const greenL = linearized(green);
    const blueL = linearized(blue);
    const x = 0.41233895 * redL + 0.35762064 * greenL + 0.18051042 * blueL;
    const y = 0.2126 * redL + 0.7152 * greenL + 0.0722 * blueL;
    const z = 0.01932141 * redL + 0.11916382 * greenL + 0.95034478 * blueL;
    const rC = 0.401288 * x + 0.650173 * y - 0.051461 * z;
    const gC = -0.250268 * x + 1.204414 * y + 0.045854 * z;
    const bC = -0.002079 * x + 0.048952 * y + 0.953127 * z;
    const rD = viewingConditions.rgbD[0]! * rC;
    const gD = viewingConditions.rgbD[1]! * gC;
    const bD = viewingConditions.rgbD[2]! * bC;
    const rAF = Math.pow((viewingConditions.fl * Math.abs(rD)) / 100.0, 0.42);
    const gAF = Math.pow((viewingConditions.fl * Math.abs(gD)) / 100.0, 0.42);
    const bAF = Math.pow((viewingConditions.fl * Math.abs(bD)) / 100.0, 0.42);
    const rA = (signum(rD) * 400.0 * rAF) / (rAF + 27.13);
    const gA = (signum(gD) * 400.0 * gAF) / (gAF + 27.13);
    const bA = (signum(bD) * 400.0 * bAF) / (bAF + 27.13);
    const a = (11.0 * rA + -12.0 * gA + bA) / 11.0;
    const b = (rA + gA - 2.0 * bA) / 9.0;
    const u = (20.0 * rA + 20.0 * gA + 21.0 * bA) / 20.0;
    const p2 = (40.0 * rA + 20.0 * gA + bA) / 20.0;
    const atan2 = Math.atan2(b, a);
    const atanDegrees = (atan2 * 180.0) / Math.PI;
    const hue =
      atanDegrees < 0
        ? atanDegrees + 360.0
        : atanDegrees >= 360
          ? atanDegrees - 360.0
          : atanDegrees;
    const hueRadians = (hue * Math.PI) / 180.0;
    const ac = p2 * viewingConditions.nbb;
    const j = 100.0 * Math.pow(ac / viewingConditions.aw, viewingConditions.c * viewingConditions.z);
    const q =
      (4.0 / viewingConditions.c) *
      Math.sqrt(j / 100.0) *
      (viewingConditions.aw + 4.0) *
      viewingConditions.flRoot;
    const huePrime = hue < 20.14 ? hue + 360 : hue;
    const eHue = 0.25 * (Math.cos((huePrime * Math.PI) / 180.0 + 2.0) + 3.8);
    const p1 = (50000.0 / 13.0) * eHue * viewingConditions.nc * viewingConditions.ncb;
    const t = (p1 * Math.sqrt(a * a + b * b)) / (u + 0.305);
    const alpha =
      Math.pow(t, 0.9) * Math.pow(1.64 - Math.pow(0.29, viewingConditions.n), 0.73);
    const c = alpha * Math.sqrt(j / 100.0);
    const m = c * viewingConditions.flRoot;
    const s =
      50.0 * Math.sqrt((alpha * viewingConditions.c) / (viewingConditions.aw + 4.0));
    const jstar = ((1.0 + 100.0 * 0.007) * j) / (1.0 + 0.007 * j);
    const mstar = (1.0 / 0.0228) * Math.log(1.0 + 0.0228 * m);
    const astar = mstar * Math.cos(hueRadians);
    const bstar = mstar * Math.sin(hueRadians);
    return new Cam16(hue, c, j, q, m, s, jstar, astar, bstar);
  }

  static fromJch(j: number, c: number, h: number): Cam16 {
    return Cam16.fromJchInViewingConditions(j, c, h, ViewingConditions.DEFAULT);
  }

  static fromJchInViewingConditions(
    j: number,
    c: number,
    h: number,
    viewingConditions: ViewingConditions,
  ): Cam16 {
    const q =
      (4.0 / viewingConditions.c) *
      Math.sqrt(j / 100.0) *
      (viewingConditions.aw + 4.0) *
      viewingConditions.flRoot;
    const m = c * viewingConditions.flRoot;
    const alpha = c / Math.sqrt(j / 100.0);
    const s =
      50.0 * Math.sqrt((alpha * viewingConditions.c) / (viewingConditions.aw + 4.0));
    const hueRadians = (h * Math.PI) / 180.0;
    const jstar = ((1.0 + 100.0 * 0.007) * j) / (1.0 + 0.007 * j);
    const mstar = (1.0 / 0.0228) * Math.log(1.0 + 0.0228 * m);
    const astar = mstar * Math.cos(hueRadians);
    const bstar = mstar * Math.sin(hueRadians);
    return new Cam16(h, c, j, q, m, s, jstar, astar, bstar);
  }

  viewed(viewingConditions: ViewingConditions): number {
    const alpha =
      this.chroma === 0.0 || this.j === 0.0
        ? 0.0
        : this.chroma / Math.sqrt(this.j / 100.0);
    const t = Math.pow(
      alpha / Math.pow(1.64 - Math.pow(0.29, viewingConditions.n), 0.73),
      1.0 / 0.9,
    );
    const hRad = (this.hue * Math.PI) / 180.0;
    const eHue = 0.25 * (Math.cos(hRad + 2.0) + 3.8);
    const ac =
      viewingConditions.aw *
      Math.pow(this.j / 100.0, 1.0 / viewingConditions.c / viewingConditions.z);
    const p1 = eHue * (50000.0 / 13.0) * viewingConditions.nc * viewingConditions.ncb;
    const p2 = ac / viewingConditions.nbb;
    const hSin = Math.sin(hRad);
    const hCos = Math.cos(hRad);
    const gamma =
      (23.0 * (p2 + 0.305) * t) /
      (23.0 * p1 + 11.0 * t * hCos + 108.0 * t * hSin);
    const a = gamma * hCos;
    const b = gamma * hSin;
    const rA = (460.0 * p2 + 451.0 * a + 288.0 * b) / 1403.0;
    const gA = (460.0 * p2 - 891.0 * a - 261.0 * b) / 1403.0;
    const bA = (460.0 * p2 - 220.0 * a - 6300.0 * b) / 1403.0;
    const rCBase = Math.max(0, (27.13 * Math.abs(rA)) / (400.0 - Math.abs(rA)));
    const rC =
      signum(rA) * (100.0 / viewingConditions.fl) * Math.pow(rCBase, 1.0 / 0.42);
    const gCBase = Math.max(0, (27.13 * Math.abs(gA)) / (400.0 - Math.abs(gA)));
    const gC =
      signum(gA) * (100.0 / viewingConditions.fl) * Math.pow(gCBase, 1.0 / 0.42);
    const bCBase = Math.max(0, (27.13 * Math.abs(bA)) / (400.0 - Math.abs(bA)));
    const bC =
      signum(bA) * (100.0 / viewingConditions.fl) * Math.pow(bCBase, 1.0 / 0.42);
    const rF = rC / viewingConditions.rgbD[0]!;
    const gF = gC / viewingConditions.rgbD[1]!;
    const bF = bC / viewingConditions.rgbD[2]!;
    const x = 1.86206786 * rF - 1.01125463 * gF + 0.14918677 * bF;
    const y = 0.38752654 * rF + 0.62144744 * gF - 0.00897398 * bF;
    const z = -0.0158415 * rF - 0.03412294 * gF + 1.04996444 * bF;
    const rL = 3.2413774792388685 * x - 1.5376652402851851 * y - 0.49885366846268053 * z;
    const gL = -0.9691452513005321 * x + 1.8758853451067872 * y + 0.04156585616912061 * z;
    const bL = 0.05562093689691305 * x - 0.20395524564742123 * y + 1.0571799111220335 * z;
    const red = delinearized(rL);
    const green = delinearized(gL);
    const blue = delinearized(bL);
    return argbFromRgb(red, green, blue);
  }
}

// ---------------------------------------------------------------------------
// HctSolver — the perceptually-accurate gamut mapping (find an sRGB color with
// the requested hue+chroma+tone, reducing chroma only as far as needed).
// ---------------------------------------------------------------------------

const SCALED_DISCOUNT_FROM_LINRGB = [
  [0.001200833568784504, 0.002389694492170889, 0.0002795742885861124],
  [0.0005891086651375999, 0.0029785502573438758, 0.0003270666104008398],
  [0.00010146692491640572, 0.0005364214359186694, 0.0032979401770712076],
];

const LINRGB_FROM_SCALED_DISCOUNT = [
  [1373.2198709594231, -1100.4251190754821, -7.278681089101213],
  [-271.815969077903, 559.6580465940733, -32.46047482791194],
  [1.9622899599665666, -57.173814538844006, 308.7233197812385],
];

const Y_FROM_LINRGB = [0.2126, 0.7152, 0.0722];

const CRITICAL_PLANES = [
  0.015176349177441876, 0.045529047532325624, 0.07588174588720938, 0.10623444424209313, 0.13658714259697685, 0.16693984095186062,
  0.19729253930674434, 0.2276452376616281, 0.2579979360165119, 0.28835063437139563, 0.3188300904430532, 0.350925934958123,
  0.3848314933096426, 0.42057480301049466, 0.458183274052838, 0.4976837250274023, 0.5391024159806381, 0.5824650784040898,
  0.6277969426914107, 0.6751227633498623, 0.7244668422128921, 0.775853049866786, 0.829304845476233, 0.8848452951698498,
  0.942497089126609, 1.0022825574869039, 1.0642236851973577, 1.1283421258858297, 1.1946592148522128, 1.2631959812511864,
  1.3339731595349034, 1.407011200216447, 1.4823302800086415, 1.5599503113873272, 1.6398909516233677, 1.7221716113234105,
  1.8068114625156377, 1.8938294463134073, 1.9832442801866852, 2.075074464868551, 2.1693382909216234, 2.2660538449872063,
  2.36523901573795, 2.4669114995532007, 2.5710888059345764, 2.6777882626779785, 2.7870270208169257, 2.898822059350997,
  3.0131901897720907, 3.1301480604002863, 3.2497121605402226, 3.3718988244681087, 3.4967242352587946, 3.624204428461639,
  3.754355295633311, 3.887192587735158, 4.022731918402185, 4.160988767090289, 4.301978482107941, 4.445716283538092,
  4.592217266055746, 4.741496401646282, 4.893568542229298, 5.048448422192488, 5.20615066083972, 5.3666897647573375,
  5.5300801301023865, 5.696336044816294, 5.865471690767354, 6.037501145825082, 6.212438385869475, 6.390297286737924,
  6.571091626112461, 6.7548350853498045, 6.941541251256611, 7.131223617812143, 7.323895587840543, 7.5195704746346665,
  7.7182615035334345, 7.919981813454504, 8.124744458384042, 8.332562408825165, 8.543448553206703, 8.757415699253682,
  8.974476575321063, 9.194643831691977, 9.417930041841839, 9.644347703669503, 9.873909240696694, 10.106627003236781,
  10.342513269534024, 10.58158024687427, 10.8238400726681, 11.069304815507364, 11.317986476196008, 11.569896988756009,
  11.825048221409341, 12.083451977536606, 12.345119996613247, 12.610063955123938, 12.878295467455942, 13.149826086772048,
  13.42466730586372, 13.702830557985108, 13.984327217668513, 14.269168601521828, 14.55736596900856, 14.848930523210871,
  15.143873411576273, 15.44220572664832, 15.743938506781891, 16.04908273684337, 16.35764934889634, 16.66964922287304,
  16.985093187232053, 17.30399201960269, 17.62635644741625, 17.95219714852476, 18.281524751807332, 18.614349837764564,
  18.95068293910138, 19.290534541298456, 19.633915083172692, 19.98083495742689, 20.331304511189067, 20.685334046541502,
  21.042933821039977, 21.404114048223256, 21.76888489811322, 22.137256497705877, 22.50923893145328, 22.884842241736916,
  23.264076429332462, 23.6469514538663, 24.033477234264016, 24.42366364919083, 24.817520537484558, 25.21505769858089,
  25.61628489293138, 26.021211842414342, 26.429848230738664, 26.842203703840827, 27.258287870275353, 27.678110301598522,
  28.10168053274597, 28.529008062403893, 28.96010235337422, 29.39497283293396, 29.83362889318845, 30.276079891419332,
  30.722335150426627, 31.172403958865512, 31.62629557157785, 32.08401920991837, 32.54558406207592, 33.010999283389665,
  33.4802739966603, 33.953417292456834, 34.430438229418264, 34.911345834551085, 35.39614910352207, 35.88485700094671,
  36.37747846067349, 36.87402238606382, 37.37449765026789, 37.87891309649659, 38.38727753828926, 38.89959975977785,
  39.41588851594697, 39.93615253289054, 40.460400508064545, 40.98864111053629, 41.520882981230194, 42.05713473317016,
  42.597404951718396, 43.141702194811224, 43.6900349931913, 44.24241185063697, 44.798841244188324, 45.35933162437017,
  45.92389141541209, 46.49252901546552, 47.065252796817916, 47.64207110610409, 48.22299226451468, 48.808024568002054,
  49.3971762874833, 49.9904556690408, 50.587870934119984, 51.189430279724725, 51.79514187861014, 52.40501387947288,
  53.0190544071392, 53.637271562750364, 54.259673423945976, 54.88626804504493, 55.517063457223934, 56.15206766869424,
  56.79128866487574, 57.43473440856916, 58.08241284012621, 58.734331877617365, 59.39049941699807, 60.05092333227251,
  60.715611475655585, 61.38457167773311, 62.057811747619894, 62.7353394731159, 63.417162620860914, 64.10328893648692,
  64.79372614476921, 65.48848194977529, 66.18756403501224, 66.89098006357258, 67.59873767827808, 68.31084450182222,
  69.02730813691093, 69.74813616640164, 70.47333615344107, 71.20291564160104, 71.93688215501312, 72.67524319850172,
  73.41800625771542, 74.16517879925733, 74.9167682708136, 75.67278210128072, 76.43322770089146, 77.1981124613393,
  77.96744375590167, 78.74122893956174, 79.51947534912904, 80.30219030335869, 81.08938110306934, 81.88105503125999,
  82.67721935322541, 83.4778813166706, 84.28304815182372, 85.09272707154808, 85.90692527145302, 86.72564993000343,
  87.54890820862819, 88.3767072518277, 89.2090541872801, 90.04595612594655, 90.88742016217518, 91.73345337380438,
  92.58406282226491, 93.43925555268066, 94.29903859396902, 95.16341895893969, 96.03240364439274, 96.9059996312159,
  97.78421388448044, 98.6670533535366, 99.55452497210776,
];

function sanitizeRadians(angle: number): number {
  return (angle + Math.PI * 8) % (Math.PI * 2);
}

function trueDelinearized(rgbComponent: number): number {
  const normalized = rgbComponent / 100.0;
  let delin = 0.0;
  if (normalized <= 0.0031308) {
    delin = normalized * 12.92;
  } else {
    delin = 1.055 * Math.pow(normalized, 1.0 / 2.4) - 0.055;
  }
  return delin * 255.0;
}

function chromaticAdaptation(component: number): number {
  const af = Math.pow(Math.abs(component), 0.42);
  return (signum(component) * 400.0 * af) / (af + 27.13);
}

function hueOf(linrgb: number[]): number {
  const scaledDiscount = matrixMultiply(linrgb, SCALED_DISCOUNT_FROM_LINRGB);
  const rA = chromaticAdaptation(scaledDiscount[0]!);
  const gA = chromaticAdaptation(scaledDiscount[1]!);
  const bA = chromaticAdaptation(scaledDiscount[2]!);
  const a = (11.0 * rA + -12.0 * gA + bA) / 11.0;
  const b = (rA + gA - 2.0 * bA) / 9.0;
  return Math.atan2(b, a);
}

function areInCyclicOrder(a: number, b: number, c: number): boolean {
  const deltaAB = sanitizeRadians(b - a);
  const deltaAC = sanitizeRadians(c - a);
  return deltaAB < deltaAC;
}

function intercept(source: number, mid: number, target: number): number {
  return (mid - source) / (target - source);
}

function lerpPoint(source: number[], t: number, target: number[]): number[] {
  return [
    source[0]! + (target[0]! - source[0]!) * t,
    source[1]! + (target[1]! - source[1]!) * t,
    source[2]! + (target[2]! - source[2]!) * t,
  ];
}

function setCoordinate(source: number[], coordinate: number, target: number[], axis: number): number[] {
  const t = intercept(source[axis]!, coordinate, target[axis]!);
  return lerpPoint(source, t, target);
}

function isBounded(x: number): boolean {
  return 0.0 <= x && x <= 100.0;
}

function nthVertex(y: number, n: number): number[] {
  const kR = Y_FROM_LINRGB[0]!;
  const kG = Y_FROM_LINRGB[1]!;
  const kB = Y_FROM_LINRGB[2]!;
  const coordA = n % 4 <= 1 ? 0.0 : 100.0;
  const coordB = n % 2 === 0 ? 0.0 : 100.0;
  if (n < 4) {
    const g = coordA;
    const b = coordB;
    const r = (y - g * kG - b * kB) / kR;
    if (isBounded(r)) {
      return [r, g, b];
    } else {
      return [-1.0, -1.0, -1.0];
    }
  } else if (n < 8) {
    const b = coordA;
    const r = coordB;
    const g = (y - r * kR - b * kB) / kG;
    if (isBounded(g)) {
      return [r, g, b];
    } else {
      return [-1.0, -1.0, -1.0];
    }
  } else {
    const r = coordA;
    const g = coordB;
    const b = (y - r * kR - g * kG) / kB;
    if (isBounded(b)) {
      return [r, g, b];
    } else {
      return [-1.0, -1.0, -1.0];
    }
  }
}

function bisectToSegment(y: number, targetHue: number): number[][] {
  let left = [-1.0, -1.0, -1.0];
  let right = left;
  let leftHue = 0.0;
  let rightHue = 0.0;
  let initialized = false;
  let uncut = true;
  for (let n = 0; n < 12; n++) {
    const mid = nthVertex(y, n);
    if (mid[0]! < 0) {
      continue;
    }
    const midHue = hueOf(mid);
    if (!initialized) {
      left = mid;
      right = mid;
      leftHue = midHue;
      rightHue = midHue;
      initialized = true;
      continue;
    }
    if (uncut || areInCyclicOrder(leftHue, midHue, rightHue)) {
      uncut = false;
      if (areInCyclicOrder(leftHue, targetHue, midHue)) {
        right = mid;
        rightHue = midHue;
      } else {
        left = mid;
        leftHue = midHue;
      }
    }
  }
  return [left, right];
}

function midpoint(a: number[], b: number[]): number[] {
  return [(a[0]! + b[0]!) / 2, (a[1]! + b[1]!) / 2, (a[2]! + b[2]!) / 2];
}

function criticalPlaneBelow(x: number): number {
  return Math.floor(x - 0.5);
}
function criticalPlaneAbove(x: number): number {
  return Math.ceil(x - 0.5);
}

function bisectToLimit(y: number, targetHue: number): number {
  const segment = bisectToSegment(y, targetHue);
  let left = segment[0]!;
  let leftHue = hueOf(left);
  let right = segment[1]!;
  for (let axis = 0; axis < 3; axis++) {
    if (left[axis]! !== right[axis]!) {
      let lPlane = -1;
      let rPlane = 255;
      if (left[axis]! < right[axis]!) {
        lPlane = criticalPlaneBelow(trueDelinearized(left[axis]!));
        rPlane = criticalPlaneAbove(trueDelinearized(right[axis]!));
      } else {
        lPlane = criticalPlaneAbove(trueDelinearized(left[axis]!));
        rPlane = criticalPlaneBelow(trueDelinearized(right[axis]!));
      }
      for (let i = 0; i < 8; i++) {
        if (Math.abs(rPlane - lPlane) <= 1) {
          break;
        } else {
          const mPlane = Math.floor((lPlane + rPlane) / 2.0);
          const midPlaneCoordinate = CRITICAL_PLANES[mPlane]!;
          const mid = setCoordinate(left, midPlaneCoordinate, right, axis);
          const midHue = hueOf(mid);
          if (areInCyclicOrder(leftHue, targetHue, midHue)) {
            right = mid;
            rPlane = mPlane;
          } else {
            left = mid;
            leftHue = midHue;
            lPlane = mPlane;
          }
        }
      }
    }
  }
  return argbFromLinrgb(midpoint(left, right));
}

function inverseChromaticAdaptation(adapted: number): number {
  const adaptedAbs = Math.abs(adapted);
  const base = Math.max(0, (27.13 * adaptedAbs) / (400.0 - adaptedAbs));
  return signum(adapted) * Math.pow(base, 1.0 / 0.42);
}

function findResultByJ(hueRadians: number, chroma: number, y: number): number {
  let j = Math.sqrt(y) * 11.0;
  const viewingConditions = ViewingConditions.DEFAULT;
  const tInnerCoeff = 1 / Math.pow(1.64 - Math.pow(0.29, viewingConditions.n), 0.73);
  const eHue = 0.25 * (Math.cos(hueRadians + 2.0) + 3.8);
  const p1 = eHue * (50000.0 / 13.0) * viewingConditions.nc * viewingConditions.ncb;
  const hSin = Math.sin(hueRadians);
  const hCos = Math.cos(hueRadians);
  for (let iterationRound = 0; iterationRound < 5; iterationRound++) {
    const jNormalized = j / 100.0;
    const alpha = chroma === 0.0 || j === 0.0 ? 0.0 : chroma / Math.sqrt(jNormalized);
    const t = Math.pow(alpha * tInnerCoeff, 1.0 / 0.9);
    const ac =
      viewingConditions.aw *
      Math.pow(jNormalized, 1.0 / viewingConditions.c / viewingConditions.z);
    const p2 = ac / viewingConditions.nbb;
    const gamma = (23.0 * (p2 + 0.305) * t) / (23.0 * p1 + 11 * t * hCos + 108.0 * t * hSin);
    const a = gamma * hCos;
    const b = gamma * hSin;
    const rA = (460.0 * p2 + 451.0 * a + 288.0 * b) / 1403.0;
    const gA = (460.0 * p2 - 891.0 * a - 261.0 * b) / 1403.0;
    const bA = (460.0 * p2 - 220.0 * a - 6300.0 * b) / 1403.0;
    const rCScaled = inverseChromaticAdaptation(rA);
    const gCScaled = inverseChromaticAdaptation(gA);
    const bCScaled = inverseChromaticAdaptation(bA);
    const linrgb = matrixMultiply(
      [rCScaled, gCScaled, bCScaled],
      LINRGB_FROM_SCALED_DISCOUNT,
    );
    if (linrgb[0]! < 0 || linrgb[1]! < 0 || linrgb[2]! < 0) {
      return 0;
    }
    const kR = Y_FROM_LINRGB[0]!;
    const kG = Y_FROM_LINRGB[1]!;
    const kB = Y_FROM_LINRGB[2]!;
    const fnj = kR * linrgb[0]! + kG * linrgb[1]! + kB * linrgb[2]!;
    if (fnj <= 0) {
      return 0;
    }
    if (iterationRound === 4 || Math.abs(fnj - y) < 0.002) {
      if (linrgb[0]! > 100.01 || linrgb[1]! > 100.01 || linrgb[2]! > 100.01) {
        return 0;
      }
      return argbFromLinrgb(linrgb);
    }
    j = j - ((fnj - y) * j) / (2 * fnj);
  }
  return 0;
}

function solveToInt(hueDegrees: number, chroma: number, lstar: number): number {
  if (chroma < 0.0001 || lstar < 0.0001 || lstar > 99.9999) {
    return argbFromLstar(lstar);
  }
  hueDegrees = sanitizeDegreesDouble(hueDegrees);
  const hueRadians = (hueDegrees / 180) * Math.PI;
  const y = yFromLstar(lstar);
  const exactAnswer = findResultByJ(hueRadians, chroma, y);
  if (exactAnswer !== 0) {
    return exactAnswer;
  }
  const linrgb = bisectToLimit(y, hueRadians);
  return linrgb;
}

function argbFromLstar(lstar: number): number {
  const y = yFromLstar(lstar);
  const component = delinearized(y);
  return argbFromRgb(component, component, component);
}

// ---------------------------------------------------------------------------
// HCT — the public class.
// ---------------------------------------------------------------------------

export class Hct {
  private internalHue: number;
  private internalChroma: number;
  private internalTone: number;
  private argb: number;

  static from(hue: number, chroma: number, tone: number): Hct {
    const argb = solveToInt(hue, chroma, tone);
    return new Hct(argb);
  }

  static fromInt(argb: number): Hct {
    return new Hct(argb);
  }

  private constructor(argb: number) {
    this.argb = argb;
    const cam = Cam16.fromInt(argb);
    this.internalHue = cam.hue;
    this.internalChroma = cam.chroma;
    this.internalTone = lstarFromY(yFromArgb(argb));
  }

  toInt(): number {
    return this.argb;
  }

  get hue(): number {
    return this.internalHue;
  }
  get chroma(): number {
    return this.internalChroma;
  }
  get tone(): number {
    return this.internalTone;
  }
}

function yFromArgb(argb: number): number {
  const r = linearized(redFromArgb(argb));
  const g = linearized(greenFromArgb(argb));
  const b = linearized(blueFromArgb(argb));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

// ---------------------------------------------------------------------------
// Public helpers used by themes.ts
// ---------------------------------------------------------------------------

/** Parse #rrggbb to ARGB int. */
export function argbFromHex(hex: string): number {
  const h = hex.trim().replace(/^#/, '');
  const full =
    h.length === 3
      ? h
          .split('')
          .map((c) => c + c)
          .join('')
      : h;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) {
    throw new Error(`Invalid hex color: "${hex}"`);
  }
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return argbFromRgb(r, g, b);
}

/** Format an ARGB int to #rrggbb (ignores alpha). */
export function hexFromArgb(argb: number): string {
  const r = redFromArgb(argb).toString(16).padStart(2, '0');
  const g = greenFromArgb(argb).toString(16).padStart(2, '0');
  const b = blueFromArgb(argb).toString(16).padStart(2, '0');
  return `#${r}${g}${b}`;
}

/**
 * A Material-3 tonal palette: a fixed hue+chroma, sampled at any tone 0-100.
 * Tone 0 = black, tone 100 = white. The perceptual evenness of HCT tones is
 * what makes derived palettes look coherent (not muddy like an HSL ramp).
 */
export class TonalPalette {
  private cache = new Map<number, number>();

  private constructor(
    readonly hue: number,
    readonly chroma: number,
  ) {}

  /** Build a tonal palette from a seed hex, keeping its hue + chroma. */
  static fromHex(hex: string): TonalPalette {
    const hct = Hct.fromInt(argbFromHex(hex));
    return new TonalPalette(hct.hue, hct.chroma);
  }

  /** Build a tonal palette from an explicit hue + chroma. */
  static fromHueAndChroma(hue: number, chroma: number): TonalPalette {
    return new TonalPalette(hue, chroma);
  }

  /** The hex at a given tone (0-100). */
  tone(t: number): string {
    let argb = this.cache.get(t);
    if (argb === undefined) {
      argb = Hct.from(this.hue, this.chroma, t).toInt();
      this.cache.set(t, argb);
    }
    return hexFromArgb(argb);
  }

  /** The HCT object at a given tone. */
  getHct(t: number): Hct {
    return Hct.from(this.hue, this.chroma, t);
  }
}
