/**
 * Console capture ring buffer (feeds crash reports). Owned by the CTO.
 * Call installConsoleCapture() once at boot; original console methods still run.
 */
export interface LogLine {
  t: number;
  level: 'log' | 'info' | 'warn' | 'error' | 'debug';
  text: string;
}

const MAX_LINES = 150;
const lines: LogLine[] = [];
let installed = false;

function fmt(args: unknown[]): string {
  return args
    .map((a) => {
      if (typeof a === 'string') return a;
      if (a instanceof Error) return `${a.name}: ${a.message}`;
      try {
        return JSON.stringify(a);
      } catch {
        return String(a);
      }
    })
    .join(' ')
    .slice(0, 800);
}

export function pushLog(level: LogLine['level'], text: string): void {
  lines.push({ t: typeof performance !== 'undefined' ? performance.now() : 0, level, text });
  if (lines.length > MAX_LINES) lines.splice(0, lines.length - MAX_LINES);
}

export function installConsoleCapture(): void {
  if (installed || typeof console === 'undefined') return;
  installed = true;
  for (const level of ['log', 'info', 'warn', 'error', 'debug'] as const) {
    const orig = console[level].bind(console);
    console[level] = (...args: unknown[]): void => {
      pushLog(level, fmt(args));
      orig(...args);
    };
  }
}

export function recentLogs(): LogLine[] {
  return lines.slice();
}
