import * as React from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { useLiveReact } from "live_react";
import { Button } from "./components/ui/button";

interface TerminalProps {
  pushEvent: (event: string, payload: Record<string, unknown>) => void;
}

function isPrintable(data: string): boolean {
  if (data.length !== 1) return false;
  const code = data.charCodeAt(0);
  return code >= 0x20 && code <= 0x7e;
}

/**
 * Predictive local echo for reducing perceived keystroke latency.
 * Displays typed printable characters immediately in dim style,
 * then confirms or rolls back when the server responds.
 */
export class LocalEchoPredictor {
  private pending = "";
  private term: XTerm;
  private resetTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(term: XTerm) {
    this.term = term;
  }

  predict(data: string): void {
    if (!isPrintable(data)) {
      this.clearPredictions();
      return;
    }

    this.term.write(`\x1b[2m${data}\x1b[22m`);
    this.pending += data;
    this.scheduleReset();
  }

  handleOutput(data: Uint8Array): void {
    if (this.pending.length === 0) {
      this.term.write(data);
      return;
    }

    const text = new TextDecoder().decode(data);
    let matched = 0;

    for (let i = 0; i < text.length && matched < this.pending.length; i++) {
      if (text[i] === this.pending[matched]) {
        matched++;
      } else {
        break;
      }
    }

    if (matched > 0) {
      // Move cursor back over all dim predicted chars, write full server output,
      // then re-draw any remaining unconfirmed predictions
      const totalDim = this.pending.length;
      this.term.write(`\x1b[${totalDim}D`);
      this.pending = this.pending.slice(matched);
      this.term.write(data);

      if (this.pending.length > 0) {
        this.term.write(`\x1b[2m${this.pending}\x1b[22m`);
        this.scheduleReset();
      } else {
        this.cancelReset();
      }
    } else {
      // Mismatch — erase all dim predictions and write server output
      this.clearPredictions();
      this.term.write(data);
    }
  }

  clearPredictions(): void {
    if (this.pending.length > 0) {
      this.term.write(`\x1b[${this.pending.length}D\x1b[0K`);
      this.pending = "";
    }
    this.cancelReset();
  }

  get pendingCount(): number {
    return this.pending.length;
  }

  dispose(): void {
    this.cancelReset();
  }

  private scheduleReset(): void {
    this.cancelReset();
    this.resetTimer = setTimeout(() => {
      this.clearPredictions();
    }, 1000);
  }

  private cancelReset(): void {
    if (this.resetTimer !== null) {
      clearTimeout(this.resetTimer);
      this.resetTimer = null;
    }
  }
}

export default function Terminal({ pushEvent }: TerminalProps) {
  const { handleEvent, removeHandleEvent } = useLiveReact();
  const containerRef = React.useRef<HTMLDivElement>(null);
  const termRef = React.useRef<XTerm | null>(null);
  const fitAddonRef = React.useRef<FitAddon | null>(null);
  const [exited, setExited] = React.useState(false);

  // Stable refs so the mount-only effect doesn't need these in its deps
  const pushEventRef = React.useRef(pushEvent);
  const handleEventRef = React.useRef(handleEvent);
  const removeHandleEventRef = React.useRef(removeHandleEvent);
  React.useEffect(() => {
    pushEventRef.current = pushEvent;
    handleEventRef.current = handleEvent;
    removeHandleEventRef.current = removeHandleEvent;
  });

  React.useEffect(() => {
    if (!containerRef.current) return;

    const term = new XTerm({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
      theme: {
        background: "#1a1a1a",
        foreground: "#e5e5e5",
      },
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(containerRef.current);
    fitAddon.fit();
    term.focus();

    termRef.current = term;
    fitAddonRef.current = fitAddon;

    const predictor = new LocalEchoPredictor(term);

    // Send keystrokes to server with local echo prediction
    const dataDisposable = term.onData((data) => {
      predictor.predict(data);
      pushEventRef.current("terminal-input", { data });
    });

    // Receive output from server — route through predictor
    const outputRef = handleEventRef.current("terminal-output", (payload: Record<string, unknown>) => {
      const data = payload.data as string;
      const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
      predictor.handleOutput(bytes);
    });

    // Handle terminal exit
    const exitRef = handleEventRef.current("terminal-exit", (payload: Record<string, unknown>) => {
      const code = payload.code as number;
      term.writeln(`\r\n\x1b[31m[Session ended with code ${code}]\x1b[0m`);
      setExited(true);
    });

    // Handle resize with debounce
    let resizeTimeout: ReturnType<typeof setTimeout>;
    const observer = new ResizeObserver(() => {
      clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(() => {
        fitAddon.fit();
        const { rows, cols } = term;
        pushEventRef.current("terminal-resize", { rows, cols });
      }, 150);
    });
    observer.observe(containerRef.current);

    // Connect to server
    pushEventRef.current("connect-terminal", {});

    return () => {
      clearTimeout(resizeTimeout);
      observer.disconnect();
      predictor.dispose();
      dataDisposable.dispose();
      removeHandleEventRef.current(outputRef);
      removeHandleEventRef.current(exitRef);
      pushEventRef.current("disconnect-terminal", {});
      term.dispose();
      termRef.current = null;
      fitAddonRef.current = null;
    };
  }, []);

  const handleReconnect = () => {
    setExited(false);
    termRef.current?.clear();
    pushEvent("connect-terminal", {});
  };

  return (
    <div className="relative">
      <div
        ref={containerRef}
        className="w-full rounded-lg overflow-hidden p-3"
        style={{ height: "480px", backgroundColor: "#1a1a1a" }}
      />
      {exited && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/50 rounded-lg">
          <Button onClick={handleReconnect}>Reconnect</Button>
        </div>
      )}
    </div>
  );
}
