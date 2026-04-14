#!/usr/bin/env bun

// Must run before @lexical/code-prism is loaded (it reads globalThis.Prism at init time)
import Prism from "prismjs";
(globalThis as Record<string, unknown>).Prism = Prism;

import { spawn } from "child_process";
import { mkdirSync, openSync } from "fs";
import {
  writePidFile,
  readPidFile,
  removePidFile,
  writePortFile,
  readPortFile,
  removePortFile,
  isProcessRunning,
  logFilePath,
} from "./daemon";
import { startServer } from "./index";

declare const __SHIRE_VERSION__: string;
const VERSION = typeof __SHIRE_VERSION__ !== "undefined" ? __SHIRE_VERSION__ : "0.1.0-dev";

interface ParsedArgs {
  command: string;
  port: number;
  daemon: boolean;
  noOpen: boolean;
  isDaemonChild: boolean;
  commandArgs: string[];
}

function parseArgs(argv: string[]): ParsedArgs {
  const args = argv.slice(2);
  let command = "start";
  let port = 8080;
  let daemon = false;
  let noOpen = false;
  let isDaemonChild = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === "--help" || arg === "-h") {
      command = "help";
    } else if (arg === "--version" || arg === "-v") {
      command = "version";
    } else if (arg === "--daemon" || arg === "-d") {
      daemon = true;
    } else if (arg === "--no-open") {
      noOpen = true;
    } else if (arg === "--_daemon-child") {
      isDaemonChild = true;
    } else if (arg === "--port" || arg === "-p") {
      const next = args[++i];
      const parsed = parseInt(next, 10);
      if (Number.isNaN(parsed)) {
        console.error(`Invalid port: ${next}`);
        process.exit(1);
      }
      port = parsed;
    } else if (arg === "start" || arg === "stop" || arg === "status" || arg === "search-messages") {
      command = arg;
      if (arg === "search-messages") {
        // Collect remaining args for the subcommand
        return { command, port, daemon, noOpen, isDaemonChild, commandArgs: args.slice(i + 1) };
      }
    } else {
      console.error(`Unknown argument: ${arg}`);
      process.exit(1);
    }
  }

  return { command, port, daemon, noOpen, isDaemonChild, commandArgs: [] };
}

export function shouldOpenBrowser(): boolean {
  if (process.env.SHIRE_NO_OPEN) return false;
  if (process.env.SSH_CLIENT || process.env.SSH_TTY) return false;
  if (process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) {
    return false;
  }
  return true;
}

