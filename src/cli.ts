#!/usr/bin/env bun
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

const VERSION = "0.1.0";

interface ParsedArgs {
  command: string;
  port: number;
  daemon: boolean;
  isDaemonChild: boolean;
}

function parseArgs(argv: string[]): ParsedArgs {
  const args = argv.slice(2);
  let command = "start";
  let port = 8080;
  let daemon = false;
  let isDaemonChild = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === "--help" || arg === "-h") {
      command = "help";
    } else if (arg === "--version" || arg === "-v") {
      command = "version";
    } else if (arg === "--daemon" || arg === "-d") {
      daemon = true;
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
    } else if (arg === "start" || arg === "stop" || arg === "status") {
      command = arg;
    } else {
      console.error(`Unknown argument: ${arg}`);
      process.exit(1);
    }
  }

  return { command, port, daemon, isDaemonChild };
}

function printHelp(): void {
  console.log(`shire v${VERSION} — AI agent orchestration platform

Usage:
  shire [command] [options]

Commands:
  start          Start the server (default)
  stop           Stop a running daemon
  status         Check if the server is running

Options:
  -p, --port     Port to listen on (default: 8080)
  -d, --daemon   Run in background (daemon mode)
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
    console.log(`Shire daemon started (PID ${child.pid})`);
    console.log(`  Port: ${args.port}`);
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

  await startServer({ port: args.port });
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
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
