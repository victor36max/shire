import { screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import ConnectionBanner from "../components/ConnectionBanner";
import { renderWithProviders } from "./test-utils";

let mockConnectionState = "connected";

vi.mock("../lib/ws", () => ({
  useConnectionState: () => mockConnectionState,
}));

describe("ConnectionBanner", () => {
  beforeEach(() => {
    mockConnectionState = "connected";
  });

  it("renders nothing when connected", () => {
    const { container } = renderWithProviders(<ConnectionBanner />);
    expect(container.querySelector("[role=status]")).not.toBeInTheDocument();
  });

  it("shows reconnecting message when connecting", () => {
    mockConnectionState = "connecting";
    renderWithProviders(<ConnectionBanner />);
    expect(screen.getByRole("status")).toHaveTextContent("Reconnecting...");
  });

  it("shows connection lost message when disconnected", () => {
    mockConnectionState = "disconnected";
    renderWithProviders(<ConnectionBanner />);
    expect(screen.getByRole("status")).toHaveTextContent("Connection lost");
  });
});
