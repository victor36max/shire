defmodule Shire.CatalogTest do
  use ExUnit.Case, async: true

  alias Shire.Catalog

  describe "list_agents/0" do
    test "returns all catalog agents as structs" do
      agents = Catalog.list_agents()
      assert is_list(agents)
      assert length(agents) > 0

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
      assert length(agents) >= 2
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
  end

  describe "list_categories/0" do
    test "returns categories from categories.yaml" do
      categories = Catalog.list_categories()
      assert is_list(categories)
      assert length(categories) > 0

      eng = Enum.find(categories, &(&1.id == "engineering"))
      assert eng.name == "Engineering"
      assert is_binary(eng.description)
    end
  end

  describe "search/1" do
    test "matches on display_name case-insensitively" do
      results = Catalog.search("frontend")
      assert length(results) >= 1
      assert Enum.any?(results, &(&1.name == "frontend-developer"))
    end

    test "matches on description" do
      results = Catalog.search("optimization")
      assert length(results) >= 1
    end

    test "matches on tags" do
      results = Catalog.search("react")
      assert length(results) >= 1
    end

    test "returns empty list for no match" do
      assert Catalog.search("zzzznonexistent") == []
    end
  end
end
