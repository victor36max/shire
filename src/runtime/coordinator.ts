import { writeFile, rm } from "fs/promises";
import { join } from "path";
import yaml from "js-yaml";
import { bus } from "../events";
import { AgentManager, type AgentStatus } from "./agent-manager";
import * as agentsService from "../services/agents";
import * as workspace from "../services/workspace";
import { valid as isValidSlug } from "../services/slug";

export interface AgentFields {
  name?: string;
  description?: string;
  harness?: string;
  model?: string;
  systemPrompt?: string;
}

export class Coordinator {
  readonly projectId: string;
  private agents = new Map<string, AgentManager>();
  private statuses = new Map<string, AgentStatus>();
  private deployed = false;

  constructor(projectId: string) {
    this.projectId = projectId;

    // Listen for outbox messages to route between agents
    bus.on(`project:${projectId}:outbox`, (event) => {
      if (event.type === "outbox_message") {
        const p = event.payload as {
          fromAgentId: string;
          fromAgentName: string;
          toAgentName: string;
          text: string;
        };
        this.routeMessage(p.fromAgentId, p.fromAgentName, p.toAgentName, p.text).catch((err) =>
          console.error("routeMessage error:", err),
        );
      }
    });

    // Listen for spawn_agent requests from agents
    bus.on(`project:${projectId}:spawn_agent`, (event) => {
      if (event.type === "spawn_agent") {
        const p = event.payload as { name: string };
        const agent = agentsService.getAgentByName(projectId, p.name);
        if (agent) {
          const proc = this.agents.get(agent.id);
          if (proc) {
            proc.restart().catch((err) => console.error("spawn_agent restart error:", err));
          }
        }
      }
    });
  }

  async deployAndScan(): Promise<void> {
    if (this.deployed) return;

    await workspace.ensureProjectDirs(this.projectId);

    const dbAgents = agentsService.listAgents(this.projectId);
    for (const agent of dbAgents) {
      await this.startAgentManager(agent.id, agent.name);
    }

    await this.writePeersYaml();
    this.deployed = true;
  }

  async createAgent(
    params: { name: string } & AgentFields,
  ): Promise<{ ok: true; agentId: string } | { ok: false; error: string }> {
    // Validate slug
    if (!isValidSlug(params.name)) {
      return {
        ok: false,
        error: "Invalid name: must be 2-63 chars, lowercase letters/numbers/hyphens",
      };
    }

    // Check uniqueness
    const existing = agentsService.getAgentByName(this.projectId, params.name);
    if (existing) {
      return { ok: false, error: `Agent "${params.name}" already exists` };
    }

    // Create DB record with recipe fields
    const agent = agentsService.createAgent(this.projectId, {
      name: params.name,
      description: params.description,
      harness: params.harness,
      model: params.model,
      systemPrompt: params.systemPrompt,
    });

    // Ensure workspace dirs exist
    await workspace.ensureAgentDirs(this.projectId, agent.id);

    // Start process
    await this.startAgentManager(agent.id, agent.name);
    await this.writePeersYaml();

    bus.emit(`project:${this.projectId}:agents`, {
      type: "agent_created",
      payload: { agentId: agent.id, name: agent.name },
    });

    return { ok: true, agentId: agent.id };
  }

  async updateAgent(
    agentId: string,
    params: AgentFields,
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    const agent = agentsService.getAgent(agentId);
    if (!agent) return { ok: false, error: "Agent not found" };

    // Check name uniqueness if renaming
    if (params.name && params.name !== agent.name) {
      const conflict = agentsService.getAgentByName(this.projectId, params.name);
      if (conflict) return { ok: false, error: `Agent "${params.name}" already exists` };
    }

    // Update DB fields
    agentsService.updateAgent(agentId, params);

    // Restart the agent to pick up changes
    const proc = this.agents.get(agentId);
    if (proc) await proc.restart();

    await this.writePeersYaml();

    bus.emit(`project:${this.projectId}:agents`, {
      type: "agent_updated",
      payload: { agentId, name: params.name ?? agent.name },
    });

    return { ok: true };
  }

  async deleteAgent(agentId: string): Promise<{ ok: true } | { ok: false; error: string }> {
    const proc = this.agents.get(agentId);
    if (proc) {
      proc.stop();
      this.agents.delete(agentId);
      this.statuses.delete(agentId);
    }

    // Delete workspace
    const agentDir = workspace.agentDir(this.projectId, agentId);
    await rm(agentDir, { recursive: true, force: true }).catch(() => {});

    // Delete DB record (cascades messages)
    agentsService.deleteAgent(agentId);
    await this.writePeersYaml();

    bus.emit(`project:${this.projectId}:agents`, {
      type: "agent_deleted",
      payload: { agentId },
    });

    return { ok: true };
  }

