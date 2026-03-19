defmodule Shire.Projects do
  import Ecto.Query
  alias Ecto.Multi
  alias Shire.Repo
  alias Shire.Projects.Project

  def create_project(name) do
    %Project{}
    |> Project.changeset(%{name: name})
    |> Repo.insert()
  end

  def get_project!(id), do: Repo.get!(Project, id)

  def get_project_by_id(id) do
    Repo.get(Project, id)
  end

  def get_project_by_name(name) do
    Repo.get_by(Project, name: name)
  end

  def get_project_by_name!(name) do
    Repo.get_by!(Project, name: name)
  end

  def list_projects do
    Repo.all(from(p in Project, order_by: [asc: p.name]))
  end

  def rename_project(%Project{} = project, new_name) do
    Multi.new()
    |> Multi.update(:project, Project.changeset(project, %{name: new_name}))
    |> Repo.transaction()
    |> case do
      {:ok, %{project: project}} -> {:ok, project}
      {:error, :project, changeset, _} -> {:error, changeset}
    end
  end

  def delete_project(%Project{} = project) do
    Repo.delete(project)
  end
end
