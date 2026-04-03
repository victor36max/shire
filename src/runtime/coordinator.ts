import { writeFile } from "fs/promises";
import { join } from "path";
import yaml from "js-yaml";
import {
  bus,
  type AgentStatus,
  type OutboxBusEvent,
  type SpawnAgentBusEvent,
  type AgentBusEvent,
} from "../events";
import { getDb } from "../db";
import { ALERT_SEVERITIES, type AlertSeverity } from "../db/schema";
import { AgentManager } from "./agent-manager";
import * as agentsService from "../services/agents";
import * as projectsService from "../services/projects";
import * as workspace from "../services/workspace";
import * as skillsService from "../services/skills";
import { dispatchAlert } from "../services/alert-dispatcher";
import type { Skill } from "../services/skills";
import { valid as isValidSlug } from "../services/slug";

export interface AgentFields {
  name?: string;
  description?: string;
  harness?: string;
  model?: string;
  systemPrompt?: string;
  skills?: Skill[];
}

export class Coordinator {
  readonly projectId: string;
  private agents = new Map<string, AgentManager>();
  private statuses = new Map<string, AgentStatus>();
  private deployed = false;
  private unsubscribes: Array<() => void> = [];

  constructor(projectId: string) {
    this.projectId = projectId;

    // Listen for outbox messages to route between agents or handle system commands
    this.unsubscribes.push(
      bus.on<OutboxBusEvent>(`project:${projectId}:outbox`, (event) => {
        if (event.type === "outbox_message") {
          const { fromAgentId, fromAgentName, toAgentName, text, extra } = event.payload;
          if (toAgentName.startsWith("system_")) {
            this.handleSystemCommand(fromAgentId, fromAgentName, toAgentName, text, extra).catch(
              (err) => console.error("handleSystemCommand error:", err),
            );
          } else {
            this.routeMessage(fromAgentId, fromAgentName, toAgentName, text).catch((err) =>
              console.error("routeMessage error:", err),
            );
          }
        }
      }),
    );

    // Listen for spawn_agent requests from agents
    this.unsubscribes.push(
      bus.on<SpawnAgentBusEvent>(`project:${projectId}:spawn_agent`, (event) => {
        if (event.type === "spawn_agent") {
          const agent = agentsService.getAgentByName(projectId, event.payload.name);
          if (agent) {
            const proc = this.agents.get(agent.id);
            if (proc) {
              proc.restart().catch((err) => console.error("spawn_agent restart error:", err));
            }
          }
        }
      }),
    );
  }

  async deployAndScan(): Promise<void> {
    if (this.deployed) return;

    await workspace.ensureProjectDirs(this.projectId);

    const dbAgents = agentsService.listAgents(this.projectId);
    const results = await Promise.allSettled(
      dbAgents.map((agent) => this.startAgentManager(agent.id, agent.name)),
    );
    const ok = results.filter((r) => r.status === "fulfilled").length;
    const failed = results.filter((r) => r.status === "rejected");
    for (const f of failed) {
      console.error(`Coordinator[${this.projectId}]: agent boot failed:`, f.reason);
    }
    if (failed.length > 0) {
      console.warn(`Coordinator[${this.projectId}]: ${ok}/${dbAgents.length} agent(s) started`);
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

    // Create DB record + workspace dirs atomically
    const agent = getDb().transaction((tx) => {
      const a = agentsService.createAgent(
        this.projectId,
        {
          name: params.name,
          description: params.description,
          harness: params.harness,
          model: params.model,
          systemPrompt: params.systemPrompt,
        },
        tx,
      );
      workspace.ensureAgentDirsSync(this.projectId, a.id);
      return a;
    });

    // Write skills to filesystem (after txn so workspace dirs exist)
    if (params.skills?.length) {
      await skillsService.writeSkills(this.projectId, agent.id, params.skills, params.harness);
    }

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

    // Update DB fields + migrate skills if harness changed
    const harnessChanged = params.harness && params.harness !== agent.harness;
    try {
      getDb().transaction((tx) => {
        agentsService.updateAgent(agentId, params, tx);
        if (harnessChanged) {
          skillsService.copySkillsSync(this.projectId, agentId, agent.harness, params.harness!);
        }
      });
    } catch (err) {
      return { ok: false, error: String(err) };
    }
    // Clean up old harness skills dir only after successful commit
    if (harnessChanged) {
      skillsService.removeSkillsDirSync(this.projectId, agentId, agent.harness);
    }

    // Write skills to filesystem if provided
    if (params.skills !== undefined) {
      const harness = params.harness ?? agent.harness ?? undefined;
      await skillsService.writeSkills(this.projectId, agentId, params.skills, harness);
    }

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
      await proc.stop();
      this.agents.delete(agentId);
      this.statuses.delete(agentId);
    }

    // Delete DB record + workspace atomically
    getDb().transaction((tx) => {
      agentsService.deleteAgent(agentId, tx);
      workspace.removeAgentDirSync(this.projectId, agentId);
    });
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

  async restartAllAgents(): Promise<void> {
    await Promise.all([...this.agents.values()].map((proc) => proc.restart()));
  }

  getAgent(agentId: string): AgentManager | undefined {
    return this.agents.get(agentId);
  }

  listAgentStatuses(): {
    agents: Array<{
      id: string;
      name: string;
      status: AgentStatus;
      busy: boolean;
      unreadCount: number;
      lastReadMessageId: number | null;
      lastUserMessageAt: string | null;
    }>;
    defaultAgentId: string | null;
  } {
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
      lastUserMessageAt: string | null;
    }> = [];
    for (const [id, proc] of this.agents) {
      result.push({
        id,
        name: proc.agentName,
        status: proc.status,
        busy: proc.busy,
        unreadCount: unreads.get(id) ?? 0,
        lastReadMessageId: proc.getLastReadMessageId(),
        lastUserMessageAt: proc.getLastUserMessageAt(),
      });
    }

    // Default agent: most recently interacted (highest lastUserMessageAt)
    let defaultAgentId: string | null = null;
    let latestTs: string | null = null;
    for (const agent of result) {
      if (agent.lastUserMessageAt && (!latestTs || agent.lastUserMessageAt > latestTs)) {
        latestTs = agent.lastUserMessageAt;
        defaultAgentId = agent.id;
      }
    }

    // Sort: unread pinned first, then by lastUserMessageAt desc (nulls last), then alphabetical
    result.sort((a, b) => {
      const aUnread = a.unreadCount > 0 ? 1 : 0;
      const bUnread = b.unreadCount > 0 ? 1 : 0;
      if (aUnread !== bUnread) return bUnread - aUnread;

      if (a.lastUserMessageAt && b.lastUserMessageAt) {
        return b.lastUserMessageAt.localeCompare(a.lastUserMessageAt);
      }
      if (a.lastUserMessageAt && !b.lastUserMessageAt) return -1;
      if (!a.lastUserMessageAt && b.lastUserMessageAt) return 1;

      return a.name.localeCompare(b.name);
    });

    return { agents: result, defaultAgentId };
  }