  async restartAgent(agentId: string): Promise<boolean> {
    const proc = this.agents.get(agentId);
    if (!proc) return false;
    await proc.restart();
    return true;
  }

  getAgent(agentId: string): AgentManager | undefined {
    return this.agents.get(agentId);
  }

  listAgentStatuses(): Array<{
    id: string;
    name: string;
    status: AgentStatus;
    busy: boolean;
    unreadCount: number;
    lastReadMessageId: number | null;
  }> {
    const agentIds = [...this.agents.keys()];
    const lastReadIds = new Map<string, number | null>();
    for (const [id, proc] of this.agents) {
      lastReadIds.set(id, proc.getLastReadMessageId());
    }
    const unreads = agentsService.unreadCounts(agentIds, lastReadIds);

    const result: Array<{
      id: string;
      name: string;
      status: AgentStatus;
      busy: boolean;
      unreadCount: number;
      lastReadMessageId: number | null;
    }> = [];
    for (const [id, proc] of this.agents) {
      result.push({
        id,
        name: proc.agentName,
        status: proc.status,
        busy: proc.busy,
        unreadCount: unreads.get(id) ?? 0,
        lastReadMessageId: proc.getLastReadMessageId(),
      });
    }
    return result.sort((a, b) => a.name.localeCompare(b.name));
  }

  async getAgentDetail(agentId: string): Promise<Record<string, unknown> | null> {
    const proc = this.agents.get(agentId);
    if (!proc) return null;

    const agent = agentsService.getAgent(agentId);
    return {
      id: agentId,
      name: proc.agentName,
      description: agent?.description ?? "",
      harness: agent?.harness ?? "claude_code",
      model: agent?.model ?? null,
      systemPrompt: agent?.systemPrompt ?? null,
      status: proc.status,
    };
  }

  stopAll(): void {
    for (const proc of this.agents.values()) {
      proc.stop();
    }
    this.agents.clear();
    this.statuses.clear();
  }

  // --- Private ---

  private async startAgentManager(agentId: string, agentName: string): Promise<void> {
    const proc = new AgentManager({
      projectId: this.projectId,
      agentId,
      agentName,
    });

    this.agents.set(agentId, proc);

    // Listen for status changes
    bus.on(`project:${this.projectId}:agent:${agentId}`, (event) => {
      if (event.type === "agent_status") {
        const p = event.payload as { agentId: string; status: AgentStatus };
        this.statuses.set(p.agentId, p.status);
      }
    });

    await proc.start();
  }

  private async routeMessage(
    fromAgentId: string,
    fromAgentName: string,
    toAgentName: string,
    text: string,
  ): Promise<void> {
    const targetAgent = agentsService.getAgentByName(this.projectId, toAgentName);
    if (!targetAgent) {
      console.warn(`Inter-agent message from ${fromAgentName} to unknown agent ${toAgentName}`);
      // Notify sender of error
      const sender = this.agents.get(fromAgentId);
      if (sender) {
        const errorEnvelope = {
          ts: Date.now(),
          type: "system_message",
          from: "system",
          payload: {
            text: `Message delivery failed: agent "${toAgentName}" not found. Check peers.yaml for available agents.`,
          },
        };
        const filename = `${Date.now()}-error.yaml`;
        const inboxPath = join(workspace.inboxDir(this.projectId, fromAgentId), filename);
        await writeFile(inboxPath, yaml.dump(errorEnvelope), "utf-8").catch(() => {});
      }
      return;
    }

    const targetProc = this.agents.get(targetAgent.id);
    if (!targetProc) {
      console.warn(`Agent ${toAgentName} exists but has no running process`);
      return;
    }

    // Write to target's inbox
    const envelope = {
      ts: Date.now(),
      type: "agent_message",
      from: fromAgentName,
      payload: { text },
    };
    const filename = `${Date.now()}-${fromAgentName}.yaml`;
    const inboxPath = join(workspace.inboxDir(this.projectId, targetAgent.id), filename);
    await writeFile(inboxPath, yaml.dump(envelope), "utf-8");
  }

  private async writePeersYaml(): Promise<void> {
    const dbAgents = agentsService.listAgents(this.projectId);
    const agentMap = new Map(dbAgents.map((a) => [a.id, a]));
    const peers: Array<Record<string, string>> = [];
    for (const [id, proc] of this.agents) {
      const agent = agentMap.get(id);
      peers.push({
        id,
        name: proc.agentName,
        description: agent?.description ?? "",
      });
    }

    const peersPath = workspace.peersPath(this.projectId);
    await writeFile(peersPath, yaml.dump(peers), "utf-8");
  }
}
