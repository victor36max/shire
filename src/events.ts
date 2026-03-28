import { EventEmitter } from "events";

/** Agent lifecycle status — shared between runtime and event bus. */
export type AgentStatus = "idle" | "bootstrapping" | "active" | "crashed";

// --- Serialized message shape attached to agent-level bus events ---
export interface SerializedMessage {
  id: number;
  role: string;
  ts: string;
  text?: string;
  tool?: string;
  tool_use_id?: string;
  input?: Record<string, unknown>;
  output?: string | null;
  isError?: boolean;
  fromAgent?: string;
  attachments?: Array<{
    id: string;
    filename: string;
    content_type: string;
    size: number;
  }>;
}

// --- Agent-level bus events (project:{id}:agent:{aid} channel) ---
export type AgentBusEvent =
  | { type: "text_delta"; payload: { delta: string } }
  | { type: "text"; payload: { text: string }; message?: SerializedMessage }
  | {
      type: "tool_use";
      payload: {
        tool: string;
        tool_use_id: string;
        input: Record<string, unknown>;
        status: string;
        output?: string;
        is_error?: boolean;
      };
      message?: SerializedMessage;
    }
  | { type: "tool_result"; payload: { tool_use_id: string; output: string; is_error: boolean } }
  | { type: "turn_complete"; payload: Record<string, never> }
  | { type: "error"; payload: { message: string }; message?: SerializedMessage }
  | {
      type: "inter_agent_message";
      payload: { fromAgent: string; text: string };
      message?: SerializedMessage;
    }
  | { type: "system_message"; payload: { text: string }; message?: SerializedMessage }
  | {
      type: "attachment";
      payload: {
        attachments: Array<{
          id: string;
          filename: string;
          content_type: string;
          size: number;
        }>;
      };
      message?: SerializedMessage;
    }
  | { type: "agent_status"; payload: { agentId: string; status: AgentStatus } }
  | { type: "agent_busy"; payload: { agentId: string; active: boolean } };

// --- Agent-list events (project:{id}:agents channel) ---
export type AgentListBusEvent =
  | { type: "agent_created"; payload: { agentId: string; name: string } }
  | { type: "agent_updated"; payload: { agentId: string; name: string } }
  | { type: "agent_deleted"; payload: { agentId: string } }
  | { type: "agent_status"; payload: { agentId: string; status: AgentStatus } }
  | { type: "agent_busy"; payload: { agentId: string; active: boolean } }
  | {
      type: "new_message_notification";
      payload: { agentId: string; messageId: number; role: string };
    };

// --- Project lobby events (projects:lobby channel) ---
export type ProjectBusEvent =
  | { type: "project_created"; payload: { id: string; name: string } }
  | { type: "project_destroyed"; payload: { id: string } }
  | { type: "project_restarted"; payload: { id: string } }
  | { type: "project_renamed"; payload: { id: string; name: string } };

// --- Outbox events (project:{id}:outbox channel) ---
export type OutboxBusEvent = {
  type: "outbox_message";
  payload: {
    fromAgentId: string;
    fromAgentName: string;
    toAgentName: string;
    text: string;
  };
};

// --- Schedule events (project:{id}:schedules channel) ---
export type ScheduleBusEvent = {
  type: "schedule_fired";
  payload: { taskId: string };
};

// --- Spawn agent events (project:{id}:spawn_agent channel) ---
export type SpawnAgentBusEvent = {
  type: "spawn_agent";
  payload: { name: string };
};

// Union of all bus events
export type BusEvent =
  | AgentBusEvent
  | AgentListBusEvent
  | ProjectBusEvent
  | OutboxBusEvent
  | ScheduleBusEvent
  | SpawnAgentBusEvent;

type EventHandler<E extends BusEvent = BusEvent> = (event: E) => void;

class EventBus {
  private emitter = new EventEmitter();

  constructor() {
    this.emitter.setMaxListeners(0);
  }

  emit<E extends BusEvent>(topic: string, event: E): void {
    this.emitter.emit(topic, event);
  }

  on<E extends BusEvent = BusEvent>(topic: string, handler: EventHandler<E>): () => void {
    this.emitter.on(topic, handler as EventHandler);
    return () => this.emitter.off(topic, handler as EventHandler);
  }

  off<E extends BusEvent = BusEvent>(topic: string, handler: EventHandler<E>): void {
    this.emitter.off(topic, handler as EventHandler);
  }
}

export const bus = new EventBus();