  async getAgentDetail(agentId: string): Promise<Record<string, unknown> | null> {
    const proc = this.agents.get(agentId);
    if (!proc) return null;

    const agent = agentsService.getAgent(agentId);
    const agentSkills = await skillsService.readSkills(
      this.projectId,
      agentId,
      agent?.harness ?? undefined,
    );
    return {
      id: agentId,
      name: proc.agentName,
      description: agent?.description ?? "",
      harness: agent?.harness ?? "claude_code",
      model: agent?.model ?? null,
      systemPrompt: agent?.systemPrompt ?? null,
      skills: agentSkills,
      status: proc.status,
    };
  }

  async stopAll(): Promise<void> {
    await Promise.all([...this.agents.values()].map((proc) => proc.stop()));
    this.agents.clear();
    this.statuses.clear();
    for (const unsub of this.unsubscribes) unsub();
    this.unsubscribes = [];
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
    this.unsubscribes.push(
      bus.on<AgentBusEvent>(`project:${this.projectId}:agent:${agentId}`, (event) => {
        if (event.type === "agent_status") {
          this.statuses.set(event.payload.agentId, event.payload.status);
        }
      }),
    );

    await proc.start();
  }

  private async handleSystemCommand(
    fromAgentId: string,
    fromAgentName: string,
    command: string,
    text: string,
    extra?: Record<string, unknown>,
  ): Promise<void> {
    if (command === "system_alert") {
      const title = (extra?.title as string) || text;
      const body = (extra?.body as string) || text;
      const rawSeverity = (extra?.severity as string) || "info";

      if (!ALERT_SEVERITIES.includes(rawSeverity as AlertSeverity)) {
        await this.sendSystemError(
          fromAgentId,
          `Invalid alert severity "${rawSeverity}". Must be one of: ${ALERT_SEVERITIES.join(", ")}.`,
        );
        return;
      }

      const project = projectsService.getProject(this.projectId);
      await dispatchAlert(this.projectId, {
        title,
        body,
        severity: rawSeverity as AlertSeverity,
        agentName: fromAgentName,
        projectName: project?.name ?? this.projectId,
      });
      return;
    }

    await this.sendSystemError(
      fromAgentId,
      `Unknown system command "${command}". Only "system_alert" is supported.`,
    );
  }

  private async sendSystemError(agentId: string, text: string): Promise<void> {
    const errorEnvelope = {
      ts: Date.now(),
      type: "system_message",
      from: "system",
      payload: { text },
    };
    const filename = `${Date.now()}-error.yaml`;
    const inboxPath = join(workspace.inboxDir(this.projectId, agentId), filename);
    await writeFile(inboxPath, yaml.dump(errorEnvelope), "utf-8").catch(() => {});
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
      await this.sendSystemError(
        fromAgentId,
        `Message delivery failed: agent "${toAgentName}" not found. Check peers.yaml for available agents.`,
      );
      return;
    }

    const targetProc = this.agents.get(targetAgent.id);
    if (!targetProc) {
      console.warn(`Agent ${toAgentName} exists but has no running process`);
      await this.sendSystemError(
        fromAgentId,
        `Message delivery failed: agent "${toAgentName}" is not running.`,
      );
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
