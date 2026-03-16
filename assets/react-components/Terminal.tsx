import * as React from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { useLiveReact } from "live_react";
import { Button } from "./components/ui/button";

interface TerminalProps {
  pushEvent: (event: string, payload: Record<string, unknown>) => void;
}

export default function Terminal({ pushEvent }: TerminalProps) {
  const { handleEvent, removeHandleEvent } = useLiveReact();
  const containerRef = React.useRef<HTMLDivElement>(null);
  const termRef = React.useRef<XTerm | null>(null);
  const fitAddonRef = React.useRef<FitAddon | null>(null);
  const [exited, setExited] = React.useState(false);

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

    // Send keystrokes to server
    const dataDisposable = term.onData((data) => {
      pushEvent("terminal-input", { data });
    });

    // Receive output from server
    const outputRef = handleEvent("terminal-output", (payload: Record<string, unknown>) => {
      const data = payload.data as string;
      const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
      term.write(bytes);
    });

    // Handle terminal exit
    const exitRef = handleEvent("terminal-exit", (payload: Record<string, unknown>) => {
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
        pushEvent("terminal-resize", { rows, cols });
      }, 150);
    });
    observer.observe(containerRef.current);

    // Connect to server
    pushEvent("connect-terminal", {});

    return () => {
      clearTimeout(resizeTimeout);
      observer.disconnect();
      dataDisposable.dispose();
      removeHandleEvent(outputRef);
      removeHandleEvent(exitRef);
      pushEvent("disconnect-terminal", {});
      term.dispose();
      termRef.current = null;
      fitAddonRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
