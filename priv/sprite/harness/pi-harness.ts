import type { Harness, HarnessConfig, EventCallback } from "./types";

export class PiHarness implements Harness {
  private callback: EventCallback = () => {};
  private processing = false;
  private stopped = false;

  async start(_config: HarnessConfig): Promise<void> {
    // TODO: implement in Task 2
  }

  async sendMessage(_text: string, _from?: string): Promise<void> {
    // TODO: implement in Task 2
  }

  async interrupt(): Promise<void> {
    // TODO: implement in Task 2
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
