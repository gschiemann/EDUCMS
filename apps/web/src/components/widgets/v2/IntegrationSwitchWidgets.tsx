"use client";
/**
 * Registry entry points for the four board families that gained a real
 * provider (stocks, crypto, flights, scores). Each one picks the live board
 * when the zone is in automatic mode — and the live board itself falls back
 * to the original manual renderer whenever the deploy has no key for that
 * family — so a saved board renders exactly as before on a dormant deploy.
 */
import type { WidgetProps } from './_shared/types';
import { CryptoTickerWidget, SportsScoreboardWidget, StockTickerWidget } from './LiveDataWidgets';
import { DeparturesBoardWidget } from './TransitWidgets';
import {
  CryptoLiveWidget,
  FlightsLiveWidget,
  ScoresLiveWidget,
  StocksLiveWidget,
  isIntegrationAutomatic,
} from '../IntegrationDataWidgets';

/** Widget zone config — free-form JSON authored in the builder. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Cfg = Record<string, any>;

export function StockTickerSwitch(props: WidgetProps<Cfg>) {
  const manual = <StockTickerWidget {...props} />;
  return isIntegrationAutomatic('stock-ticker', props.config) ? <StocksLiveWidget config={props.config} fallback={manual} /> : manual;
}

export function CryptoTickerSwitch(props: WidgetProps<Cfg>) {
  const manual = <CryptoTickerWidget {...props} />;
  return isIntegrationAutomatic('crypto-ticker', props.config) ? <CryptoLiveWidget config={props.config} fallback={manual} /> : manual;
}

export function DeparturesBoardSwitch(props: WidgetProps<Cfg>) {
  const manual = <DeparturesBoardWidget {...props} />;
  return isIntegrationAutomatic('departures-board', props.config) ? <FlightsLiveWidget config={props.config} fallback={manual} /> : manual;
}

export function ScoresBoardSwitch(props: WidgetProps<Cfg>) {
  const manual = <SportsScoreboardWidget {...props} />;
  return isIntegrationAutomatic('sports-scoreboard', props.config) ? <ScoresLiveWidget config={props.config} fallback={manual} /> : manual;
}
