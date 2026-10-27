import { act, render, screen, waitFor } from '@testing-library/react';
import { HeadlinesWidget, mixHeadlines } from '../HeadlinesWidget';
import { ForecastWeatherWidget } from '../ForecastWeatherWidget';
import { RenderSurfaceProvider } from '../render-surface';
const fetchOriginal = global.fetch;
const story = (title: string, link: string, source = 'News') => ({ title, link, source, publishedAt: new Date().toISOString(), author: 'Original Author' });
beforeEach(() => { global.ResizeObserver = class { observe(){} disconnect(){} unobserve(){} } as unknown as typeof ResizeObserver; });
afterEach(() => { global.fetch = fetchOriginal; jest.useRealTimers(); });
it('mixes sources evenly, deduplicates, drops stale/unsafe items and retains required author credit', () => {
  const one = story('World','https://example.org/world'); const two = story('Space','https://example.org/space');
  const items = mixHeadlines([{ sourceId:'global-voices',items:[one,{...one,link:'https://example.org/missing-author',author:''}] },{ sourceId:'nasa',items:[two,one,{...two,link:'javascript:bad'},{...two,link:'https://example.org/old',publishedAt:'2000-01-01'}] }]);
  expect(items.map(i=>i.title)).toEqual(['World','Space']);
});
it('only fetches selected sources, rotates attributed headlines and immediately clears deselected sources', async () => {
  jest.useFakeTimers();
  global.fetch = jest.fn(async (url) => ({ ok:true,json:async()=>({title:'News',items:[story(String(url).includes('globalvoices')?'World story':'Space story',String(url).includes('globalvoices')?'https://globalvoices.org/world':'https://www.nasa.gov/space')]}) })) as unknown as typeof fetch;
  const view = render(<HeadlinesWidget config={{ sources:['global-voices','nasa'],intervalSec:5 }} />);
  await waitFor(()=>expect(screen.getByText('World story')).toBeInTheDocument()); expect(screen.getByText(/Original Author/)).toBeInTheDocument(); expect(screen.getByText(/CC BY 3.0/)).toBeInTheDocument();
  act(()=>jest.advanceTimersByTime(5000)); expect(screen.getByText('Space story')).toBeInTheDocument();
  view.rerender(<HeadlinesWidget config={{ sources:[],intervalSec:5 }} />);
  await waitFor(()=>expect(screen.getByText('Select news sources in Properties')).toBeInTheDocument()); expect(screen.queryByText('Space story')).not.toBeInTheDocument();
});
it('changes a configured feed immediately instead of retaining the previous URL until a reload', async () => {
  global.fetch = jest.fn(async (url) => ({ok:true,json:async()=>({title:'News',items:[story(String(url).includes('first')?'First feed':'Second feed','https://example.org/story')]})})) as unknown as typeof fetch;
  const view = render(<HeadlinesWidget config={{sources:[],feedUrl:'https://example.org/first'}} />); await waitFor(()=>expect(screen.getByText('First feed')).toBeInTheDocument());
  view.rerender(<HeadlinesWidget config={{sources:[],feedUrl:'https://example.org/second'}} />); await waitFor(()=>expect(screen.getByText('Second feed')).toBeInTheDocument()); expect(screen.queryByText('First feed')).not.toBeInTheDocument();
});
it('never shows fabricated forecast values on a player when no location is set', () => {
  render(<RenderSurfaceProvider surface="player"><ForecastWeatherWidget config={{forecastDays:5}} /></RenderSurfaceProvider>);
  expect(screen.getByText('Set a U.S. city or ZIP code')).toBeInTheDocument(); expect(document.querySelectorAll('[data-forecast-day]')).toHaveLength(0); expect(screen.queryByText('SAMPLE')).not.toBeInTheDocument();
});
it('shows exactly the selected number of actual forecast days and preserves a missing low', async () => {
  global.fetch = jest.fn(async()=>({ok:true,json:async()=>({location:'Honolulu, HI',days:Array.from({length:5},(_,i)=>({date:`2026-10-${20+i}`,high:80+i,low:i===0?null:65,condition:'Sunny',rain:10})),fetchedAt:new Date().toISOString(),source:'National Weather Service',geocoded:false})})) as unknown as typeof fetch;
  const view = render(<ForecastWeatherWidget config={{location:'21,-157',forecastDays:2}}/>); await waitFor(()=>expect(screen.getByText('Honolulu, HI')).toBeInTheDocument()); expect(document.querySelectorAll('[data-forecast-day]')).toHaveLength(2); expect(screen.getByText('—')).toBeInTheDocument();
  view.rerender(<ForecastWeatherWidget config={{location:'21,-157',forecastDays:5}}/>); expect(document.querySelectorAll('[data-forecast-day]')).toHaveLength(5);
});
