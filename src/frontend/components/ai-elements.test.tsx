import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect } from "bun:test";
import {
  Message,
  MessageContent,
  MessageActions,
  MessageAction,
} from "../components/ai-elements/message";
import { Shimmer } from "../components/ai-elements/shimmer";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "../components/ui/collapsible";
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "../components/ui/tooltip";

describe("Message", () => {
  it("renders user message with correct alignment", () => {
    const { container } = render(
      <Message from="user">
        <MessageContent>Hello</MessageContent>
      </Message>,
    );
    const wrapper = container.firstElementChild;
    expect(wrapper?.className).toContain("is-user");
    expect(wrapper?.className).toContain("ml-auto");
  });

  it("renders agent message with assistant class", () => {
    const { container } = render(
      <Message from="agent">
        <MessageContent>Hi there</MessageContent>
      </Message>,
    );
    const wrapper = container.firstElementChild;
    expect(wrapper?.className).toContain("is-assistant");
  });

  it("renders message content", () => {
    render(
      <Message from="assistant">
        <MessageContent>Test content</MessageContent>
      </Message>,
    );
    expect(screen.getByText("Test content")).toBeInTheDocument();
  });

  it("renders message actions", () => {
    render(
      <Message from="assistant">
        <MessageContent>Hello</MessageContent>
        <MessageActions>
          <span>action item</span>
        </MessageActions>
      </Message>,
    );
    expect(screen.getByText("action item")).toBeInTheDocument();
  });

  it("renders MessageAction as button", () => {
    render(
      <Message from="assistant">
        <MessageAction label="Copy">Copy</MessageAction>
      </Message>,
    );
    expect(screen.getByRole("button", { name: /Copy/ })).toBeInTheDocument();
  });

  it("renders MessageAction with tooltip", () => {
    render(
      <Message from="assistant">
        <MessageAction tooltip="Copy text">Icon</MessageAction>
      </Message>,
    );
    expect(screen.getByText("Icon")).toBeInTheDocument();
  });
});

describe("Shimmer", () => {
  it("renders children text", () => {
    render(<Shimmer>Loading...</Shimmer>);
    expect(screen.getByText("Loading...")).toBeInTheDocument();
  });

  it("applies shimmer animation class", () => {
    const { container } = render(<Shimmer duration={1.5}>Test</Shimmer>);
    const el = container.firstElementChild as HTMLElement;
    expect(el?.className).toContain("animate-[shimmer");
    expect(el?.style.getPropertyValue("--shimmer-duration")).toBe("1.5s");
  });

  it("renders as different element types", () => {
    const { container } = render(<Shimmer as="p">Paragraph</Shimmer>);
    expect(container.querySelector("p")).toBeInTheDocument();
  });
});

describe("Collapsible", () => {
  it("renders with trigger and content", async () => {
    const user = userEvent.setup();
    render(
      <Collapsible>
        <CollapsibleTrigger>Toggle</CollapsibleTrigger>
        <CollapsibleContent>Hidden content</CollapsibleContent>
      </Collapsible>,
    );
    expect(screen.getByText("Toggle")).toBeInTheDocument();
    await user.click(screen.getByText("Toggle"));
    expect(screen.getByText("Hidden content")).toBeInTheDocument();
  });
});

describe("Tooltip", () => {
  it("renders tooltip trigger", () => {
    render(
      <Tooltip>
        <TooltipTrigger>Hover me</TooltipTrigger>
        <TooltipContent>Tooltip text</TooltipContent>
      </Tooltip>,
    );
    expect(screen.getByText("Hover me")).toBeInTheDocument();
  });

  it("renders with provider", () => {
    render(
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger>Button</TooltipTrigger>
          <TooltipContent>Info</TooltipContent>
        </Tooltip>
      </TooltipProvider>,
    );
    expect(screen.getByText("Button")).toBeInTheDocument();
  });
});
