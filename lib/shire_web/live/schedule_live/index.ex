defmodule ShireWeb.ScheduleLive.Index do
  use ShireWeb, :live_view

  alias Shire.Projects
  alias Shire.Schedules
  alias Shire.Agent.{AgentManager, Coordinator}
  alias Shire.ProjectManager

  @impl true
  def mount(%{"project_name" => project_name}, _session, socket) do
    project = Projects.get_project_by_name!(project_name)
    project_id = project.id

    case ProjectManager.lookup_coordinator(project_id) do
      {:error, :not_found} ->
        {:ok, socket |> put_flash(:error, "Project not found") |> redirect(to: ~p"/")}

      {:ok, _pid} ->
        if connected?(socket) do
          Phoenix.PubSub.subscribe(Shire.PubSub, "project:#{project_id}:schedules")
        end

        tasks = Schedules.list_scheduled_tasks(project_id)
        agents = Coordinator.list_agents(project_id)

        {:ok,
         assign(socket,
           project: %{id: project.id, name: project.name},
           tasks: serialize_tasks(tasks),
           agents: serialize_agents(agents)
         )}
    end
  end

  @impl true
  def handle_params(_params, _url, socket) do
    {:noreply, assign(socket, :page_title, "Schedules")}
  end

  @impl true
  def handle_event("create-schedule", params, socket) do
    attrs =
      params
      |> Map.put("project_id", socket.assigns.project.id)
      |> cast_schedule_type()

    case Schedules.create_scheduled_task(attrs) do
      {:ok, _task} ->
        tasks = Schedules.list_scheduled_tasks(socket.assigns.project.id)

        {:noreply,
         socket |> assign(:tasks, serialize_tasks(tasks)) |> put_flash(:info, "Schedule created")}

      {:error, changeset} ->
        {:noreply, put_flash(socket, :error, format_errors(changeset))}
    end
  end

  @impl true
  def handle_event("update-schedule", %{"id" => id} = params, socket) do
    task = Schedules.get_scheduled_task!(id)
    attrs = cast_schedule_type(params)

    case Schedules.update_scheduled_task(task, attrs) do
      {:ok, _task} ->
        tasks = Schedules.list_scheduled_tasks(socket.assigns.project.id)

        {:noreply,
         socket |> assign(:tasks, serialize_tasks(tasks)) |> put_flash(:info, "Schedule updated")}

      {:error, changeset} ->
        {:noreply, put_flash(socket, :error, format_errors(changeset))}
    end
  end

  @impl true
  def handle_event("delete-schedule", %{"id" => id}, socket) do
    task = Schedules.get_scheduled_task!(id)

    case Schedules.delete_scheduled_task(task) do
      {:ok, _task} ->
        tasks = Schedules.list_scheduled_tasks(socket.assigns.project.id)

        {:noreply,
         socket |> assign(:tasks, serialize_tasks(tasks)) |> put_flash(:info, "Schedule deleted")}

      {:error, _reason} ->
        {:noreply, put_flash(socket, :error, "Failed to delete schedule")}
    end
  end

  @impl true
  def handle_event("toggle-schedule", %{"id" => id, "enabled" => enabled}, socket) do
    task = Schedules.get_scheduled_task!(id)

    case Schedules.toggle_scheduled_task(task, enabled) do
      {:ok, _task} ->
        tasks = Schedules.list_scheduled_tasks(socket.assigns.project.id)
        {:noreply, assign(socket, :tasks, serialize_tasks(tasks))}

      {:error, _reason} ->
        {:noreply, put_flash(socket, :error, "Failed to toggle schedule")}
    end
  end

  @impl true
  def handle_event("run-now", %{"id" => id}, socket) do
    task = Schedules.get_scheduled_task!(id)

    formatted_message =
      "[Scheduled Task: \"#{task.label}\" | #{task.schedule_type}]\n\n#{task.message}"

    case AgentManager.send_message(task.project_id, task.agent_id, formatted_message, :system) do
      {:ok, _sent} ->
        Ecto.Multi.new()
        |> Ecto.Multi.insert(
          :log,
          Shire.Agents.Message.changeset(%Shire.Agents.Message{}, %{
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
        |> Shire.Repo.transaction()

        tasks = Schedules.list_scheduled_tasks(socket.assigns.project.id)

        {:noreply,
         socket
         |> assign(:tasks, serialize_tasks(tasks))
         |> put_flash(:info, "Schedule triggered")}

      {:error, reason} ->
        {:noreply, put_flash(socket, :error, "Failed to run: #{inspect(reason)}")}
    end
  end

  @impl true
  def handle_info({:schedule_fired, _task_id}, socket) do
    tasks = Schedules.list_scheduled_tasks(socket.assigns.project.id)
    {:noreply, assign(socket, :tasks, serialize_tasks(tasks))}
  end

  @impl true
  def render(assigns) do
    ~H"""
    <.react
      name="SchedulesPage"
      project={@project}
      tasks={@tasks}
      agents={@agents}
      socket={@socket}
    />
    """
  end

  defp serialize_tasks(tasks) do
    Enum.map(tasks, fn task ->
      %{
        id: task.id,
        label: task.label,
        agent_id: task.agent_id,
        agent_name: task.agent.name,
        message: task.message,
        schedule_type: to_string(task.schedule_type),
        cron_expression: task.cron_expression,
        scheduled_at: task.scheduled_at && DateTime.to_iso8601(task.scheduled_at),
        enabled: task.enabled,
        last_run_at: task.last_run_at && DateTime.to_iso8601(task.last_run_at)
      }
    end)
  end

  defp serialize_agents(agents) do
    Enum.map(agents, fn agent ->
      %{id: agent.id, name: agent.name}
    end)
  end

  defp cast_schedule_type(params) do
    case params["schedule_type"] do
      type when type in ["once", "recurring"] ->
        Map.put(params, "schedule_type", String.to_existing_atom(type))

      _ ->
        params
    end
  end

  defp format_errors(changeset) do
    Ecto.Changeset.traverse_errors(changeset, fn {msg, opts} ->
      Regex.replace(~r"%{(\w+)}", msg, fn _, key ->
        opts |> Keyword.get(String.to_existing_atom(key), key) |> to_string()
      end)
    end)
    |> Enum.map_join(", ", fn {field, errors} ->
      "#{field}: #{Enum.join(errors, ", ")}"
    end)
  end
end
