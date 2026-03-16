# Agent Recipe System

## Context

Currently, agent definitions are split across DB columns (name, harness, model, system_prompt) and imperative bootstrap code in `AgentManager`. There's no way for users to declaratively specify what dependencies or setup steps an agent needs — everything is hardcoded in `bootstrap.sh` and the GenServer.

We want a single, declarative YAML document — the **recipe** — that defines everything about an agent: its identity, configuration, and setup scripts. The recipe is the source of truth. The web UI provides a structured form that reads/writes this YAML.

## Recipe Format

A recipe is a YAML document with two concerns: agent configuration and setup scripts.

```yaml
version: 1
name: researcher
description: A research agent that scrapes the web
extends: base

harness: pi
model: anthropic/claude-sonnet-4-6

system_prompt: |
  You are a research agent. You scrape websites
  and summarize findings.

scripts:
  - name: install-python
    run: apt-get install -y python3 python3-pip
  - name: install-scrapy
    run: pip3 install scrapy
```

### Fields

| Field | Required | Description |
|-------|----------|-------------|
| `version` | no | Schema version. Defaults to `1`. Reserved for future format changes. |
| `name` | yes | Agent identifier. Used for display, peer discovery, sprite slugification. Lives only in YAML (no DB column). |
| `description` | no | Human-readable description of what the agent does. Shown in agent list and peer discovery. |
| `extends` | no | Name of a base recipe to inherit scripts from. |
| `harness` | no | `pi` or `claude_code`. Defaults to `pi`. |
| `model` | no | Model identifier. Defaults vary by harness. |
| `system_prompt` | no | System prompt text. |
| `scripts` | no | Ordered list of named setup script steps. |

### Scripts

Each script step has:
- `name` (required): Unique identifier within the recipe. Used for idempotency tracking.
- `run` (required): Shell command(s) to execute via `bash -c`.

### Layering via `extends`

When a recipe specifies `extends: base`, the system:
1. Resolves the base recipe by name
2. Prepends the base recipe's scripts before the agent's scripts
3. Agent-level config fields (harness, model, system_prompt) are NOT inherited — only scripts

This is single-level inheritance only. `extends` chains (base extends another base) are not supported in v1.

### Base Recipes

Base recipes are stored as recipe records with no associated agent. They exist solely to be extended. Example:

```yaml
version: 1
name: base
description: Common setup for all agents

scripts:
  - name: update-packages
    run: apt-get update
  - name: install-basics
    run: apt-get install -y curl jq git
```

## Database Schema

### `agents` table (revised)

```
id            bigint       PK
recipe        text         NOT NULL (full YAML source of truth)
is_base       boolean      DEFAULT false (true = base recipe, not a runnable agent)
status        text         DEFAULT 'created' (runtime state, not in YAML)
inserted_at   utc_datetime
updated_at    utc_datetime
```

Columns removed vs. current schema: `name`, `harness`, `model`, `system_prompt`, `sprite_name`.

- **No `name` column.** Name lives only in the YAML recipe. Routing and queries use `id`. The name is extracted at runtime when needed (e.g., for display, peer discovery, sprite slugification).
- `is_base` distinguishes base recipes (templates for `extends`) from runnable agents. Both live in the same table — no separate `recipes` table needed.
- `status` is runtime-only state managed by `AgentManager`. Not part of the recipe. Base recipes always have status `created`.
- Routes change from `/agents/:name` to `/agents/:id`.

### Secrets

