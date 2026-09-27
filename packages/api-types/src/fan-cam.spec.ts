import { fanCamTextIsSchoolSafe, unsafeFanCamTexts, FAN_CAM_VARIANT_ID } from './fan-cam';

describe('Fan Cam words where students are on screen', () => {
  it.each([
    'KISS CAM',
    'Kiss Cam',
    'kisscam',
    'KISS-CAM',
    'K.I.S.S. CAM',
    'K I S S  C A M',
    'K1SS CAM',
    'KI$$ CAM!',
    'KISSSSS CAM',
    'KISSING CAM',
    'SMOOCH CAM',
    'SMOOCH-O-METER',
    'LOVE CAM',
    'LOVECAM',
    'COUPLES CAM',
    'SWEETHEART CAMERA',
    'VALENTINE CAM',
    'CRUSH CAM',
    'MAKE OUT CAM',
    'PUCKER UP!',
    'XOXO CAM',
    'CÁMARA DEL BESO',
    'CÁMARA DE LOS BESOS',
    'BESO CAM',
    'CÁMARA DE PAREJAS',
    '接吻镜头',
    '亲亲镜头',
    'FAN CAM 💋',
    '😘 CAM',
  ])('%s is refused', (t) => {
    expect(fanCamTextIsSchoolSafe(t)).toBe(false);
  });

  it.each([
    'FAN CAM',
    'SPIRIT CAM',
    'DANCE CAM',
    'FLEX CAM',
    'SMILE CAM',
    'WAVE CAM',
    'STUDENT SECTION CAM',
    'SHOW SOME LOVE, EAGLES!',
    'KISSIMMEE FAN CAM',
    'FAN CAM DATE NIGHT? NO — GAME NIGHT',
    'CRUSH THE COMETS',
    'CÁMARA FAN',
    'CÁMARA DE BAILE',
    '球迷镜头',
    'PRESENTED BY THE PTA',
    '',
    '   ',
  ])('%s is fine', (t) => {
    expect(fanCamTextIsSchoolSafe(t)).toBe(true);
  });

  it('anything that is not text is fine (nothing is shown)', () => {
    expect(fanCamTextIsSchoolSafe(undefined)).toBe(true);
    expect(fanCamTextIsSchoolSafe(null)).toBe(true);
    expect(fanCamTextIsSchoolSafe(7)).toBe(true);
  });
});

describe('unsafeFanCamTexts', () => {
  it('finds the title and the sponsor line of Fan Cam zones only', () => {
    expect(
      unsafeFanCamTexts([
        { defaultConfig: { variant: FAN_CAM_VARIANT_ID, kind: 'KISS CAM', sponsor: 'PRESENTED BY THE PTA' } },
        { defaultConfig: { variant: FAN_CAM_VARIANT_ID, kind: 'SPIRIT CAM', sponsor: 'SMOOCH TIME' } },
        // Another widget may say whatever it says.
        { defaultConfig: { variant: 'ribbon-sponsor', kind: 'KISS CAM' } },
        { defaultConfig: null },
        {},
      ]),
    ).toEqual(['KISS CAM', 'SMOOCH TIME']);
  });

  it('reads the JSON string a version snapshot stores', () => {
    expect(unsafeFanCamTexts([{ defaultConfig: JSON.stringify({ variant: FAN_CAM_VARIANT_ID, kind: 'Kiss Cam' }) }])).toEqual([
      'Kiss Cam',
    ]);
    expect(unsafeFanCamTexts([{ defaultConfig: '{not json' }])).toEqual([]);
  });

  it('no zones, no problem', () => {
    expect(unsafeFanCamTexts(undefined)).toEqual([]);
    expect(unsafeFanCamTexts([])).toEqual([]);
  });
});
