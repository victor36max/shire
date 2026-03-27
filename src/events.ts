import { EventEmitter } from "events";

type EventHandler = (event: BusEvent) => void;

export interface BusEvent {
  type: string;
  payload?: unknown;
  message?: unknown;
}

class EventBus {
  private emitter = new EventEmitter();

  constructor() {
    this.emitter.setMaxListeners(0);
  }

  emit(topic: string, event: BusEvent): void {
    this.emitter.emit(topic, event);
  }

  on(topic: string, handler: EventHandler): () => void {
    this.emitter.on(topic, handler);
    return () => this.emitter.off(topic, handler);
  }

  off(topic: string, handler: EventHandler): void {
    this.emitter.off(topic, handler);
  }
}

export const bus = new EventBus();
