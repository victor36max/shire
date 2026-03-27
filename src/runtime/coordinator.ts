import { writeFileSync, rmSync, readFileSync } from "fs";
import { join } from "path";
import yaml from "js-yaml";
import { bus } from "../events";
import { AgentManager, type AgentStatus } from "./agent-manager";
import * as agentsService from "../services/agents";
import * as workspace from "../services/workspace";
import { valid as isValidSlug } from "../services/slug";

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
        this.routeMessage(p.fromAgentId, p.fromAgentName, p.toAgentName, p.text);
      }
    });

    // Listen for spawn_agent requests from agents
    bus.on(`project:${projectId}:spawn_agent`, (event) => {
      if (event.type === "spawn_agent") {
        const p = event.payload as { name: string };
        const agent = agentsService.getAgentByName(projectId, p.name);
        if (agent) {
          const proc = this.agents.get(agent.id);
          if (proc) proc.restart();
        }
      }
    });
  }

  async deployAndScan(): Promise<void> {
    if (this.deployed) return;

    workspace.ensureProjectDirs(this.projectId);

    const dbAgents = agentsService.listAgents(this.projectId);
    for (const agent of dbAgents) {
      await this.startAgentManager(agent.id, agent.name);
    }

    this.writePeersYaml();
    this.deployed = true;
  }

  async createAgent(params: {
    name: string;
    recipeYaml: string;
  }): Promise<{ ok: true; agentId: string } | { ok: false; error: string }> {
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

    // Create DB record
    const agent = agentsService.createAgent(this.projectId, params.name);

    // Write recipe.yaml
    workspace.ensureAgentDirs(this.projectId, agent.id);
    writeFileSync(workspace.recipePath(this.projectId, agent.id), params.recipeYaml, "utf-8");

    // Start process
    await this.startAgentManager(agent.id, agent.name);
    this.writePeersYaml();

    bus.emit(`project:${this.projectId}:agents`, {
      type: "agent_created",
      payload: { agentId: agent.id, name: agent.name },
    });

    return { ok: true, agentId: agent.id };
  }

  async updateAgent(
    agentId: string,
    params: { recipeYaml: string },
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    const agent = agentsService.getAgent(agentId);
    if (!agent) return { ok: false, error: "Agent not found" };

    // Parse new recipe to check for name change
    const recipe = yaml.load(params.recipeYaml) as Record<string, unknown>;
    const newName = recipe?.name as string | undefined;
    if (newName && newName !== agent.name) {
      agentsService.renameAgent(agentId, newName);
    }

    // Write updated recipe
    writeFileSync(workspace.recipePath(this.projectId, agentId), params.recipeYaml, "utf-8");

    // Restart the agent
    const proc = this.agents.get(agentId);
    if (proc) await proc.restart();

    this.writePeersYaml();

    bus.emit(`project:${this.projectId}:agents`, {
      type: "agent_updated",
      payload: { agentId, name: newName ?? agent.name },
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
    try {
      rmSync(agentDir, { recursive: true, force: true });
    } catch {
      // ok
    }

    // Delete DB record (cascades messages)
    agentsService.deleteAgent(agentId);
    this.writePeersYaml();

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

  getAgentDetail(agentId: string): Record<string, unknown> | null {
    const proc = this.agents.get(agentId);
    if (!proc) return null;

    const recipe = this.readRecipe(agentId);
    return {
      id: agentId,
      name: proc.agentName,
      description: recipe?.description ?? "",
      harness: recipe?.harness ?? "claude_code",
      model: recipe?.model ?? null,
      systemPrompt: recipe?.system_prompt ?? null,
      skills: recipe?.skills ?? [],
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

  private routeMessage(
    fromAgentId: string,
    fromAgentName: string,
    toAgentName: string,
    text: string,
  ): void {
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
        try {
          writeFileSync(inboxPath, yaml.dump(errorEnvelope), "utf-8");
        } catch {
          // ok
        }
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
      type: "inter_agent_message",
      from: fromAgentName,
      payload: { text },
    };
    const filename = `${Date.now()}-${fromAgentName}.yaml`;
    const inboxPath = join(workspace.inboxDir(this.projectId, targetAgent.id), filename);
    writeFileSync(inboxPath, yaml.dump(envelope), "utf-8");

    // Persist inter-agent message for sender too (activity log)
    agentsService.createMessage({
      projectId: this.projectId,
      agentId: fromAgentId,
      role: "inter_agent",
      content: {
        text,
        fromAgent: fromAgentName,
        toAgent: toAgentName,
      },
    });
  }

  private readRecipe(agentId: string): Record<string, unknown> | null {
    try {
      const content = readFileSync(workspace.recipePath(this.projectId, agentId), "utf-8");
      return yaml.load(content) as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  private writePeersYaml(): void {
    const peers: Array<Record<string, string>> = [];
    for (const [id, proc] of this.agents) {
      const recipe = this.readRecipe(id);
      peers.push({
        id,
        name: proc.agentName,
        description: (recipe?.description as string) ?? "",
      });
    }

    const peersPath = workspace.peersPath(this.projectId);
    writeFileSync(peersPath, yaml.dump(peers), "utf-8");
  }
}