The `secrets` table remains unchanged. Secrets are not part of the recipe (they're sensitive and managed separately).

### Messages

The `messages` table remains unchanged.

## YAML Validation

The `Agent` changeset validates the recipe YAML on every save:

1. **Parse** — YAML must be syntactically valid (via `YamlElixir.read_from_string/1`)
2. **Required fields** — `name` must be present in the YAML
3. **Harness validation** — if present, must be `"pi"` or `"claude_code"`
4. **Scripts validation** — if present, must be a list of maps each with `name` (string) and `run` (string). Script names must be unique within the recipe.
5. **Extends validation** — if present, the referenced base recipe must exist in the DB with `is_base: true`. The reference is by name (parsed from the base recipe's YAML). If the base recipe is deleted later, bootstrap fails gracefully with a clear error logged (agent goes to `:failed` status).

Validation errors are returned as standard Ecto changeset errors, surfaced in the UI form.

## Recipe Runner

A lightweight TypeScript script (`priv/sprite/recipe-runner.ts`, ~150 lines) deployed to the Sprite VM. It processes the merged recipe scripts idempotently.

### Execution Flow

1. Read `/workspace/recipe.yml` (deployed by AgentManager)
2. For each script step in order:
   a. Compute SHA-256 hash of the `run` content
   b. Check for marker file at `/workspace/.recipe-state/{name}.{hash}`
   c. If marker exists → skip (log as skipped)
   d. If no marker (or hash differs from existing marker) → remove old markers for this name, execute `bash -c "{run}"`, write marker on success
3. Output JSON lines to stdout: `{"type": "recipe_step", "name": "...", "status": "done|skipped|failed", "stderr": "..."}`
   - Captures both stdout and stderr from each script for debugging
4. Exit 0 if all steps succeed or are skipped. Exit 1 on any failure (stops at first failure).

### Marker File Convention

```
/workspace/.recipe-state/
  install-python.a1b2c3d4        # name.hash
  install-scrapy.e5f6g7h8
```

When a script's content changes, its hash changes, the old marker doesn't match, and the script re-runs. This gives automatic invalidation on recipe edits.

## AgentManager Integration

### Revised Bootstrap Flow

```
handle_continue(:start_sprite)     # create/get Sprite VM (unchanged)
  ↓
handle_continue(:bootstrap)
  1. Run bootstrap.sh               # workspace dirs, mailbox setup (unchanged)
  2. Parse agent recipe YAML
  3. Resolve extends (fetch base recipe from DB if needed)
  4. Merge scripts (base first, then agent)
  5. Write /workspace/recipe.yml     # merged recipe
  6. Write /workspace/agent-config.json  # extracted from recipe fields
  7. Write /workspace/.env           # secrets (unchanged)
  8. Deploy TS files                 # agent-runner.ts, harnesses, recipe-runner.ts
  9. Write /workspace/package.json
  10. Run recipe-runner.ts           # NEW: execute setup scripts
  11. Run bun install                # npm deps (unchanged)
  ↓
handle_continue(:spawn_runner)      # start agent-runner.ts (unchanged)
```

### Config Extraction

AgentManager parses the YAML and extracts fields for `agent-config.json`:

```elixir
recipe = YamlElixir.read_from_string!(agent.recipe)
name = recipe["name"]
harness = recipe["harness"] || "pi"
model = recipe["model"] || default_model(harness)
system_prompt = recipe["system_prompt"] || "You are a helpful assistant."
```

Registry via-tuples, PubSub topics, and the Coordinator API all use `agent.id` (integer) instead of name. The `name` from the recipe is used for display, sprite slugification, and peer discovery only.

## Web UI

### Agent Form (revised)

The `AgentForm` dialog becomes a structured editor for the recipe YAML:

- **Name** — text input
- **Description** — text input
- **Extends** — dropdown (populated from base recipes, optional)
- **Harness** — dropdown (`pi` / `claude_code`)
- **Model** — text input
- **System Prompt** — textarea
- **Scripts** — dynamic list of name + run pairs (add/remove buttons)
- **Raw YAML** — toggle to switch to a raw YAML textarea for power users

On save, the form serializes all fields into a YAML string and sends it as the `recipe` field. The backend extracts `name` and stores both.

On load, the form parses the YAML and populates the fields.

### Base Recipes

Base recipes share the same table as agents (`is_base: true`). They appear in a separate section on the agents index page (or a filtered view), not a whole new page. The create/edit form for base recipes shows only: name, description, and scripts (no harness/model/system_prompt since those aren't inherited).

### Agent Show Page

The detail card on `AgentShow` reads fields from the parsed recipe instead of separate agent columns. No structural change to the UI — just the data source changes.

## YAML Parsing

- **Server-side:** `YamlElixir` for parsing, `yaml_elixir` hex package.
- **Client-side:** `yaml` npm package (v2) via bun for structured form ↔ YAML serialization. This handles block scalars (`|`) correctly for system_prompt round-tripping.
- **Raw YAML toggle:** When switching from raw → structured, parse and populate fields. If the YAML contains constructs the structured form can't represent (anchors, comments), warn the user that they'll be lost. Structured → raw is lossless.

## Verification

### Backend
```bash
mix compile --warnings-as-errors
mix format --check-formatted
mix test
```

### Frontend
```bash
cd assets && bun run tsc --noEmit
cd assets && bun run test
```

### End-to-end
1. Create a base recipe "base" with a simple script (e.g., `apt-get update`)
2. Create an agent with `extends: base` and an additional script
3. Start the agent — verify both base and agent scripts run
4. Stop and restart the agent — verify scripts are skipped (markers exist)
5. Edit a script's `run` content — verify it re-runs on next start
6. Toggle raw YAML editor — verify round-trip (form → YAML → form) preserves content
