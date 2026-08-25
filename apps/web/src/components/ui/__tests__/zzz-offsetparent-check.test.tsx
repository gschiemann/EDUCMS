import { render } from '@testing-library/react';

test('offsetParent in jsdom', () => {
  const { container } = render(<div><button type="button">hi</button></div>);
  const btn = container.querySelector('button')!;
  // eslint-disable-next-line no-console
  console.log('offsetParent:', btn.offsetParent);
  // eslint-disable-next-line no-console
  console.log('offsetWidth:', btn.offsetWidth, 'offsetHeight:', btn.offsetHeight);
});
