/**
 * K-12 launch lane A3 — the rules profile on the operator's screens and the
 * bonus / foul / timeout display on the public board (register rows K12-F01,
 * F04, F27). Mounted against the REAL profiles in @cms/api-types.
 */
import { render, screen, fireEvent, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  findRulesProfile,
  findSport,
  snapshotRules,
  sportForGame,
} from '@cms/api-types';
import { GameRulesCard, InningGameOverHint, RulesProfilePicker } from '../RulesProfile';
import { SituationalRow } from '../../widgets/v2/_shared/sports-situational';

function picker(sport: string, value = '') {
  const onChange = jest.fn();
  const onShotClockLen = jest.fn();
  render(
    <RulesProfilePicker
      sport={sport}
      value={value}
      onChange={onChange}
      shotClockLen={undefined}
      onShotClockLen={onShotClockLen}
    />,
  );
  return { onChange, onShotClockLen };
}

describe('RulesProfilePicker (New Game)', () => {
  it('basketball: NFHS by default, says what it was checked against, and asks about the state-option shot clock', () => {
    const { onShotClockLen } = picker('basketball');
    const select = screen.getByRole('combobox', { name: 'Rules for this game' });
    expect((select as HTMLSelectElement).value).toBe('nfhs-basketball@2026-27');
    expect(screen.getByRole('option', { name: 'NFHS · Varsity · 2026-27' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Classic scoreboard rules' })).toBeInTheDocument();
    expect(screen.getByTestId('rules-verification')).toHaveAttribute('data-verification', 'partial');
    const choice = screen.getByTestId('rules-shot-clock-choice');
    expect(within(choice).getByRole('button', { name: 'Off' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(within(choice).getByRole('button', { name: '35 seconds' }));
    expect(onShotClockLen).toHaveBeenCalledWith(35);
  });

  it('pickleball (no listed source): "rules not verified for this sport", said plainly', () => {
    picker('pickleball');
    expect(screen.getByTestId('rules-verification')).toHaveTextContent(
      'Rules not verified for this sport',
    );
    expect(screen.getByRole('option', { name: 'Local format · One game to 15' })).toBeInTheDocument();
    expect(screen.queryByTestId('rules-shot-clock-choice')).toBeNull();
  });

  it('lacrosse: boys 2027 (70 s option) first; girls 2027 names its possession clock', () => {
    const { onChange } = picker('lacrosse');
    expect(screen.getByRole('option', { name: 'NFHS · Boys · Varsity · 2027' })).toBeInTheDocument();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'nfhs-lacrosse-girls@2027' } });
    expect(onChange).toHaveBeenCalledWith('nfhs-lacrosse-girls@2027');
  });

  it('a girls lacrosse pick shows the possession clock choice', () => {
    picker('lacrosse', 'nfhs-lacrosse-girls@2027');
    const choice = screen.getByTestId('rules-shot-clock-choice');
    expect(choice).toHaveTextContent('Possession clock');
    expect(within(choice).getByRole('button', { name: '90 seconds' })).toBeInTheDocument();
  });
});

function withQuery(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe('GameRulesCard (console Setup)', () => {
  it('a game created before profiles says it runs the classic rules and can be switched before it starts', () => {
    withQuery(<GameRulesCard gameId="g1" game={{ sport: 'basketball', rules: null, status: 'SCHEDULED' }} />);
    const card = screen.getByTestId('game-rules-card');
    expect(card).toHaveTextContent('Classic scoreboard rules');
    expect(card).toHaveTextContent('created before rules profiles');
    expect(screen.getByRole('button', { name: 'Change the rules' })).toBeDisabled();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'nfhs-basketball@2026-27' } });
    expect(screen.getByRole('button', { name: 'Change the rules' })).toBeEnabled();
  });

  it('a live game shows its rules and that they are fixed', () => {
    const rules = snapshotRules(findRulesProfile('uil-volleyball-junior-high@2026-27')!);
    withQuery(<GameRulesCard gameId="g2" game={{ sport: 'volleyball', rules, status: 'LIVE' }} />);
    const card = screen.getByTestId('game-rules-card');
    expect(card).toHaveAttribute('data-rules-profile', 'uil-volleyball-junior-high@2026-27');
    expect(card).toHaveTextContent('UIL · Junior high · 2026-27');
    expect(card).toHaveTextContent('The rules are fixed once the game has started.');
    expect(screen.queryByRole('button', { name: 'Change the rules' })).toBeNull();
  });
});

describe('InningGameOverHint — K12-F20', () => {
  const nfhs = sportForGame({
    sport: 'baseball',
    rules: snapshotRules(findRulesProfile('nfhs-baseball@2027')!),
  });

  it('home leading in the bottom of the 7th: the game is over once the umpire calls it', () => {
    render(
      <InningGameOverHint
        def={nfhs}
        game={{ segment: 7, homeScore: 4, awayScore: 3, stats: { half: 'Bottom' } }}
      />,
    );
    expect(screen.getByTestId('inning-game-over-hint')).toHaveTextContent(
      'Home leads in the bottom of inning 7',
    );
  });

  it('no hint in the top half, before the 7th, or on a tie', () => {
    const { container } = render(
      <>
        <InningGameOverHint def={nfhs} game={{ segment: 7, homeScore: 4, awayScore: 3, stats: { half: 'Top' } }} />
        <InningGameOverHint def={nfhs} game={{ segment: 6, homeScore: 4, awayScore: 3, stats: { half: 'Bottom' } }} />
        <InningGameOverHint def={nfhs} game={{ segment: 7, homeScore: 3, awayScore: 3, stats: { half: 'Bottom' } }} />
      </>,
    );
    expect(container).toBeEmptyDOMElement();
  });
});

describe('Basketball situational row — K12-F04', () => {
  const nfhs = sportForGame({
    sport: 'basketball',
    rules: snapshotRules(findRulesProfile('nfhs-basketball@2026-27')!),
  })!;
  const row = (def: typeof nfhs, stats: Record<string, unknown>) =>
    render(
      <SituationalRow def={def} stats={stats} h={400} accent="#fbbf24" ink="#fff" dim="#64748b" hairline="transparent" />,
    );

  it('NFHS: the team whose OPPONENT has five fouls is in the bonus; fouls and timeouts are labelled numbers', () => {
    const { container } = row(nfhs, { homeFouls: 5, awayFouls: 2, homeTimeouts: 4, awayTimeouts: 5 });
    const text = container.textContent || '';
    expect(text.match(/BONUS/g)).toHaveLength(1);
    // Home's cluster renders first, away's (with the lamp) last.
    expect(text.indexOf('BONUS')).toBeGreaterThan(text.indexOf('POSS'));
    expect(text).toContain('FOULS 5');
    expect(text).toContain('TOL 4');
  });

  it('NFHS: four fouls is no bonus, and more than five shows as five (the display cap)', () => {
    const quiet = row(nfhs, { homeFouls: 4 });
    expect(quiet.container.textContent).not.toContain('BONUS');
    quiet.unmount();
    const capped = row(nfhs, { homeFouls: 7 });
    expect(capped.container.textContent).toContain('FOULS 5');
  });

  it('a classic game keeps its 7-foul lamp — now on the team that shoots', () => {
    const { container } = row(findSport('basketball')!, { homeFouls: 7, awayFouls: 0 });
    const text = container.textContent || '';
    expect(text.match(/BONUS/g)).toHaveLength(1);
    expect(text.indexOf('BONUS')).toBeGreaterThan(text.indexOf('POSS'));
  });
});
