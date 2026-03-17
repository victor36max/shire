defmodule SpriteAgents.AgentsTest do
  use SpriteAgents.DataCase, async: true

  alias SpriteAgents.Agents
  alias SpriteAgents.Agents.Agent

  defp valid_recipe(name \\ "test-agent", opts \\ []) do
    harness = Keyword.get(opts, :harness, "pi")
    model = Keyword.get(opts, :model, "claude-sonnet-4-6")
    system_prompt = Keyword.get(opts, :system_prompt, "You are a test agent.")
    scripts = Keyword.get(opts, :scripts)

    lines = [
      "version: 1",
      "name: #{name}",
      "harness: #{harness}",
      "model: #{model}",
      "system_prompt: #{system_prompt}"
    ]

    lines =
      if scripts do
        lines ++
          ["scripts:"] ++
          Enum.flat_map(scripts, fn {n, r} ->
            ["  - name: #{n}", "    run: #{r}"]
          end)
      else
        lines
      end

    Enum.join(lines, "\n")
  end

  describe "agents" do
    test "list_agents/0 returns only non-base agents" do
      {:ok, agent} = Agents.create_agent(%{recipe: valid_recipe("agent-1")})
      {:ok, _base} = Agents.create_agent(%{recipe: valid_recipe("base"), is_base: true})
      agents = Agents.list_agents()
      assert length(agents) == 1
      assert hd(agents).id == agent.id
    end

    test "list_base_recipes/0 returns only base recipes" do
      {:ok, _agent} = Agents.create_agent(%{recipe: valid_recipe("agent-1")})
      {:ok, base} = Agents.create_agent(%{recipe: valid_recipe("base"), is_base: true})
      recipes = Agents.list_base_recipes()
      assert length(recipes) == 1
      assert hd(recipes).id == base.id
    end

    test "get_agent!/1 returns the agent" do
      {:ok, agent} = Agents.create_agent(%{recipe: valid_recipe()})
      assert Agents.get_agent!(agent.id).id == agent.id
    end

    test "create_agent/1 with valid recipe" do
      recipe = valid_recipe("my-agent", model: "claude-sonnet-4-6")
      assert {:ok, agent} = Agents.create_agent(%{recipe: recipe})
      assert agent.status == :created
      assert agent.is_base == false

      parsed = Agent.parse_recipe!(agent)
      assert parsed["name"] == "my-agent"
      assert parsed["model"] == "claude-sonnet-4-6"
    end

    test "create_agent/1 requires recipe" do
      assert {:error, changeset} = Agents.create_agent(%{})
      assert "can't be blank" in errors_on(changeset).recipe
    end

    test "create_agent/1 rejects invalid YAML" do
      assert {:error, changeset} = Agents.create_agent(%{recipe: "{{{"})
      assert errors_on(changeset).recipe != []
    end

    test "create_agent/1 rejects recipe without name" do
      assert {:error, changeset} = Agents.create_agent(%{recipe: "harness: pi"})
      assert "must include a 'name' field" in errors_on(changeset).recipe
    end

    test "create_agent/1 rejects invalid harness" do
      recipe = "name: test\nharness: invalid_harness"
      assert {:error, changeset} = Agents.create_agent(%{recipe: recipe})
      assert "harness must be 'pi' or 'claude_code'" in errors_on(changeset).recipe
    end

    test "create_agent/1 validates script structure" do
      recipe = "name: test\nscripts:\n  - wrong: format"
      assert {:error, changeset} = Agents.create_agent(%{recipe: recipe})
      assert "each script must have 'name' and 'run' string fields" in errors_on(changeset).recipe
    end

    test "create_agent/1 rejects duplicate script names" do
      recipe = """
      name: test
      scripts:
        - name: setup
          run: echo 1
        - name: setup
          run: echo 2
      """

      assert {:error, changeset} = Agents.create_agent(%{recipe: recipe})
      assert "script names must be unique" in errors_on(changeset).recipe
    end

    test "create_agent/1 with valid scripts" do
      recipe = valid_recipe("scripted", scripts: [{"install-deps", "apt-get update"}])
      assert {:ok, agent} = Agents.create_agent(%{recipe: recipe})
      parsed = Agent.parse_recipe!(agent)
      assert length(parsed["scripts"]) == 1
      assert hd(parsed["scripts"])["name"] == "install-deps"
    end

    test "update_agent/2 updates the recipe" do
      {:ok, agent} = Agents.create_agent(%{recipe: valid_recipe("old-name")})

      assert {:ok, updated} =
               Agents.update_agent(agent, %{recipe: valid_recipe("new-name")})

      assert Agent.recipe_name(updated) == "new-name"
    end

    test "delete_agent/1 deletes the agent" do
      {:ok, agent} = Agents.create_agent(%{recipe: valid_recipe()})
      assert {:ok, _} = Agents.delete_agent(agent)
      assert_raise Ecto.NoResultsError, fn -> Agents.get_agent!(agent.id) end
    end

    test "change_agent/2 returns a changeset" do
      {:ok, agent} = Agents.create_agent(%{recipe: valid_recipe()})
      assert %Ecto.Changeset{} = Agents.change_agent(agent)
    end

    test "find_base_recipe_by_name/1 finds base recipe" do
      {:ok, _base} = Agents.create_agent(%{recipe: valid_recipe("my-base"), is_base: true})
      found = Agents.find_base_recipe_by_name("my-base")
      assert found != nil
      assert Agent.recipe_name(found) == "my-base"
    end

    test "find_base_recipe_by_name/1 returns nil for missing" do
      assert Agents.find_base_recipe_by_name("nonexistent") == nil
    end

    test "update_agent_status/2 updates only status" do
      {:ok, agent} = Agents.create_agent(%{recipe: valid_recipe()})
      assert {:ok, updated} = Agents.update_agent_status(agent, :active)
      assert updated.status == :active
    end

    test "create_agent/1 with valid skills" do
      recipe = """
      name: skilled-agent
      skills:
        - name: web-scraping
          description: Use when scraping web pages
          content: |
            # Web Scraping Guide
            Use requests + BeautifulSoup.
      """

      assert {:ok, agent} = Agents.create_agent(%{recipe: recipe})
      parsed = Agent.parse_recipe!(agent)
      assert length(parsed["skills"]) == 1
      assert hd(parsed["skills"])["name"] == "web-scraping"
    end

    test "create_agent/1 with skills and references" do
      recipe = """
      name: skilled-agent
      skills:
        - name: api-guide
          description: API design patterns
          content: Use REST conventions.
          references:
            - name: schema.md
              content: Users table has id, email.
      """

      assert {:ok, agent} = Agents.create_agent(%{recipe: recipe})
      parsed = Agent.parse_recipe!(agent)
      skill = hd(parsed["skills"])
      assert length(skill["references"]) == 1
      assert hd(skill["references"])["name"] == "schema.md"
    end

    test "create_agent/1 validates skill structure" do
      recipe = "name: test\nskills:\n  - wrong: format"
      assert {:error, changeset} = Agents.create_agent(%{recipe: recipe})

      assert "each skill must have 'name', 'description', and 'content' string fields" in errors_on(
               changeset
             ).recipe
    end

    test "create_agent/1 rejects duplicate skill names" do
      recipe = """
      name: test
      skills:
        - name: my-skill
          description: First skill
          content: Instructions 1
        - name: my-skill
          description: Second skill
          content: Instructions 2
      """

      assert {:error, changeset} = Agents.create_agent(%{recipe: recipe})
      assert "skill names must be unique" in errors_on(changeset).recipe
    end

    test "create_agent/1 rejects invalid skill name format" do
      recipe = """
      name: test
      skills:
        - name: Invalid Name
          description: Bad name format
          content: Instructions
      """

      assert {:error, changeset} = Agents.create_agent(%{recipe: recipe})

      assert Enum.any?(errors_on(changeset).recipe, fn msg ->
               String.contains?(msg, "must be lowercase alphanumeric")
             end)
    end

    test "create_agent/1 rejects invalid skill references" do
      recipe = """
      name: test
      skills:
        - name: my-skill
          description: A skill
          content: Instructions
          references:
            - bad: format
      """

      assert {:error, changeset} = Agents.create_agent(%{recipe: recipe})

      assert "each skill reference must have 'name' and 'content' string fields" in errors_on(
               changeset
             ).recipe
    end

    test "create_agent/1 rejects skills that is not a list" do
      recipe = "name: test\nskills: not-a-list"
      assert {:error, changeset} = Agents.create_agent(%{recipe: recipe})
      assert "skills must be a list" in errors_on(changeset).recipe
    end

    test "create_agent/1 rejects duplicate reference names within a skill" do
      recipe = """
      name: test
      skills:
        - name: my-skill
          description: A skill
          content: Instructions
          references:
            - name: schema.md
              content: First
            - name: schema.md
              content: Second
      """

      assert {:error, changeset} = Agents.create_agent(%{recipe: recipe})
      assert "skill reference names must be unique within a skill" in errors_on(changeset).recipe
    end

    test "create_agent/1 rejects unsafe reference names" do
      recipe = """
      name: test
      skills:
        - name: my-skill
          description: A skill
          content: Instructions
          references:
            - name: ../../etc/passwd
              content: Sneaky
      """

      assert {:error, changeset} = Agents.create_agent(%{recipe: recipe})

      assert Enum.any?(errors_on(changeset).recipe, fn msg ->
               String.contains?(msg, "must be a safe filename")
             end)
    end
  end

  describe "get_agent/1" do
    test "returns {:ok, agent} for existing agent" do
      {:ok, agent} = Agents.create_agent(%{recipe: valid_recipe()})
      assert {:ok, fetched} = Agents.get_agent(agent.id)
      assert fetched.id == agent.id
    end

    test "returns {:error, :not_found} for non-existent agent" do
      assert {:error, :not_found} = Agents.get_agent(0)
    end
  end

  describe "recipe helpers" do
    test "parse_recipe/1 parses valid YAML" do
      {:ok, agent} = Agents.create_agent(%{recipe: valid_recipe("helper-test")})
      assert {:ok, parsed} = Agent.parse_recipe(agent)
      assert parsed["name"] == "helper-test"
    end

    test "recipe_name/1 extracts name" do
      {:ok, agent} = Agents.create_agent(%{recipe: valid_recipe("named")})
      assert Agent.recipe_name(agent) == "named"
    end

    test "recipe_field/2 extracts field" do
      {:ok, agent} = Agents.create_agent(%{recipe: valid_recipe("test", harness: "claude_code")})
      assert Agent.recipe_field(agent, "harness") == "claude_code"
    end
  end

  describe "secrets" do
    test "create_secret/1 with valid data" do
      assert {:ok, secret} = Agents.create_secret(%{key: "API_KEY", value: "secret123"})
      assert secret.key == "API_KEY"
      assert is_nil(secret.agent_id)
    end

    test "create_secret/1 requires key and value" do
      assert {:error, changeset} = Agents.create_secret(%{})
      assert "can't be blank" in errors_on(changeset).key
      assert "can't be blank" in errors_on(changeset).value
    end

    test "list_global_secrets/0 returns only global secrets" do
      {:ok, agent} = Agents.create_agent(%{recipe: valid_recipe()})
      {:ok, _global} = Agents.create_secret(%{key: "GLOBAL_KEY", value: "val"})

      {:ok, _agent_secret} =
        Agents.create_secret(%{key: "AGENT_KEY", value: "val", agent_id: agent.id})

      globals = Agents.list_global_secrets()
      assert length(globals) == 1
      assert hd(globals).key == "GLOBAL_KEY"
    end

    test "effective_secrets/1 merges globals with agent overrides" do
      {:ok, agent} = Agents.create_agent(%{recipe: valid_recipe()})
      {:ok, _} = Agents.create_secret(%{key: "SHARED_KEY", value: "global_val"})
      {:ok, _} = Agents.create_secret(%{key: "ONLY_GLOBAL", value: "val"})

      {:ok, _} =
        Agents.create_secret(%{key: "SHARED_KEY", value: "agent_val", agent_id: agent.id})

      {:ok, _} = Agents.create_secret(%{key: "ONLY_AGENT", value: "val", agent_id: agent.id})

      effective = Agents.effective_secrets(agent.id)
      keys = Enum.map(effective, & &1.key) |> Enum.sort()
      assert keys == ["ONLY_AGENT", "ONLY_GLOBAL", "SHARED_KEY"]

      shared = Enum.find(effective, &(&1.key == "SHARED_KEY"))
      assert shared.agent_id == agent.id
    end
  end

  describe "messages" do
    setup do
      {:ok, agent} = Agents.create_agent(%{recipe: valid_recipe("chat-agent")})
      %{agent: agent}
    end

    test "create_message/1 with valid data", %{agent: agent} do
      assert {:ok, msg} =
               Agents.create_message(%{
                 agent_id: agent.id,
                 role: "user",
                 content: %{"text" => "hi"}
               })

      assert msg.role == "user"
      assert msg.content == %{"text" => "hi"}
      assert msg.agent_id == agent.id
    end

    test "list_messages_for_agent/1 returns messages oldest first", %{agent: agent} do
      {:ok, _} =
        Agents.create_message(%{agent_id: agent.id, role: "user", content: %{"text" => "first"}})

      {:ok, _} =
        Agents.create_message(%{
          agent_id: agent.id,
          role: "agent",
          content: %{"text" => "second"}
        })

      {messages, _has_more} = Agents.list_messages_for_agent(agent.id)
      assert length(messages) == 2
      assert Enum.at(messages, 0).content["text"] == "first"
      assert Enum.at(messages, 1).content["text"] == "second"
    end

    test "messages are cascade deleted with agent", %{agent: agent} do
      {:ok, msg} =
        Agents.create_message(%{agent_id: agent.id, role: "user", content: %{"text" => "hi"}})

      {:ok, _} = Agents.delete_agent(agent)
      assert_raise Ecto.NoResultsError, fn -> Agents.get_message!(msg.id) end
    end
  end
end
