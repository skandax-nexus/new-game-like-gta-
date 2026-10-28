/**
 * Crash reporter (GDD §15 "crash reporting"). Owned by the CTO.
 *
 * - Hooks window.onerror + unhandledrejection (+ manual report()).
 * - Keeps a ring buffer of the last reports in localStorage (`samrajya.crashes`).
 * - Shows an on-screen error overlay with Copy / Download report / Continue / Reload / Main menu.
 * - Report includes build version, scene, mode, quality, GPU, URL, user agent, recent console lines and
 *   a caller-provided state summary (never the full save - keep reports small and private).
 */
import { BUILD_VERSION, STORAGE_PREFIX } from './constants';
import { recentLogs, type LogLine } from './log';

export interface CrashReport {
  id: string;
  time: string;
  kind: 'error' | 'unhandledrejection' | 'manual' | 'webglcontextlost';
  message: string;
  stack: string;
  source: string;
  build: string;
  url: string;
  userAgent: string;
  context: Record<string, unknown>;
  logs: LogLine[];
}

const STORE_KEY = `${STORAGE_PREFIX}crashes`;
const MAX_REPORTS = 10;

export interface CrashReporterOptions {
  /** Parent for the overlay (defaults to document.body). */
  overlayParent?: HTMLElement;
  /** Show the overlay on errors (default true). */
  showOverlay?: boolean;
  /** Returns context merged into every report (scene, mode, quality, gpu...). */
  context?: () => Record<string, unknown>;
  /** "Main menu" button action; hidden if not provided. */
  onReturnToMenu?: () => void;
}

export class CrashReporter {
  private reports: CrashReport[] = [];
  private overlay: HTMLDivElement | null = null;
  private readonly opts: CrashReporterOptions;
  private listeners: ((r: CrashReport) => void)[] = [];
  private installed = false;
  /** Errors matching these substrings are ignored (e.g. benign browser extension noise). */
  ignore: string[] = ['ResizeObserver loop'];

  constructor(opts: CrashReporterOptions = {}) {
    this.opts = { showOverlay: true, ...opts };
    this.reports = this.loadStored();
  }

  install(): void {
    if (this.installed || typeof window === 'undefined') return;
    this.installed = true;
    window.addEventListener('error', (ev: ErrorEvent) => {
      // Resource load errors have no `error` and target != window.
      const err = ev.error as unknown;
      this.report(err ?? ev.message, 'error', `${ev.filename ?? ''}:${ev.lineno ?? 0}:${ev.colno ?? 0}`);
    });
    window.addEventListener('unhandledrejection', (ev: PromiseRejectionEvent) => {
      this.report(ev.reason, 'unhandledrejection');
    });
  }

  setContextProvider(fn: () => Record<string, unknown>): void {
    this.opts.context = fn;
  }

  setReturnToMenu(fn: (() => void) | undefined): void {
    this.opts.onReturnToMenu = fn;
  }

  onReport(fn: (r: CrashReport) => void): void {
    this.listeners.push(fn);
  }

  /** Report an error. Returns the stored report (or null if ignored). */
  report(error: unknown, kind: CrashReport['kind'] = 'manual', source = ''): CrashReport | null {
    const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    if (this.ignore.some((s) => message.includes(s))) return null;
    let context: Record<string, unknown> = {};
    try {
      context = this.opts.context?.() ?? {};
    } catch (e) {
      context = { contextError: String(e) };
    }
    const report: CrashReport = {
      id: `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`,
      time: new Date().toISOString(),
      kind,
      message,
      stack: error instanceof Error && error.stack ? error.stack : '',
      source,
      build: BUILD_VERSION,
      url: typeof location !== 'undefined' ? location.href : '',
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
      context,
      logs: recentLogs().slice(-60),
    };
    this.reports.push(report);
    if (this.reports.length > MAX_REPORTS) this.reports.splice(0, this.reports.length - MAX_REPORTS);
    this.persist();
    for (const l of this.listeners) {
      try {
        l(report);
      } catch {
        // never throw from the crash path
      }
    }
    if (this.opts.showOverlay) this.showOverlay(report);
    return report;
  }

  getReports(): CrashReport[] {
    return this.reports.slice();
  }

  clear(): void {
    this.reports = [];
    this.persist();
    this.hideOverlay();
  }

  private loadStored(): CrashReport[] {
    try {
      const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(STORE_KEY) : null;
      return raw ? (JSON.parse(raw) as CrashReport[]) : [];
    } catch {
      return [];
    }
  }

