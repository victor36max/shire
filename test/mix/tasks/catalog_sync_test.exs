defmodule Mix.Tasks.Catalog.SyncTest do
  use ExUnit.Case, async: true

  alias Mix.Tasks.Catalog.Sync

  describe "parse_frontmatter/1" do
    test "extracts frontmatter and body from markdown" do
      content =
        "---\nname: Test Agent\ndescription: A test agent\nemoji: \"🤖\"\n---\n\nYou are a test agent with special abilities."

      {frontmatter, body} = Sync.parse_frontmatter(content)
      assert frontmatter["name"] == "Test Agent"
      assert frontmatter["description"] == "A test agent"
      assert frontmatter["emoji"] == "🤖"
      assert String.contains?(body, "test agent with special abilities")
    end

    test "returns empty map and full content when no frontmatter" do
      content = "Just some text"
      {frontmatter, body} = Sync.parse_frontmatter(content)
      assert frontmatter == %{}
      assert body == "Just some text"
    end
  end

  describe "slugify/1" do
    test "converts name to slug" do
      assert Sync.slugify("Frontend Developer") == "frontend-developer"
      assert Sync.slugify("UI/UX Designer") == "ui-ux-designer"
      assert Sync.slugify("Senior Dev (React)") == "senior-dev-react"
    end

    test "handles already-slugified names" do
      assert Sync.slugify("frontend-developer") == "frontend-developer"
    end
  end

  describe "build_agent_yaml/3" do
    test "produces valid YAML map" do
      frontmatter = %{
        "name" => "Test Agent",
        "description" => "A test",
        "emoji" => "🤖"
      }

      body = "You are a test agent."
      category = "engineering"

      yaml_map = Sync.build_agent_yaml(frontmatter, body, category)
      assert yaml_map["name"] == "test-agent"
      assert yaml_map["display_name"] == "Test Agent"
      assert yaml_map["description"] == "A test"
      assert yaml_map["emoji"] == "🤖"
      assert yaml_map["category"] == "engineering"
      assert yaml_map["system_prompt"] == "You are a test agent."
      assert yaml_map["harness"] == "claude_code"
      assert yaml_map["model"] == "claude-sonnet-4-6"
      assert yaml_map["tags"] == []
    end
  end
end
