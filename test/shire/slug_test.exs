defmodule Shire.SlugTest do
  use ExUnit.Case, async: true

  alias Shire.Slug

  describe "valid?/1" do
    test "accepts simple lowercase name" do
      assert Slug.valid?("hello")
    end

    test "accepts name with numbers" do
      assert Slug.valid?("agent1")
    end

    test "accepts name with dashes" do
      assert Slug.valid?("my-agent")
    end

    test "accepts single character" do
      assert Slug.valid?("a")
    end

    test "accepts single digit" do
      assert Slug.valid?("1")
    end

    test "accepts name with multiple dashes" do
      assert Slug.valid?("my-cool-agent")
    end

    test "rejects uppercase letters" do
      refute Slug.valid?("MyAgent")
    end

    test "rejects spaces" do
      refute Slug.valid?("my agent")
    end

    test "rejects special characters" do
      refute Slug.valid?("my_agent")
      refute Slug.valid?("my.agent")
      refute Slug.valid?("my@agent")
    end

    test "rejects leading dash" do
      refute Slug.valid?("-agent")
    end

    test "rejects trailing dash" do
      refute Slug.valid?("agent-")
    end

    test "rejects empty string" do
      refute Slug.valid?("")
    end

    test "rejects nil" do
      refute Slug.valid?(nil)
    end

    test "rejects name longer than 63 characters" do
      refute Slug.valid?(String.duplicate("a", 64))
    end

    test "accepts name with exactly 63 characters" do
      assert Slug.valid?(String.duplicate("a", 63))
    end
  end

  describe "slugify/1" do
    test "lowercases the string" do
      assert Slug.slugify("MyAgent") == "myagent"
    end

    test "replaces spaces with dashes" do
      assert Slug.slugify("my agent") == "my-agent"
    end

    test "replaces underscores with dashes" do
      assert Slug.slugify("my_agent") == "my-agent"
    end

    test "replaces special characters with dashes" do
      assert Slug.slugify("my@agent") == "my-agent"
    end

    test "collapses consecutive dashes" do
      assert Slug.slugify("my--agent") == "my-agent"
    end

    test "strips leading and trailing dashes" do
      assert Slug.slugify("-my-agent-") == "my-agent"
    end

    test "handles complex case" do
      assert Slug.slugify("  My Cool Agent! ") == "my-cool-agent"
    end

    test "result is a valid slug" do
      assert Slug.valid?(Slug.slugify("Hello World 123"))
    end
  end
end
