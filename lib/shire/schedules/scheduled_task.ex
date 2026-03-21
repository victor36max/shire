defmodule Shire.Schedules.ScheduledTask do
  use Ecto.Schema
  import Ecto.Changeset

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id

  schema "scheduled_tasks" do
    field :label, :string
    field :message, :string
    field :schedule_type, Ecto.Enum, values: [:once, :recurring]
    field :cron_expression, :string
    field :scheduled_at, :utc_datetime
    field :enabled, :boolean, default: true
    field :last_run_at, :utc_datetime

    belongs_to :project, Shire.Projects.Project
    belongs_to :agent, Shire.Agents.Agent

    timestamps(type: :utc_datetime)
  end

  def changeset(task, attrs) do
    task
    |> cast(attrs, [
      :label,
      :message,
      :schedule_type,
      :cron_expression,
      :scheduled_at,
      :enabled,
      :project_id,
      :agent_id,
      :last_run_at
    ])
    |> validate_required([:label, :message, :schedule_type, :project_id, :agent_id])
    |> validate_schedule_fields()
    |> foreign_key_constraint(:project_id)
    |> foreign_key_constraint(:agent_id)
  end

  def mark_run_changeset(task) do
    changes = %{last_run_at: DateTime.utc_now() |> DateTime.truncate(:second)}

    changes =
      if task.schedule_type == :once do
        Map.put(changes, :enabled, false)
      else
        changes
      end

    cast(task, changes, [:last_run_at, :enabled])
  end

  defp validate_schedule_fields(changeset) do
    case get_field(changeset, :schedule_type) do
      :recurring ->
        changeset
        |> validate_required([:cron_expression])
        |> validate_cron_expression()

      :once ->
        changeset
        |> validate_required([:scheduled_at])

      _ ->
        changeset
    end
  end

  defp validate_cron_expression(changeset) do
    case get_field(changeset, :cron_expression) do
      nil ->
        changeset

      expr ->
        case Crontab.CronExpression.Parser.parse(expr) do
          {:ok, _} -> changeset
          {:error, _} -> add_error(changeset, :cron_expression, "is not a valid cron expression")
        end
    end
  end
end
