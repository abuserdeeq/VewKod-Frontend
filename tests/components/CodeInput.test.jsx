import { createRef } from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import CodeInput from "../../src/components/CodeInput.jsx";

describe("CodeInput", () => {
  it("renders the editor placeholder", () => {
    render(<CodeInput onExplain={() => {}} onCancel={() => {}} loading={false} />);
    expect(screen.getByPlaceholderText(/paste your code here/i)).toBeInTheDocument();
  });

  it("disables the submit button when there is no code", () => {
    render(<CodeInput onExplain={() => {}} onCancel={() => {}} loading={false} />);
    expect(screen.getByRole("button", { name: /explain this code/i })).toBeDisabled();
  });

  it("enables the submit button once code is entered, and calls onExplain with it", async () => {
    const user = userEvent.setup();
    const onExplain = vi.fn();
    render(<CodeInput onExplain={onExplain} onCancel={() => {}} loading={false} />);

    const editor = screen.getByPlaceholderText(/paste your code here/i);
    await user.type(editor, "print(1)");

    const submitButton = screen.getByRole("button", { name: /explain this code/i });
    expect(submitButton).toBeEnabled();

    await user.click(submitButton);
    expect(onExplain).toHaveBeenCalledWith("print(1)", "python");
  });

  it("shows a Cancel button instead of Explain while loading, and calls onCancel", async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    render(<CodeInput onExplain={() => {}} onCancel={onCancel} loading={true} />);

    expect(screen.queryByRole("button", { name: /explain this code/i })).not.toBeInTheDocument();
    const cancelButton = screen.getByRole("button", { name: /cancel/i });
    await user.click(cancelButton);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("exposes loadSnippet via ref to restore a past snippet into the editor", async () => {
    const ref = createRef();
    render(<CodeInput ref={ref} onExplain={() => {}} onCancel={() => {}} loading={false} />);

    act(() => {
      ref.current.loadSnippet("console.log('hi')", "javascript");
    });

    const editor = await screen.findByDisplayValue("console.log('hi')");
    expect(editor).toBeInTheDocument();
  });
});
