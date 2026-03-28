import { join } from "path";
import { homedir } from "os";
import { readFileSync, writeFileSync, unlinkSync, existsSync, mkdirSync } from "fs";

function getDataDir(): string {
  return process.env.SHIRE_DATA_DIR || join(homedir(), ".shire");
}

function ensureDataDir(): void {
  mkdirSync(getDataDir(), { recursive: true });
}

function pidFilePath(): string {
  return join(getDataDir(), "shire.pid");
}

function portFilePath(): string {
  return join(getDataDir(), "shire.port");
}

export function logFilePath(): string {
  return join(getDataDir(), "shire.log");
}

export function writePidFile(pid: number): void {
  ensureDataDir();
  writeFileSync(pidFilePath(), String(pid), "utf-8");
}

export function readPidFile(): number | null {
  try {
    const content = readFileSync(pidFilePath(), "utf-8").trim();
    const pid = parseInt(content, 10);
    return Number.isNaN(pid) ? null : pid;
  } catch {
    return null;
  }
}

export function removePidFile(): void {
  try {
    unlinkSync(pidFilePath());
  } catch {
    // File may not exist — that's fine
  }
}

export function writePortFile(port: number): void {
  ensureDataDir();
  writeFileSync(portFilePath(), String(port), "utf-8");
}

export function readPortFile(): number | null {
  try {
    const content = readFileSync(portFilePath(), "utf-8").trim();
    const port = parseInt(content, 10);
    return Number.isNaN(port) ? null : port;
  } catch {
    return null;
  }
}

export function removePortFile(): void {
  try {
    unlinkSync(portFilePath());
  } catch {
    // File may not exist — that's fine
  }
}

export function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function pidFileExists(): boolean {
  return existsSync(pidFilePath());
}
