import { manifestMediaDims } from './screens.controller';

describe('manifestMediaDims', () => {
  it('reads processedDimensions', () => {
    expect(manifestMediaDims({ processedDimensions: { w: 1080, h: 1920 } })).toEqual({ media_w: 1080, media_h: 1920 });
    expect(manifestMediaDims(JSON.stringify({ processedDimensions: { w: 1672, h: 941 } }))).toEqual({ media_w: 1672, media_h: 941 });
  });
  it('omits the fields when unknown', () => {
    expect(manifestMediaDims(null)).toEqual({});
    expect(manifestMediaDims({ processedDimensions: { w: 0, h: 10 } })).toEqual({});
    expect(manifestMediaDims('not json')).toEqual({});
  });
});
