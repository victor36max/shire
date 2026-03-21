defmodule Shire.Schedules do
  import Ecto.Query
  alias Shire.Repo
  alias Shire.Schedules.ScheduledTask

  def list_scheduled_tasks(project_id) do
    ScheduledTask
    |> where([t], t.project_id == ^project_id)
    |> order_by([t], desc: t.inserted_at)
    |> preload(:agent)
    |> Repo.all()
  end

  def get_scheduled_task!(id) do
    ScheduledTask
    |> Repo.get!(id)
    |> Repo.preload(:agent)
  end

  def get_scheduled_task(id) do
    case Repo.get(ScheduledTask, id) do
      nil -> nil
      task -> Repo.preload(task, :agent)
    end
  end

  def create_scheduled_task(attrs) do
    changeset = ScheduledTask.changeset(%ScheduledTask{}, attrs)

    multi =
      Ecto.Multi.new()
      |> Ecto.Multi.insert(:task, changeset)
      |> maybe_enqueue_job()

    case Repo.transaction(multi) do
      {:ok, %{task: task}} ->
        {:ok, Repo.preload(task, :agent)}

      {:error, :task, changeset, _} ->
        {:error, changeset}
    end
  end

  def update_scheduled_task(%ScheduledTask{} = task, attrs) do
    changeset = ScheduledTask.changeset(task, attrs)
    Shire.Workers.ScheduleWorker.cancel_pending(task.id)

    multi =
      Ecto.Multi.new()
      |> Ecto.Multi.update(:task, changeset)
      |> maybe_enqueue_job()

    case Repo.transaction(multi) do
      {:ok, %{task: updated_task}} ->
        {:ok, Repo.preload(updated_task, :agent)}

      {:error, :task, changeset, _} ->
        {:error, changeset}
    end
  end

  defp maybe_enqueue_job(multi) do
    Ecto.Multi.run(multi, :enqueue, fn _repo, %{task: task} ->
      if task.enabled do
        Shire.Workers.ScheduleWorker.enqueue(task)
      else
        {:ok, :skipped}
      end
    end)
  end

  def delete_scheduled_task(%ScheduledTask{} = task) do
    Shire.Workers.ScheduleWorker.cancel_pending(task.id)
    Repo.delete(task)
  end

  def toggle_scheduled_task(%ScheduledTask{} = task, enabled) do
    update_scheduled_task(task, %{enabled: enabled})
  end

  def mark_run(%ScheduledTask{} = task) do
    task
    |> ScheduledTask.mark_run_changeset()
    |> Repo.update()
  end

  def mark_run_changeset(%ScheduledTask{} = task) do
    ScheduledTask.mark_run_changeset(task)
  end

  def compute_next_run(cron_expression) do
    {:ok, cron} = Crontab.CronExpression.Parser.parse(cron_expression)
    naive = Crontab.Scheduler.get_next_run_date!(cron)
    DateTime.from_naive!(naive, "Etc/UTC")
  end

  def list_enabled_tasks do
    ScheduledTask
    |> where([t], t.enabled == true)
    |> preload(:agent)
    |> Repo.all()
  end

  def ensure_jobs_enqueued do
    enabled_tasks = list_enabled_tasks()

    Enum.each(enabled_tasks, fn task ->
      # Check if there's already a pending job for this task
      import Ecto.Query

      pending_count =
        Oban.Job
        |> where([j], j.worker == "Shire.Workers.ScheduleWorker")
        |> where([j], j.state in ["available", "scheduled"])
        |> where([j], fragment("?->>'scheduled_task_id' = ?", j.args, ^to_string(task.id)))
        |> Repo.aggregate(:count)

      if pending_count == 0 do
        Shire.Workers.ScheduleWorker.enqueue(task)
      end
    end)
  end
end