  private persist(): void {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(this.reports));
    } catch {
      // storage unavailable
    }
  }

  static formatReport(r: CrashReport): string {
    return JSON.stringify(r, null, 2);
  }

  hideOverlay(): void {
    this.overlay?.remove();
    this.overlay = null;
  }

  private showOverlay(r: CrashReport): void {
    if (typeof document === 'undefined') return;
    this.hideOverlay();
    const parent = this.opts.overlayParent ?? document.body;
    const wrap = document.createElement('div');
    wrap.className = 'samrajya-crash';
    wrap.setAttribute('role', 'alertdialog');
    wrap.setAttribute('aria-label', 'Error report');
    Object.assign(wrap.style, {
      position: 'fixed',
      inset: '0',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'rgba(8, 5, 14, 0.72)',
      zIndex: '3000',
      pointerEvents: 'auto',
      padding: '16px',
      boxSizing: 'border-box',
      fontFamily: "var(--font-body, 'Palatino Linotype', Georgia, serif)",
    } satisfies Partial<CSSStyleDeclaration>);
    const card = document.createElement('div');
    Object.assign(card.style, {
      width: 'min(640px, 100%)',
      maxHeight: '90vh',
      overflow: 'auto',
      background: 'linear-gradient(180deg, #2a1a3a, #1b1228)',
      border: '2px solid #c99a3b',
      borderRadius: '10px',
      boxShadow: '0 12px 48px rgba(0,0,0,0.6), inset 0 0 0 4px rgba(201,154,59,0.15)',
      color: '#f3e6c8',
      padding: '20px 22px',
      boxSizing: 'border-box',
    } satisfies Partial<CSSStyleDeclaration>);
    const title = document.createElement('h2');
    title.textContent = 'The chronicle has been interrupted';
    Object.assign(title.style, { margin: '0 0 8px', color: '#e9b949', fontSize: '20px', letterSpacing: '0.04em' });
    const msg = document.createElement('p');
    msg.textContent = r.message;
    Object.assign(msg.style, { margin: '0 0 10px', fontSize: '14px', wordBreak: 'break-word' });
    const hint = document.createElement('p');
    hint.textContent = 'An error occurred. You can try to continue, return to the main menu, or reload. Please copy or download the report for the studio.';
    Object.assign(hint.style, { margin: '0 0 12px', fontSize: '12px', opacity: '0.8' });
    const details = document.createElement('details');
    const summary = document.createElement('summary');
    summary.textContent = 'Technical details';
    summary.style.cursor = 'pointer';
    const pre = document.createElement('pre');
    pre.textContent = `${r.stack || r.message}\n\nbuild ${r.build}\n${JSON.stringify(r.context, null, 2)}`;
    Object.assign(pre.style, {
      maxHeight: '220px',
      overflow: 'auto',
      background: 'rgba(0,0,0,0.35)',
      padding: '8px',
      fontSize: '11px',
      whiteSpace: 'pre-wrap',
      borderRadius: '4px',
    });
    details.append(summary, pre);
    const row = document.createElement('div');
    Object.assign(row.style, { display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '14px' });
    const mkBtn = (label: string, fn: () => void, primary = false): HTMLButtonElement => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      Object.assign(b.style, {
        font: 'inherit',
        fontSize: '14px',
        padding: '10px 14px',
        minHeight: '44px',
        borderRadius: '6px',
        cursor: 'pointer',
        border: '1px solid #c99a3b',
        background: primary ? 'linear-gradient(180deg, #d9792b, #b4501c)' : 'rgba(255,255,255,0.06)',
        color: '#fff7e6',
      });
      b.addEventListener('click', fn);
      return b;
    };
    const text = CrashReporter.formatReport(r);
    row.append(
      mkBtn('Copy report', () => {
        void navigator.clipboard?.writeText(text).catch(() => undefined);
      }),
      mkBtn('Download report', () => {
        const blob = new Blob([text], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `samrajya-crash-${r.id}.json`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      }),
      mkBtn('Continue', () => this.hideOverlay(), true),
    );
    if (this.opts.onReturnToMenu) {
      const fn = this.opts.onReturnToMenu;
      row.append(
        mkBtn('Main menu', () => {
          this.hideOverlay();
          fn();
        }),
      );
    }
    row.append(mkBtn('Reload', () => location.reload()));
    card.append(title, msg, hint, details, row);
    wrap.appendChild(card);
    parent.appendChild(wrap);
    this.overlay = wrap;
  }
}
