import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, mock } from "bun:test";
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "../components/ai-elements/conversation";

const scrollToBottom = mock(() => {});

// Mock use-stick-to-bottom to control isAtBottom state
mock.module("use-stick-to-bottom", () => ({
  StickToBottom: ({ children, className, ...props }: Record<string, unknown>) => (
    <div className={className as string} {...props}>
      {children as React.ReactNode}
    </div>
  ),
  useStickToBottomContext: () => ({
    isAtBottom: false,
    scrollToBottom,
  }),
}));

// Assign Content sub-component after mock is in place
const stb = await import("use-stick-to-bottom");
(stb.StickToBottom as unknown as Record<string, unknown>).Content = ({
  children,
  className,
  ...props
}: Record<string, unknown>) => (
  <div className={className as string} {...props}>
    {children as React.ReactNode}
  </div>
);

describe("Conversation", () => {
  it("renders children", () => {
    render(
      <Conversation>
        <ConversationContent>
          <p>Message 1</p>
          <p>Message 2</p>
        </ConversationContent>
      </Conversation>,
    );
    expect(screen.getByText("Message 1")).toBeInTheDocument();
    expect(screen.getByText("Message 2")).toBeInTheDocument();
  });

  it("has log role for accessibility", () => {
    const { container } = render(
      <Conversation>
        <ConversationContent>content</ConversationContent>
      </Conversation>,
    );
    expect(container.querySelector('[role="log"]')).toBeInTheDocument();
  });

  it("applies custom className", () => {
    const { container } = render(
      <Conversation className="custom-class">
        <ConversationContent>content</ConversationContent>
      </Conversation>,
    );
    const wrapper = container.querySelector('[role="log"]');
    expect(wrapper?.className).toContain("custom-class");
  });

  it("renders scroll button when not at bottom", () => {
    render(
      <Conversation>
        <ConversationContent>content</ConversationContent>
        <ConversationScrollButton />
      </Conversation>,
    );
    expect(screen.getByRole("button")).toBeInTheDocument();
  });

  it("calls scrollToBottom when scroll button is clicked", async () => {
    const user = userEvent.setup();
    render(
      <Conversation>
        <ConversationContent>content</ConversationContent>
        <ConversationScrollButton />
      </Conversation>,
    );
    await user.click(screen.getByRole("button"));
    expect(scrollToBottom).toHaveBeenCalled();
  });

  it("applies custom className to ConversationContent", () => {
    render(
      <Conversation>
        <ConversationContent className="custom-content">items</ConversationContent>
      </Conversation>,
    );
    expect(screen.getByText("items")).toBeInTheDocument();
    const content = screen.getByText("items").closest("div");
    expect(content?.className).toContain("custom-content");
  });
});