export function openBrowser(url: string): void {
  if (!shouldOpenBrowser()) return;
  if (!/^https?:\/\//.test(url)) return;
  try {
    const cmd = process.platform === "darwin" ? "open" : "xdg-open";
    Bun.spawn([cmd, url], { stdio: ["ignore", "ignore", "ignore"] });
  } catch {
    // Non-fatal — user can open manually
  }
}

function printHelp(): void {
  console.log(`shire v${VERSION} — AI agent orchestration platform

Usage:
  shire [command] [options]

Commands:
  start              Start the server (default)
  stop               Stop a running daemon
  status             Check if the server is running
  search-messages    Search past conversation history (used by agents via Bash)
                     shire search-messages --project-id <id> --agent-id <id>
                                           [--query <text>]
                                           [--start-date <iso>] [--end-date <iso>]
                                           [--limit <n>] [--offset <n>]
                     At least one of --query or --start-date/--end-date is required.

Options:
  -p, --port     Port to listen on (default: 8080)
  -d, --daemon   Run in background (daemon mode)
  --no-open      Don't open browser on start
  -h, --help     Show this help message
  -v, --version  Show version
`);
}

async function handleStart(args: ParsedArgs): Promise<void> {
  // Check if already running
  const existingPid = readPidFile();
  if (existingPid !== null && isProcessRunning(existingPid)) {
    const existingPort = readPortFile();
    console.error(
      `Shire is already running (PID ${existingPid}${existingPort ? `, port ${existingPort}` : ""})`,
    );
    console.error("Use 'shire stop' to stop it first.");
    process.exit(1);
  }

  if (args.daemon && !args.isDaemonChild) {
    // Spawn a detached child process
    const logPath = logFilePath();
    mkdirSync(logPath.substring(0, logPath.lastIndexOf("/")), { recursive: true });
    const logFd = openSync(logPath, "a");
    // In compiled binaries, argv[1] is /$bunfs/root/... which isn't a real path.
    // The binary is process.execPath itself — just pass CLI args, not the script path.
    const isCompiled = process.argv[1]?.startsWith("/$bunfs/");
    const childArgs = isCompiled
      ? [...process.argv.slice(2), "--_daemon-child"]
      : [...process.argv.slice(1), "--_daemon-child"];
    const child = spawn(process.execPath, childArgs, {
      detached: true,
      stdio: ["ignore", logFd, logFd],
      env: { ...process.env, NODE_ENV: "production" },
    });

    if (child.pid === undefined) {
      console.error("Failed to start daemon");
      process.exit(1);
    }

    child.unref();
    const url = `http://localhost:${args.port}`;
    console.log(`Shire daemon started (PID ${child.pid})`);
    console.log(`  URL:  ${url}`);
    console.log(`  Logs: ${logFilePath()}`);
    process.exit(0);
  }

  // Write PID/port files early for daemon mode to prevent double-start race
  if (args.isDaemonChild) {
    writePidFile(process.pid);
    writePortFile(args.port);

    const cleanup = () => {
      removePidFile();
      removePortFile();
      process.exit(0);
    };
    process.on("SIGTERM", cleanup);
    process.on("SIGINT", cleanup);
  }

  const server = await startServer({ port: args.port });
  if (!args.noOpen) {
    openBrowser(`http://localhost:${server.port}`);
  }
}

function handleStop(): void {
  const pid = readPidFile();
  if (pid === null) {
    console.log("Shire is not running (no PID file found)");
    process.exit(0);
  }

  if (!isProcessRunning(pid)) {
    console.log(`Shire is not running (stale PID file for ${pid})`);
    removePidFile();
    removePortFile();
    process.exit(0);
  }

  process.kill(pid, "SIGTERM");

  // Poll for process exit (daemon's own SIGTERM handler removes PID/port files)
  const maxWait = 5000;
  const interval = 100;
  let waited = 0;
  while (waited < maxWait && isProcessRunning(pid)) {
    Bun.sleepSync(interval);
    waited += interval;
  }

  if (isProcessRunning(pid)) {
    console.error(`Shire (PID ${pid}) did not exit after ${maxWait}ms`);
    process.exit(1);
  }

  // Clean up any leftover files in case the daemon's handler didn't run
  removePidFile();
  removePortFile();
  console.log(`Shire stopped (PID ${pid})`);
}

function handleStatus(): void {
  const pid = readPidFile();
  if (pid === null) {
    console.log("Shire is not running");
    process.exit(1);
  }

  if (!isProcessRunning(pid)) {
    console.log(`Shire is not running (stale PID file for ${pid})`);
    removePidFile();
    removePortFile();
    process.exit(1);
  }

  const port = readPortFile();
  console.log(`Shire is running (PID ${pid}${port ? `, port ${port}` : ""})`);
}

async function handleSearchMessages(cmdArgs: string[]): Promise<void> {
  let projectId = "";
  let agentId = "";
  let query = "";
  let limit = 10;
  let offset = 0;
  let startDate: string | undefined;
  let endDate: string | undefined;

  for (let i = 0; i < cmdArgs.length; i++) {
    const arg = cmdArgs[i];
    if (arg === "--project-id") {
      projectId = cmdArgs[++i] ?? "";
    } else if (arg === "--agent-id") {
      agentId = cmdArgs[++i] ?? "";
    } else if (arg === "--query") {
      query = cmdArgs[++i] ?? "";
    } else if (arg === "--limit") {
      const parsed = parseInt(cmdArgs[++i] ?? "10", 10);
      if (Number.isNaN(parsed) || parsed < 1) {
        console.error("--limit must be a positive integer");
        process.exit(1);
      }
      limit = parsed;
    } else if (arg === "--offset") {
      const parsed = parseInt(cmdArgs[++i] ?? "0", 10);
      if (Number.isNaN(parsed) || parsed < 0) {
        console.error("--offset must be a non-negative integer");
        process.exit(1);
      }
      offset = parsed;
    } else if (arg === "--start-date") {
      startDate = cmdArgs[++i];
      if (!startDate) {
        console.error("--start-date requires a value");
        process.exit(1);
      }
    } else if (arg === "--end-date") {
      endDate = cmdArgs[++i];
      if (!endDate) {
        console.error("--end-date requires a value");
        process.exit(1);
      }
    }
  }

  if (!projectId || !agentId) {
    console.error(
      "Usage: shire search-messages --project-id <id> --agent-id <id> " +
        "[--query <text>] [--start-date <iso>] [--end-date <iso>] [--limit <n>] [--offset <n>]",
    );
    process.exit(1);
  }

  if (!query && startDate === undefined && endDate === undefined) {
    console.error("Provide at least one of --query, --start-date, or --end-date");
    process.exit(1);
  }

  const { getDb } = await import("./db");
  getDb();
  const { searchMessages } = await import("./db/fts");
  try {
    const results = searchMessages(projectId, agentId, query, {
      limit,
      offset,
      startDate,
      endDate,
    });
    console.log(JSON.stringify(results, null, 2));
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);

  switch (args.command) {
    case "help":
      printHelp();
      break;
    case "version":
      console.log(`shire v${VERSION}`);
      break;
    case "start":
      await handleStart(args);
      break;
    case "stop":
      handleStop();
      break;
    case "status":
      handleStatus();
      break;
    case "search-messages":
      await handleSearchMessages(args.commandArgs);
      break;
  }
}

if (import.meta.main) {
  main().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  });
}
