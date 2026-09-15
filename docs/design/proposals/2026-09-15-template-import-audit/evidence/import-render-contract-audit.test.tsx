import {render} from '@testing-library/react';
import {WidgetPreview} from '../WidgetRenderer';
import {buildTextStyleRules} from '../text-style-contract';

describe('Import renderer contract audit (component, not full builder)',()=>{
  it('imported plain text exposes the content hotspot',()=>{
    const {container}=render(<WidgetPreview widgetType="TEXT" config={{content:'Imported title',fontSize:59,bold:false,alignment:'left'}} width={25} height={25}/>);
    const text=container.querySelector('[data-field="content"]');
    expect(text?.textContent).toBe('Imported title');
  });
  it('non-bold imported text uses 600, not regular 400, in legacy renderer',()=>{
    const {container}=render(<WidgetPreview widgetType="TEXT" config={{content:'Regular source',fontSize:24,bold:false}} width={25} height={25}/>);
    expect((container.querySelector('[data-field="content"]') as HTMLElement).style.fontWeight).toBe('600');
  });
  it('default text wrapper adds padding and vertical centering',()=>{
    const {container}=render(<WidgetPreview widgetType="TEXT" config={{content:'Source',fontSize:24}} width={25} height={25}/>);
    const wrapper=container.querySelector('[data-field="content"]')?.parentElement;
    expect(wrapper?.classList.contains('p-[5%]')).toBe(true);
    expect(wrapper?.classList.contains('items-center')).toBe(true);
  });
  it('shared builder/player style rules preserve explicit imported pixel size (negative control)',()=>{
    const rules=buildTextStyleRules({fontSize:59,bold:false});
    expect(rules).toContain('font-size: 59px !important');
    expect(rules.some(r=>r.startsWith('font-weight'))).toBe(false);
  });
  it('PPT fallback URL is passed to a literal image element, not converted',()=>{
    const {container}=render(<WidgetPreview widgetType="IMAGE" config={{assetUrl:'https://example.test/original.ppt',fit:'contain'}} width={100} height={100}/>);
    expect(container.querySelector('img')?.getAttribute('src')).toContain('original.ppt');
  });
});
