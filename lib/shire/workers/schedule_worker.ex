defmodule Shire.Workers.ScheduleWorker do
  use Oban.Worker, queue: :scheduled_tasks, max_attempts: 3

  require Logger

  alias Shire.{Repo, Schedules}
  alias Shire.Agents.Message
  alias Shire.Agent.AgentManager

  @impl Oban.Worker
  def perform(%Oban.Job{args: %{"scheduled_task_id" => task_id}}) do
    case Schedules.get_scheduled_task(task_id) do
      nil ->
        :ok

      task ->
        if task.enabled do
          formatted_message =
            "[Scheduled Task: \"#{task.label}\" | #{task.schedule_type}]\n\n#{task.message}"

          case AgentManager.send_message(
                 task.project_id,
                 task.agent_id,
                 formatted_message,
                 :system
               ) do
            {:ok, _msg} ->
              multi =
                Ecto.Multi.new()
                |> Ecto.Multi.insert(
                  :log,
                  Message.changeset(%Message{}, %{
                    project_id: task.project_id,
                    agent_id: task.agent_id,
                    role: "system",
                    content: %{
                      "trigger" => "scheduled_task",
                      "task_label" => task.label,
                      "task_id" => task.id,
                      "text" => task.message,
                      "schedule_type" => to_string(task.schedule_type)
                    }
                  })
                )
                |> Ecto.Multi.update(:mark_run, Schedules.mark_run_changeset(task))

              multi =
                if task.schedule_type == :recurring do
                  Ecto.Multi.run(multi, :reschedule, fn _repo, _changes ->
                    enqueue_recurring(task)
                  end)
                else
                  multi
                end

              case Repo.transaction(multi) do
                {:ok, _} ->
                  Phoenix.PubSub.broadcast(
                    Shire.PubSub,
                    "project:#{task.project_id}:schedules",
                    {:schedule_fired, task.id}
                  )

                {:error, step, reason, _} ->
                  Logger.error(
                    "Scheduled task #{task.label} multi failed at #{step}: #{inspect(reason)}"
                  )
              end

            {:error, reason} ->
              Logger.warning("Scheduled task #{task.label} failed to send: #{inspect(reason)}")

              # Still reschedule recurring tasks so the schedule continues
              if task.schedule_type == :recurring do
                enqueue_recurring(task)
              end
          end
        end

        :ok
    end
  end

  def enqueue(task) do
    case task.schedule_type do
      :recurring -> enqueue_recurring(task)
      :once -> enqueue_once(task)
    end
  end

  def build_job(task) do
    case task.schedule_type do
      :recurring ->
        next_run = Schedules.compute_next_run(task.cron_expression)
        schedule_in = DateTime.diff(next_run, DateTime.utc_now(), :second)
        new(%{"scheduled_task_id" => task.id}, schedule_in: max(schedule_in, 1))

      :once ->
        schedule_in = DateTime.diff(task.scheduled_at, DateTime.utc_now(), :second)
        new(%{"scheduled_task_id" => task.id}, schedule_in: max(schedule_in, 1))
    end
  end

  defp enqueue_recurring(task) do
    next_run = Schedules.compute_next_run(task.cron_expression)
    schedule_in = DateTime.diff(next_run, DateTime.utc_now(), :second)

    %{"scheduled_task_id" => task.id}
    |> new(schedule_in: max(schedule_in, 1))
    |> Oban.insert()
  end

  defp enqueue_once(task) do
    schedule_in = DateTime.diff(task.scheduled_at, DateTime.utc_now(), :second)

    %{"scheduled_task_id" => task.id}
    |> new(schedule_in: max(schedule_in, 1))
    |> Oban.insert()
  end

  def cancel_pending(task_id) do
    Oban.cancel_all_jobs(pending_jobs_query(task_id))
  end

  def pending_jobs_query(task_id) do
    import Ecto.Query
    import Shire.Query

    Oban.Job
    |> where([j], j.worker == "Shire.Workers.ScheduleWorker")
    |> where([j], j.state in ["available", "scheduled"])
    |> where([j], json_text(j.args, "scheduled_task_id") == ^to_string(task_id))
  end
end
