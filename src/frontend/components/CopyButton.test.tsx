import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, beforeEach, mock } from "bun:test";
import { CopyButton } from "../components/CopyButton";
import { renderWithProviders } from "../test/test-utils";

const writeTextMock = mock(() => Promise.resolve());
const toastSuccessMock = mock(() => {});
const toastErrorMock = mock(() => {});

mock.module("sonner", () => ({
  toast: {
    success: toastSuccessMock,
    error: toastErrorMock,
  },
}));

beforeEach(() => {
  writeTextMock.mockClear();
  toastSuccessMock.mockClear();
  toastErrorMock.mockClear();
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText: writeTextMock },
    writable: true,
    configurable: true,
  });
});

describe("CopyButton", () => {
  it("renders copy button with correct aria-label", () => {
    renderWithProviders(<CopyButton text="hello" />);
    expect(screen.getByLabelText("Copy message")).toBeInTheDocument();
  });

  it("calls clipboard.writeText on click", async () => {
    renderWithProviders(<CopyButton text="hello world" />);
    await userEvent.click(screen.getByLabelText("Copy message"));
    expect(writeTextMock).toHaveBeenCalledWith("hello world");
  });

  it("shows success toast after copy", async () => {
    renderWithProviders(<CopyButton text="hello" />);
    await userEvent.click(screen.getByLabelText("Copy message"));
    expect(toastSuccessMock).toHaveBeenCalledWith("Copied to clipboard");
  });

  it("shows error toast on clipboard failure", async () => {
    writeTextMock.mockImplementation(() => Promise.reject(new Error("denied")));
    renderWithProviders(<CopyButton text="hello" />);
    await userEvent.click(screen.getByLabelText("Copy message"));
    expect(toastErrorMock).toHaveBeenCalledWith("Failed to copy");
  });
});
