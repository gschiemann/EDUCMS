import * as fs from 'fs';
import * as path from 'path';
import { act, render, screen, waitFor } from '@testing-library/react';
import { HolidayWidget } from '../HolidayWidget';
import {
  isHolidayStyleToggleActive,
  mergeHolidayTextStyleMaps,
  updateHolidayStyleToggle,
} from '../holiday-style-contract';

describe('HOLIDAY style config compatibility', () => {
  it('merges legacy __styles with canonical _styles property-by-property', () => {
    const legacy = {
      headline: { fontSize: 82, color: '#123456', italic: true },
      legacyOnly: { fontWeight: 700 },
    };
    const canonical = {
      headline: { fontSize: 96, textAlign: 'center' as const },
      canonicalOnly: { hidden: true },
    };

    expect(mergeHolidayTextStyleMaps(legacy, canonical)).toEqual({
      headline: {
        fontSize: 96,
        color: '#123456',
        italic: true,
        textAlign: 'center',
      },
      legacyOnly: { fontWeight: 700 },
      canonicalOnly: { hidden: true },
    });
    // Saving/rendering compatibility must not mutate a loaded config object.
    expect(legacy.headline.fontSize).toBe(82);
    expect(canonical.headline.fontSize).toBe(96);
  });

  it('lets canonical aliases replace conflicting legacy CSS-shaped keys', () => {
    expect(mergeHolidayTextStyleMaps(
      {
        headline: {
          fontWeight: 700,
          fontStyle: 'italic',
          textDecoration: 'underline line-through',
          visibility: 'hidden',
        },
      },
      {
        headline: {
          bold: false,
          italic: false,
          underline: false,
          strikethrough: true,
          hidden: false,
        },
      },
    )).toEqual({
      headline: {
        bold: false,
        italic: false,
        underline: false,
        strikethrough: true,
        hidden: false,
      },
    });
  });

  it('makes legacy formatting visible and removable through canonical toolbar toggles', () => {
    const legacy = {
      fontWeight: 700,
      fontStyle: 'italic' as const,
      textDecoration: 'underline line-through' as const,
      visibility: 'hidden' as const,
    };

    expect(isHolidayStyleToggleActive(legacy, 'bold')).toBe(true);
    expect(isHolidayStyleToggleActive(legacy, 'italic')).toBe(true);
    expect(isHolidayStyleToggleActive(legacy, 'underline')).toBe(true);
    expect(isHolidayStyleToggleActive(legacy, 'strikethrough')).toBe(true);
    expect(isHolidayStyleToggleActive(legacy, 'hidden')).toBe(true);

    const noBold = updateHolidayStyleToggle(legacy, 'bold', false);
    expect(noBold.fontWeight).toBeUndefined();
    expect(isHolidayStyleToggleActive(noBold, 'bold')).toBe(false);

    const noUnderline = updateHolidayStyleToggle(legacy, 'underline', false);
    expect(noUnderline.textDecoration).toBeUndefined();
    expect(noUnderline.underline).toBeUndefined();
    expect(noUnderline.strikethrough).toBe(true);
    expect(isHolidayStyleToggleActive(noUnderline, 'underline')).toBe(false);
    expect(isHolidayStyleToggleActive(noUnderline, 'strikethrough')).toBe(true);

    const visible = updateHolidayStyleToggle(legacy, 'hidden', false);
    expect(visible.visibility).toBeUndefined();
    expect(isHolidayStyleToggleActive(visible, 'hidden')).toBe(false);
  });

  it('HolidayWidget posts the merged canonical payload when the iframe becomes ready', async () => {
    const computedStyle = jest.spyOn(window, 'getComputedStyle').mockReturnValue({
      getPropertyValue: (name: string) => name === '--brand-primary' ? '#123456' : '#fedcba',
    } as CSSStyleDeclaration);
    try {
      render(
        <div data-zone-id="holiday-zone">
          <HolidayWidget
            config={{
              variant: 'halloween',
              gradeLevel: 'hs',
              __styles: { 'headline.t1': { color: '#112233', fontSize: 70 } },
              _styles: { 'headline.t1': { fontSize: 92, italic: true } },
            }}
          />
        </div>,
      );

      const iframe = screen.getByTitle('halloween hs holiday template') as HTMLIFrameElement;
      expect(iframe.contentWindow).toBeTruthy();
      const postMessage = jest.spyOn(iframe.contentWindow!, 'postMessage');

      act(() => {
        window.dispatchEvent(new MessageEvent('message', {
          origin: 'null',
          source: iframe.contentWindow,
          data: {
            type: 'holiday:ready',
            fields: [{ key: 'headline.t1', defaultText: 'Happy', multiline: false }],
          },
        }));
      });

      await waitFor(() => {
        expect(postMessage).toHaveBeenCalledWith({
          type: 'template-apply-brand-vars',
          vars: {
            '--brand-primary': '#123456',
            '--brand-accent': '#fedcba',
          },
        }, '*');
        expect(postMessage).toHaveBeenCalledWith({
          type: 'template-apply-styles',
          styles: {
            'headline.t1': {
              color: '#112233',
              fontSize: 92,
              italic: true,
            },
          },
        }, '*');
      });
    } finally {
      computedStyle.mockRestore();
    }
  });
});

