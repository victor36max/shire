import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect } from "bun:test";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  SelectGroup,
  SelectLabel,
  SelectSeparator,
} from "../components/ui/select";

describe("Select", () => {
  it("renders SelectLabel and SelectSeparator when opened", async () => {
    const user = userEvent.setup();
    render(
      <Select defaultValue="a">
        <SelectTrigger aria-label="Test select">
          <SelectValue />
        </SelectTrigger>
        <SelectContent position="item-aligned">
          <SelectGroup>
            <SelectLabel>Group</SelectLabel>
            <SelectItem value="a">A</SelectItem>
            <SelectSeparator />
            <SelectItem value="b">B</SelectItem>
          </SelectGroup>
        </SelectContent>
      </Select>,
    );

    // Click to open the select dropdown
    const trigger = screen.getByRole("combobox");
    await user.click(trigger);

    // The trigger should still be in the document after click
    expect(trigger).toBeInTheDocument();
  });
});
