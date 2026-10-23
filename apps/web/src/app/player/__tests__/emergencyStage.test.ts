import { chooseEmergencyStage } from '../emergencyStage';

describe('each face owns its emergency stage', () => {
  it.each([
    ['landscape main', 1920, 1080, 'landscape'],
    ['portrait main', 1080, 1920, 'portrait'],
    ['landscape secondary beside portrait main', 1920, 1080, 'landscape'],
    ['portrait secondary beside landscape main', 1080, 1920, 'portrait'],
  ])('%s', (_name, width, height, orientation) => {
    expect(chooseEmergencyStage({ width: Number(width), height: Number(height) })).toEqual({ width, height, orientation });
  });
  it('uses the secondary face logical axes after its own CSS rotation', () => {
    expect(chooseEmergencyStage({ width: 960, height: 540 }, { rotated: true })).toEqual({ width: 540, height: 960, orientation: 'portrait' });
  });
  it('preserves an explicit LED canvas over framebuffer dimensions', () => {
    expect(chooseEmergencyStage({ width: 1920, height: 1080 }, { canvas: { width: 320, height: 1080 }, rotated: true })).toEqual({ width: 320, height: 1080, orientation: 'portrait' });
  });
  it('preserves the primary native pixel canvas on a high-density viewport', () => {
    expect(chooseEmergencyStage({ width: 720, height: 1280 }, { nativeDisplay: { width: 2160, height: 3840 } })).toEqual({ width: 2160, height: 3840, orientation: 'portrait' });
  });
});
