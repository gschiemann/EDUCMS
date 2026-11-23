import { hasUnsavedWork, registerUnsavedWork } from '../unsaved-work';

describe('unsaved-work registry', () => {
  it('is clean with nothing registered', () => {
    expect(hasUnsavedWork()).toBe(false);
  });

  it('is dirty while any registered check is dirty', () => {
    let a = false;
    let b = false;
    const offA = registerUnsavedWork(() => a);
    const offB = registerUnsavedWork(() => b);
    expect(hasUnsavedWork()).toBe(false);
    b = true;
    expect(hasUnsavedWork()).toBe(true);
    offB();
    expect(hasUnsavedWork()).toBe(false);
    a = true;
    expect(hasUnsavedWork()).toBe(true);
    offA();
    expect(hasUnsavedWork()).toBe(false);
  });

  it('treats a check that throws as dirty (unknown is not clean)', () => {
    const off = registerUnsavedWork(() => { throw new Error('unreadable'); });
    expect(hasUnsavedWork()).toBe(true);
    off();
    expect(hasUnsavedWork()).toBe(false);
  });

  it('the same function registered twice unregisters independently', () => {
    const check = () => true;
    const off1 = registerUnsavedWork(check);
    const off2 = registerUnsavedWork(check);
    off1();
    expect(hasUnsavedWork()).toBe(true);
    off2();
    expect(hasUnsavedWork()).toBe(false);
  });
});