describe('holiday iframe style bridge', () => {
  const bridgePath = path.resolve(
    __dirname,
    '../../../../public/holiday-templates/_style-bridge.js',
  );

  beforeEach(() => {
    document.head.innerHTML = '';
    document.body.innerHTML = '';
  });

  it('applies styles, brand vars, fonts, data-fit recovery, and live-field pinning', async () => {
    const headline = document.createElement('div');
    headline.setAttribute('data-field', 'headline');
    headline.style.color = 'rgb(1, 2, 3)';
    headline.style.fontWeight = '600';
    headline.style.display = 'inline-block';
    document.body.appendChild(headline);

    const explicit = document.createElement('div');
    explicit.setAttribute('data-field', 'explicit');
    document.body.appendChild(explicit);

    const fitted = document.createElement('div');
    fitted.setAttribute('data-field', 'fitted');
    fitted.setAttribute('data-fit', 'single');
    fitted.style.fontSize = '72px';
    document.body.appendChild(fitted);

    const live = document.createElement('div');
    live.setAttribute('data-field', 'clock.time');
    live.setAttribute('data-live', 'time');
    live.textContent = '10:14';
    document.body.appendChild(live);

    // Execute the exact browser asset; no copied test implementation.
    window.eval(fs.readFileSync(bridgePath, 'utf8'));

    window.dispatchEvent(new MessageEvent('message', {
      origin: 'null',
      data: {
        type: 'template-apply-brand-vars',
        vars: {
          '--brand-primary': '#123456',
          '--brand-accent': '#fedcba',
        },
      },
    }));

    window.dispatchEvent(new MessageEvent('message', {
      data: {
        type: 'template-apply-styles',
        styles: {
          headline: {
            fontFamily: 'Montserrat, sans-serif',
            fontSize: 88,
            color: '#ff0000',
            bold: true,
            italic: true,
            underline: true,
            strikethrough: true,
            textAlign: 'center',
            lineHeight: 1.6,
            backgroundColor: '#001122',
            hidden: true,
          },
          explicit: {
            fontWeight: 575,
            fontStyle: 'normal',
            textDecoration: 'underline',
            visibility: 'hidden',
          },
          fitted: { fontSize: 44 },
        },
      },
    }));

    expect(document.documentElement.style.getPropertyValue('--brand-primary')).toBe('#123456');
    expect(document.documentElement.style.getPropertyValue('--brand-accent')).toBe('#fedcba');
    expect(headline.style.fontFamily).toContain('Montserrat');
    const fontLink = document.querySelector<HTMLLinkElement>(
      'link[data-edu-holiday-font="Montserrat"]',
    );
    expect(fontLink?.href).toContain('family=Montserrat');
    expect(headline.style.fontSize).toBe('88px');
    expect(headline.style.color).toBe('rgb(255, 0, 0)');
    expect(headline.style.fontWeight).toBe('800');
    expect(headline.style.fontStyle).toBe('italic');
    expect(headline.style.textDecoration).toContain('underline');
    expect(headline.style.textDecoration).toContain('line-through');
    expect(headline.style.textAlign).toBe('center');
    expect(headline.style.lineHeight).toBe('1.6');
    expect(headline.style.backgroundColor).toBe('rgb(0, 17, 34)');
    expect(headline.style.display).toBe('none');
    expect(explicit.style.fontWeight).toBe('575');
    expect(explicit.style.fontStyle).toBe('normal');
    expect(explicit.style.textDecoration).toContain('underline');
    expect(explicit.style.visibility).toBe('hidden');
    expect(fitted.style.fontSize).toBe('44px');

    // A board auto-fit pass writes the style attribute after the saved style
    // arrives. The observer must capture that as the new authored fallback,
    // then reassert the saved override without recursively looping.
    fitted.style.fontSize = '63px';
    await waitFor(() => expect(fitted.style.fontSize).toBe('44px'));

    // Live clock/date widgets keep a manual value pinned even when their own
    // timer writes new text. Clearing the value restores the latest live text.
    window.dispatchEvent(new MessageEvent('message', {
      data: { type: 'holiday:setField', key: 'clock.time', value: 'MANUAL' },
    }));
    expect(live.getAttribute('data-pin')).toBe('1');
    expect(live.textContent).toBe('MANUAL');
    live.textContent = '10:15';
    await waitFor(() => expect(live.textContent).toBe('MANUAL'));
    window.dispatchEvent(new MessageEvent('message', {
      data: { type: 'holiday:setField', key: 'clock.time', value: '' },
    }));
    expect(live.hasAttribute('data-pin')).toBe(false);
    expect(live.textContent).toBe('10:15');

    window.dispatchEvent(new MessageEvent('message', {
      data: { type: 'template-apply-styles', styles: {} },
    }));

    expect(headline.style.color).toBe('rgb(1, 2, 3)');
    expect(headline.style.fontWeight).toBe('600');
    expect(headline.style.display).toBe('inline-block');
    expect(headline.style.fontFamily).toBe('');
    expect(headline.style.backgroundColor).toBe('');
    expect(explicit.style.visibility).toBe('');
    expect(fitted.style.fontSize).toBe('63px');
  });
});
