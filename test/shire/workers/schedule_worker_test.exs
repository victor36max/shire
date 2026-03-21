defmodule Shire.Workers.ScheduleWorkerTest do
  use Shire.DataCase, async: true

  alias Shire.Workers.ScheduleWorker

  describe "module configuration" do
    test "uses the scheduled_tasks queue" do
      job = ScheduleWorker.new(%{"scheduled_task_id" => "test"})
      assert job.changes.queue == "scheduled_tasks"
    end

    test "has max_attempts of 3" do
      job = ScheduleWorker.new(%{"scheduled_task_id" => "test"})
      assert job.changes.max_attempts == 3
    end
  end

  describe "perform/1 with missing task" do
    test "returns :ok when task does not exist" do
      job = %Oban.Job{args: %{"scheduled_task_id" => Ecto.UUID.generate()}}
      assert :ok = ScheduleWorker.perform(job)
    end
  end
end
