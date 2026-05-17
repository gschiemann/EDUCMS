import type { WidgetStyle } from './styleSystem';

export interface BaseCfg {
  /** Unified visual style (font, color, bg, padding, border, shadow, anim).
   *  Every v2 widget accepts this. Widget-specific fields live alongside. */
  style?: WidgetStyle;
}

export interface WidgetProps<C = BaseCfg> {
  config?: C;
  live?: boolean;
  width?: number;
  height?: number;
}

/** A "K-12 audience" tag stamped on every v2 widget so the editor can
 *  surface widgets appropriate to a school's level. */
export type SchoolLevel = 'elementary' | 'middle' | 'high' | 'universal' | 'admin';

export interface WidgetMeta {
  type: string;        // e.g. 'CLOCK_NEON'
  category: string;    // e.g. 'CLOCKS'
  label: string;       // e.g. 'Neon Clock'
  desc: string;        // short description
  level: SchoolLevel;
  defaults?: Record<string, unknown>;
  /** Business-line scope. When set, the widget appears only in that
   *  vertical's builder palette (e.g. 'SPORTS', 'HEALTHCARE'). Unset =
   *  universal — shown to every vertical. */
  vertical?: string;
}
