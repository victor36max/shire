defmodule Shire.CatalogTest do
  use ExUnit.Case, async: false

  alias Shire.Catalog

  @fixture_dir Path.join(System.tmp_dir!(), "catalog_test_fixtures")

  setup_all do
    agents_dir = Path.join(@fixture_dir, "agents/engineering")
    File.mkdir_p!(agents_dir)

    design_dir = Path.join(@fixture_dir, "agents/design")
    File.mkdir_p!(design_dir)

    File.write!(Path.join(agents_dir, "frontend-developer.yaml"), """
    name: frontend-developer
    display_name: Frontend Developer
    description: Expert React developer focused on component architecture
    category: engineering
    emoji: "⚛️"
    tags: [react, typescript, frontend]
    harness: claude_code
    model: claude-sonnet-4-6
    system_prompt: |
      You are a frontend developer.
    """)

    File.write!(Path.join(agents_dir, "backend-architect.yaml"), """
    name: backend-architect
    display_name: Backend Architect
    description: Systems designer focused on scalable backend architectures
    category: engineering
    emoji: "🏗️"
    tags: [backend, api, architecture]
    harness: claude_code
    model: claude-sonnet-4-6
    system_prompt: |
      You are a backend architect.
    """)

    File.write!(Path.join(design_dir, "ui-designer.yaml"), """
    name: ui-designer
    display_name: UI Designer
    description: Visual design specialist creating beautiful interfaces
    category: design
    emoji: "🎨"
    tags: [ui, design, css]
    harness: claude_code
    model: claude-sonnet-4-6
    system_prompt: |
      You are a UI designer.
    """)

    File.write!(Path.join(@fixture_dir, "categories.yaml"), """
    - id: engineering
      name: Engineering
      description: Software development agents
    - id: design
      name: Design
      description: UI/UX and visual design agents
    """)

    Application.put_env(:shire, :catalog_dir, @fixture_dir)

    on_exit(fn ->
      Application.delete_env(:shire, :catalog_dir)
      File.rm_rf!(@fixture_dir)
    end)

    :ok
  end

  describe "list_agents/0" do
    test "returns all catalog agents as structs" do
      agents = Catalog.list_agents()
      assert is_list(agents)
      assert length(agents) == 3

      agent = Enum.find(agents, &(&1.name == "frontend-developer"))
      assert %Catalog.Agent{} = agent
      assert agent.display_name == "Frontend Developer"
      assert agent.category == "engineering"
      assert agent.harness == "claude_code"
      assert is_binary(agent.system_prompt)
    end
  end

  describe "list_agents/1" do
    test "filters by category" do
      agents = Catalog.list_agents(category: "engineering")
      assert length(agents) == 2
      assert Enum.all?(agents, &(&1.category == "engineering"))
    end

    test "returns empty list for unknown category" do
      assert Catalog.list_agents(category: "nonexistent") == []
    end
  end

  describe "get_agent/1" do
    test "returns agent by name" do
      agent = Catalog.get_agent("frontend-developer")
      assert %Catalog.Agent{} = agent
      assert agent.name == "frontend-developer"
      assert agent.display_name == "Frontend Developer"
      assert is_binary(agent.system_prompt)
      assert String.length(agent.system_prompt) > 0
    end

    test "returns nil for unknown name" do
      assert Catalog.get_agent("nonexistent") == nil
    end

    test "rejects path traversal attempts" do
      assert Catalog.get_agent("../../../etc/passwd") == nil
      assert Catalog.get_agent("foo/bar") == nil
      assert Catalog.get_agent("foo\\bar") == nil
    end
  end

  describe "list_categories/0" do
    test "returns categories from categories.yaml" do
      categories = Catalog.list_categories()
      assert length(categories) == 2

      eng = Enum.find(categories, &(&1.id == "engineering"))
      assert eng.name == "Engineering"
      assert is_binary(eng.description)
    end
  end

  describe "search/1" do
    test "matches on display_name case-insensitively" do
      results = Catalog.search("frontend")
      assert length(results) == 1
      assert hd(results).name == "frontend-developer"
    end

    test "matches on description" do
      results = Catalog.search("component architecture")
      assert length(results) == 1
    end

    test "matches on tags" do
      results = Catalog.search("react")
      assert length(results) == 1
    end

    test "returns empty list for no match" do
      assert Catalog.search("zzzznonexistent") == []
    end
  end
end
