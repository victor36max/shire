import type { Harness, HarnessConfig, EventCallback } from "./types";

export class ClaudeCodeHarness implements Harness {
  private callback: EventCallback = () => {};
  private processing = false;
  private stopped = false;

  async start(_config: HarnessConfig): Promise<void> {
    // TODO: implement in Task 3
  }

  async sendMessage(_text: string, _from?: string): Promise<void> {
    // TODO: implement in Task 3
  }

  async interrupt(): Promise<void> {
    // TODO: implement in Task 3
  }

  async stop(): Promise<void> {
    this.stopped = true;
  }

  onEvent(callback: EventCallback): void {
    this.callback = callback;
  }

  isProcessing(): boolean {
    return this.processing;
  }
}
