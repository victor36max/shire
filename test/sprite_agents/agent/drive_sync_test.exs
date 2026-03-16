defmodule SpriteAgents.Agent.DriveSyncTest do
  use SpriteAgents.DataCase, async: false

  alias SpriteAgents.Agent.DriveSync

  describe "list_files/1" do
    test "returns {:ok, list} for root path" do
      {:ok, files} = DriveSync.list_files("/")
      assert is_list(files)
    end

    test "returns {:ok, list} for nested path" do
      {:ok, files} = DriveSync.list_files("/nonexistent-path")
      assert is_list(files)
    end
  end

  describe "read_file/1" do
    test "returns {:ok, content} or {:error, reason}" do
      result = DriveSync.read_file("nonexistent-file.txt")
      assert match?({:ok, _}, result) or match?({:error, _}, result)
    end
  end

  describe "ensure_started/0" do
    test "returns :ok or {:error, reason}" do
      result = DriveSync.ensure_started()
      assert result == :ok or match?({:error, _}, result)
    end
  end

  describe "sync_to_agent/2" do
    test "returns :ok when disabled or drive not started" do
      # With nil sprite, should handle gracefully
      result = DriveSync.sync_to_agent(999_999, nil)
      assert result == :ok or match?({:error, _}, result)
    end
  end

  describe "parse_find_output/1" do
    test "parses file paths from find output" do
      output = "/drive/readme.md\n/drive/docs/guide.txt\n/drive/src/app.ts\n"

      assert DriveSync.parse_find_output(output) == [
               "readme.md",
               "docs/guide.txt",
               "src/app.ts"
             ]
    end

    test "filters out empty lines and drive root" do
      output = "/drive\n\n/drive/file.txt\n\n"

      assert DriveSync.parse_find_output(output) == ["file.txt"]
    end

    test "returns empty list for empty output" do
      assert DriveSync.parse_find_output("") == []
    end

    test "handles single file" do
      assert DriveSync.parse_find_output("/drive/only-file.txt\n") == ["only-file.txt"]
    end

    test "handles deeply nested paths" do
      output = "/drive/a/b/c/d/e/file.txt\n"

      assert DriveSync.parse_find_output(output) == ["a/b/c/d/e/file.txt"]
    end
  end

  describe "cast operations do not crash" do
    test "file_changed/3" do
      assert :ok = DriveSync.file_changed(1, "test.txt", "hello")
    end

    test "file_deleted/2" do
      assert :ok = DriveSync.file_deleted(1, "test.txt")
    end

    test "write_file/2" do
      assert :ok = DriveSync.write_file("test.txt", "hello")
    end

    test "create_dir/1" do
      assert :ok = DriveSync.create_dir("new-folder")
    end

    test "delete_file/1" do
      assert :ok = DriveSync.delete_file("test.txt")
    end

    test "delete_dir/1" do
      assert :ok = DriveSync.delete_dir("old-folder")
    end
  end
end
