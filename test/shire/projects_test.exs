defmodule Shire.ProjectsTest do
  use Shire.DataCase, async: true

  alias Shire.Projects

  describe "create_project/1" do
    test "creates a project with valid name" do
      assert {:ok, project} = Projects.create_project("my-project")
      assert project.name == "my-project"
      assert project.id
    end

    test "rejects duplicate names" do
      {:ok, _} = Projects.create_project("unique-name")
      assert {:error, changeset} = Projects.create_project("unique-name")
      assert "has already been taken" in errors_on(changeset).name
    end

    test "requires name" do
      assert {:error, changeset} = Projects.create_project(nil)
      assert "can't be blank" in errors_on(changeset).name
    end
  end

  describe "get_project!/1" do
    test "returns project by id" do
      {:ok, project} = Projects.create_project("get-test")
      assert Projects.get_project!(project.id).name == "get-test"
    end

    test "raises on missing id" do
      assert_raise Ecto.NoResultsError, fn ->
        Projects.get_project!(Ecto.UUID.generate())
      end
    end
  end

  describe "get_project_by_id/1" do
    test "returns project or nil" do
      {:ok, project} = Projects.create_project("by-id-test")
      assert Projects.get_project_by_id(project.id).name == "by-id-test"
      assert Projects.get_project_by_id(Ecto.UUID.generate()) == nil
    end
  end

  describe "get_project_by_name/1" do
    test "returns project or nil" do
      {:ok, _} = Projects.create_project("by-name-test")
      assert Projects.get_project_by_name("by-name-test").name == "by-name-test"
      assert Projects.get_project_by_name("nonexistent") == nil
    end
  end

  describe "list_projects/0" do
    test "returns projects ordered by name" do
      {:ok, _} = Projects.create_project("zeta")
      {:ok, _} = Projects.create_project("alpha")
      {:ok, _} = Projects.create_project("mid")

      names = Projects.list_projects() |> Enum.map(& &1.name)
      assert names == ["alpha", "mid", "zeta"]
    end
  end

  describe "rename_project/2" do
    test "updates the project name" do
      {:ok, project} = Projects.create_project("old-name")
      assert {:ok, renamed} = Projects.rename_project(project, "new-name")
      assert renamed.name == "new-name"
      assert Projects.get_project!(project.id).name == "new-name"
    end
  end

  describe "delete_project/1" do
    test "deletes the project" do
      {:ok, project} = Projects.create_project("delete-me")
      assert {:ok, _} = Projects.delete_project(project)
      assert Projects.get_project_by_id(project.id) == nil
    end
  end
end
