/**
 * "Serial number" on a screen's settings → Device details (2026-11-16).
 * Every serial here is synthetic.
 */
import * as React from 'react';
import * as fs from 'fs';
import * as path from 'path';
import { render, screen as rtl } from '@testing-library/react';
import { HardwareSerialRow } from '../HardwareSerialRow';

describe('<HardwareSerialRow />', () => {
  it('shows the serial and where it was read from', () => {
    render(<HardwareSerialRow serial="TESTSERIAL0001" source="prop:ro.serialno" />);
    expect(rtl.getByText('Serial number')).toBeTruthy();
    expect(rtl.getByTestId('hardware-serial-value').textContent).toBe('TESTSERIAL0001');
    expect(rtl.getByTestId('hardware-serial-hint').textContent).toBe('Read from system property ro.serialno');
  });

  it('names the other sources in plain words', () => {
    const { rerender } = render(<HardwareSerialRow serial="TESTSERIAL0001" source="device-owner" />);
    expect(rtl.getByTestId('hardware-serial-hint').textContent).toBe('Read from device owner');
    rerender(<HardwareSerialRow serial="TESTSERIAL0001" source="build-serial" />);
    expect(rtl.getByTestId('hardware-serial-hint').textContent).toBe('Read from Android build info');
    rerender(<HardwareSerialRow serial="TESTSERIAL0001" source="something-new" />);
    expect(rtl.queryByTestId('hardware-serial-hint')).toBeNull();
  });

  it('"Not available" when the screen tried and Android would not say', () => {
    render(<HardwareSerialRow serial={null} source="none" />);
    expect(rtl.getByTestId('hardware-serial-value').textContent).toBe('Not available');
    expect(rtl.getByTestId('hardware-serial-hint').textContent).toMatch(/does not let apps read its serial number/);
  });

  it('"Not available" + "not reported yet" when nothing was ever reported', () => {
    render(<HardwareSerialRow />);
    expect(rtl.getByTestId('hardware-serial-value').textContent).toBe('Not available');
    expect(rtl.getByTestId('hardware-serial-hint').textContent).toMatch(/Not reported yet/);
  });

  it('is mounted in the settings Device details, beside the fingerprint', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'ScreenSettingsMenu.tsx'), 'utf8');
    const details = src.slice(src.indexOf('function DeviceDetails('), src.indexOf('function DeviceFingerprintRow('));
    expect(details).toContain('<HardwareSerialRow serial={screen?.hardwareSerial} source={screen?.hardwareSerialSource} />');
  });
});
