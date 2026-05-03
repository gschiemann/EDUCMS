"use client";
/**
 * WidgetErrorBoundary — isolates a single widget's render error so a
 * crash inside (e.g.) BellNeonPit doesn't bubble all the way up to the
 * per-tenant `/[schoolId]/error.tsx` boundary and brick the whole CMS
 * page.
 *
 * 2026-05-03 — Operator: "the second I try to change the first period in
 * the first bell schedule widget I get this error and can't do anything."
 * The fault was a render exception inside one widget that cascaded to the
 * route-level error boundary, hiding the actual cause and locking the
 * operator out of every other widget on the canvas. With this boundary in
 * place the bad widget shows a small inline fallback ("This widget hit an
 * error — try editing it again") and the rest of the canvas + the right-
 * hand editor stays interactive. If the operator changes any zone config,
 * the boundary auto-resets so the widget gets a fresh render attempt.
 */
import * as React from 'react';

interface Props {
  /** A stable key — usually `zone.id` — that resets the boundary when
   *  the upstream widget identity changes. Editing config does NOT
   *  remount; we reset only on identity swap or when the operator
   *  manually clicks "try again". */
  resetKey?: string;
  /** Optional label used in the fallback ("Bell Schedule hit an error…"). */
  widgetLabel?: string;
  children: React.ReactNode;
}

interface State {
  error: Error | null;
}

export class WidgetErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidUpdate(prev: Props) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null });
    }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // Console only — Sentry capture would happen at the app level if
    // the error bubbled; we deliberately keep it local here so a noisy
    // widget doesn't spam Sentry on every keystroke.
    // eslint-disable-next-line no-console
    console.error('[WidgetErrorBoundary]', this.props.widgetLabel || 'widget', error, info);
  }

  reset = () => this.setState({ error: null });

  render() {
    if (this.state.error) {
      const label = this.props.widgetLabel || 'Widget';
      const msg = this.state.error.message || String(this.state.error);
      // First two stack frames give the function + file:line that
      // actually threw — enough to point a developer at the line
      // without dumping the whole stack into the operator's view.
      const stackHead = (this.state.error.stack || '')
        .split('\n')
        .slice(1, 3) // skip "Error: ..." then take next 2 frames
        .map((s) => s.trim())
        .filter(Boolean)
        .join(' · ');
      return (
        <div
          role="alert"
          className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-3 text-center bg-rose-50/80 border-2 border-dashed border-rose-300 rounded-lg overflow-auto"
        >
          <div className="text-[11px] font-bold text-rose-700">
            {label} hit an error
          </div>
          <div className="text-[10px] text-rose-600 leading-snug max-w-[95%] font-mono break-words">
            {msg}
          </div>
          {stackHead && (
            <div className="text-[9px] text-rose-500/80 leading-snug max-w-[95%] font-mono break-words opacity-80">
              {stackHead}
            </div>
          )}
          <button
            type="button"
            onClick={this.reset}
            className="mt-1 px-3 py-1 text-[10px] font-bold text-white bg-rose-600 hover:bg-rose-700 rounded"
          >
            Retry render
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
