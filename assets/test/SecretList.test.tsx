import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import SecretList from "../react-components/SecretList";

const secrets = [
  { id: 1, key: "ANTHROPIC_API_KEY" },
  { id: 2, key: "OPENAI_API_KEY" },
];

describe("SecretList", () => {
  it("renders empty state when no secrets", () => {
    render(<SecretList secrets={[]} pushEvent={vi.fn()} />);
    expect(screen.getByText(/No secrets yet/)).toBeInTheDocument();
  });

  it("renders secret keys with masked values", () => {
    render(<SecretList secrets={secrets} pushEvent={vi.fn()} />);
    expect(screen.getByText("ANTHROPIC_API_KEY")).toBeInTheDocument();
    expect(screen.getByText("OPENAI_API_KEY")).toBeInTheDocument();
    expect(screen.getAllByText("********")).toHaveLength(2);
  });

  it("opens new secret dialog", async () => {
    render(<SecretList secrets={[]} pushEvent={vi.fn()} />);
    await userEvent.click(screen.getByText("New Secret"));
    expect(screen.getByText("New Secret", { selector: "[role='dialog'] *" })).toBeInTheDocument();
  });

  it("calls pushEvent with create-secret on save", async () => {
    const pushEvent = vi.fn();
    render(<SecretList secrets={[]} pushEvent={pushEvent} />);

    await userEvent.click(screen.getByText("New Secret"));
    const keyInput = await screen.findByLabelText("Key");
    const valueInput = await screen.findByLabelText("Value");
    fireEvent.change(keyInput, { target: { value: "MY_KEY" } });
    fireEvent.change(valueInput, { target: { value: "my-secret-value" } });
    await userEvent.click(screen.getByText("Save Secret"));

    expect(pushEvent).toHaveBeenCalledWith("create-secret", {
      secret: { key: "MY_KEY", value: "my-secret-value" },
    });
  });

  it("calls pushEvent with update-secret when editing", async () => {
    const pushEvent = vi.fn();
    render(<SecretList secrets={secrets} pushEvent={pushEvent} />);

    const editButtons = screen.getAllByText("Edit");
    await userEvent.click(editButtons[0]);

    // Key should be pre-filled
    expect(await screen.findByDisplayValue("ANTHROPIC_API_KEY")).toBeInTheDocument();

    const valueInput = await screen.findByLabelText("Value");
    fireEvent.change(valueInput, { target: { value: "new-value" } });
    await userEvent.click(screen.getByText("Save Secret"));

    expect(pushEvent).toHaveBeenCalledWith("update-secret", {
      id: 1,
      secret: { key: "ANTHROPIC_API_KEY", value: "new-value" },
    });
  });

  it("shows delete confirmation and calls pushEvent on confirm", async () => {
    const pushEvent = vi.fn();
    render(<SecretList secrets={secrets} pushEvent={pushEvent} />);

    const deleteButtons = screen.getAllByText("Delete");
    await userEvent.click(deleteButtons[0]);

    expect(screen.getByText(/Are you sure you want to delete/)).toBeInTheDocument();

    const confirmDelete = screen.getAllByText("Delete").find((el) => el.closest("[role='alertdialog']"));
    await userEvent.click(confirmDelete!);

    expect(pushEvent).toHaveBeenCalledWith("delete-secret", { id: 1 });
  });
});
