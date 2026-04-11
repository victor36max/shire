import { describe, it, expect } from "bun:test";
import { bus, type SharedDriveBusEvent } from "./events";

describe("SharedDriveBusEvent", () => {
  it("can emit and receive file_changed events", () => {
    const received: SharedDriveBusEvent[] = [];
    const unsub = bus.on<SharedDriveBusEvent>("project:test:shared-drive", (event) => {
      received.push(event);
    });

    bus.emit<SharedDriveBusEvent>("project:test:shared-drive", {
      type: "file_changed",
      payload: { path: "/readme.md" },
    });

    expect(received).toHaveLength(1);
    expect(received[0].type).toBe("file_changed");
    expect(received[0].payload.path).toBe("/readme.md");

    unsub();
  });
});
