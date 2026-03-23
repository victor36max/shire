defmodule Shire.SchedulesTest do
  use Shire.DataCase, async: true
  use Oban.Testing, repo: Shire.Repo

  import Mox

  alias Shire.Schedules
  alias Shire.Schedules.ScheduledTask
  alias Shire.Agents
  alias Shire.Projects

  @vm Shire.VirtualMachineStub

  setup :set_mox_from_context

  setup do
    stub(Shire.VirtualMachineMock, :workspace_root, fn _project_id -> "/workspace" end)
    stub(Shire.VirtualMachineMock, :vm_status, fn _project_id -> :running end)

    {:ok, project} = Projects.create_project("schedule-project")
    {:ok, agent} = Agents.create_agent_with_vm(project.id, "sched-agent", "version: 1\n", @vm)

    %{project: project, agent: agent}
  end

  # Helper to insert a task directly, bypassing the Oban enqueue side-effect
  defp insert_task!(attrs) do
    %ScheduledTask{}
    |> ScheduledTask.changeset(attrs)
    |> Repo.insert!()
    |> Repo.preload(:agent)
  end

  describe "create_scheduled_task/1" do
    test "with valid recurring attrs", %{project: project, agent: agent} do
      attrs = %{
        label: "Daily check",
        message: "Run daily check",
        schedule_type: :recurring,
        cron_expression: "0 9 * * *",
        project_id: project.id,
        agent_id: agent.id
      }

      Oban.Testing.with_testing_mode(:manual, fn ->
        assert {:ok, task} = Schedules.create_scheduled_task(attrs)
        assert task.label == "Daily check"
        assert task.message == "Run daily check"
        assert task.schedule_type == :recurring
        assert task.cron_expression == "0 9 * * *"
        assert task.enabled == true
        assert task.project_id == project.id
        assert task.agent_id == agent.id
      end)
    end

    test "with valid once attrs", %{project: project, agent: agent} do
      scheduled_at = DateTime.utc_now() |> DateTime.add(3600) |> DateTime.truncate(:second)

      attrs = %{
        label: "One-time reminder",
        message: "Do this once",
        schedule_type: :once,
        scheduled_at: scheduled_at,
        project_id: project.id,
        agent_id: agent.id
      }

      Oban.Testing.with_testing_mode(:manual, fn ->
        assert {:ok, task} = Schedules.create_scheduled_task(attrs)
        assert task.label == "One-time reminder"
        assert task.schedule_type == :once
        assert task.scheduled_at == scheduled_at
      end)
    end

    test "with invalid cron expression", %{project: project, agent: agent} do
      attrs = %{
        label: "Bad cron",
        message: "Will fail",
        schedule_type: :recurring,
        cron_expression: "not a cron",
        project_id: project.id,
        agent_id: agent.id
      }

      assert {:error, changeset} = Schedules.create_scheduled_task(attrs)
      assert "is not a valid cron expression" in errors_on(changeset).cron_expression
    end

    test "with missing required fields" do
      assert {:error, changeset} = Schedules.create_scheduled_task(%{})
      errors = errors_on(changeset)
      assert "can't be blank" in errors.label
      assert "can't be blank" in errors.message
      assert "can't be blank" in errors.schedule_type
      assert "can't be blank" in errors.project_id
      assert "can't be blank" in errors.agent_id
    end

    test "recurring without cron_expression fails", %{project: project, agent: agent} do
      attrs = %{
        label: "Missing cron",
        message: "Should fail",
        schedule_type: :recurring,
        project_id: project.id,
        agent_id: agent.id
      }

      assert {:error, changeset} = Schedules.create_scheduled_task(attrs)
      assert "can't be blank" in errors_on(changeset).cron_expression
    end

    test "once without scheduled_at fails", %{project: project, agent: agent} do
      attrs = %{
        label: "Missing time",
        message: "Should fail",
        schedule_type: :once,
        project_id: project.id,
        agent_id: agent.id
      }

      assert {:error, changeset} = Schedules.create_scheduled_task(attrs)
      assert "can't be blank" in errors_on(changeset).scheduled_at
    end
  end

  describe "list_scheduled_tasks/1" do
    test "returns tasks for a project", %{project: project, agent: agent} do
      insert_task!(%{
        label: "Task A",
        message: "do A",
        schedule_type: :recurring,
        cron_expression: "0 * * * *",
        project_id: project.id,
        agent_id: agent.id
      })

      insert_task!(%{
        label: "Task B",
        message: "do B",
        schedule_type: :recurring,
        cron_expression: "30 * * * *",
        project_id: project.id,
        agent_id: agent.id
      })

      tasks = Schedules.list_scheduled_tasks(project.id)
      assert length(tasks) == 2
      labels = Enum.map(tasks, & &1.label)
      assert "Task A" in labels
      assert "Task B" in labels
    end

    test "does not return tasks from other projects", %{project: project, agent: agent} do
      {:ok, other_project} = Projects.create_project("other-project")

      insert_task!(%{
        label: "My task",
        message: "mine",
        schedule_type: :recurring,
        cron_expression: "0 * * * *",
        project_id: project.id,
        agent_id: agent.id
      })

      tasks = Schedules.list_scheduled_tasks(other_project.id)
      assert tasks == []
    end
  end

  describe "update_scheduled_task/2" do
    test "updates a task", %{project: project, agent: agent} do
      task =
        insert_task!(%{
          label: "Original",
          message: "original msg",
          schedule_type: :recurring,
          cron_expression: "0 * * * *",
          project_id: project.id,
          agent_id: agent.id
        })

      Oban.Testing.with_testing_mode(:manual, fn ->
        assert {:ok, updated} = Schedules.update_scheduled_task(task, %{label: "Updated"})
        assert updated.label == "Updated"
        assert updated.message == "original msg"
      end)
    end
  end

  describe "delete_scheduled_task/1" do
    test "deletes a task", %{project: project, agent: agent} do
      task =
        insert_task!(%{
          label: "Delete me",
          message: "bye",
          schedule_type: :recurring,
          cron_expression: "0 * * * *",
          project_id: project.id,
          agent_id: agent.id
        })

      assert {:ok, _} = Schedules.delete_scheduled_task(task)
      assert Schedules.get_scheduled_task(task.id) == nil
    end
  end

  describe "toggle_scheduled_task/2" do
    test "toggles enabled to false", %{project: project, agent: agent} do
      task =
        insert_task!(%{
          label: "Toggle me",
          message: "toggle",
          schedule_type: :recurring,
          cron_expression: "0 * * * *",
          project_id: project.id,
          agent_id: agent.id,
          enabled: true
        })

      Oban.Testing.with_testing_mode(:manual, fn ->
        assert {:ok, toggled} = Schedules.toggle_scheduled_task(task, false)
        assert toggled.enabled == false
      end)
    end

    test "toggles enabled to true", %{project: project, agent: agent} do
      task =
        insert_task!(%{
          label: "Toggle me",
          message: "toggle",
          schedule_type: :recurring,
          cron_expression: "0 * * * *",
          project_id: project.id,
          agent_id: agent.id,
          enabled: false
        })

      Oban.Testing.with_testing_mode(:manual, fn ->
        assert {:ok, toggled} = Schedules.toggle_scheduled_task(task, true)
        assert toggled.enabled == true
      end)
    end
  end

  describe "mark_run/1" do
    test "sets last_run_at", %{project: project, agent: agent} do
      task =
        insert_task!(%{
          label: "Run me",
          message: "run",
          schedule_type: :recurring,
          cron_expression: "0 * * * *",
          project_id: project.id,
          agent_id: agent.id
        })

      assert is_nil(task.last_run_at)
      assert {:ok, updated} = Schedules.mark_run(task)
      assert updated.last_run_at != nil
      assert updated.enabled == true
    end

    test "disables one-shot tasks", %{project: project, agent: agent} do
      scheduled_at = DateTime.utc_now() |> DateTime.add(3600) |> DateTime.truncate(:second)

      task =
        insert_task!(%{
          label: "Once only",
          message: "once",
          schedule_type: :once,
          scheduled_at: scheduled_at,
          project_id: project.id,
          agent_id: agent.id,
          enabled: true
        })

      assert {:ok, updated} = Schedules.mark_run(task)
      assert updated.last_run_at != nil
      assert updated.enabled == false
    end
  end

  describe "compute_next_run/1" do
    test "returns a future DateTime" do
      next_run = Schedules.compute_next_run("0 * * * *")
      assert %DateTime{} = next_run
      assert DateTime.compare(next_run, DateTime.utc_now()) == :gt
    end

    test "returns a DateTime for a specific cron" do
      next_run = Schedules.compute_next_run("30 9 * * 1")
      assert %DateTime{} = next_run
      assert DateTime.compare(next_run, DateTime.utc_now()) == :gt
    end
  end
end
