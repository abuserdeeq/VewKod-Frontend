import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ResultDisplay from "../../src/components/ResultDisplay.jsx";

describe("ResultDisplay", () => {
  beforeEach(() => {
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
    delete navigator.share;
  });

  it("renders nothing when there is no result", () => {
    const { container } = render(<ResultDisplay result="" source="ai" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders markdown content", () => {
    render(<ResultDisplay result={"## Overview\n\nThis explains the code."} source="ai" />);
    expect(screen.getByText("Overview")).toBeInTheDocument();
    expect(screen.getByText("This explains the code.")).toBeInTheDocument();
  });

  it("shows the AI badge when source is ai, and Local badge when source is local", () => {
    const { rerender } = render(<ResultDisplay result="Some text" source="ai" />);
    expect(screen.getByText("AI")).toBeInTheDocument();

    rerender(<ResultDisplay result="Some text" source="local" />);
    expect(screen.getByText("Local")).toBeInTheDocument();
  });

  it("copies the result to the clipboard when Copy is clicked", async () => {
    const user = userEvent.setup();
    render(<ResultDisplay result="Some explanation text" source="ai" />);

    await user.click(screen.getByRole("button", { name: /^copy$/i }));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("Some explanation text");
    expect(await screen.findByText("Copied")).toBeInTheDocument();
  });

  it("copies a shareable version to the clipboard when Share is clicked (no Web Share API)", async () => {
    const user = userEvent.setup();
    render(<ResultDisplay result="Some explanation text" source="ai" />);

    await user.click(screen.getByRole("button", { name: /share this explanation/i }));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      "Vewkod code explanation:\n\nSome explanation text"
    );
  });

  it("uses the native share sheet when the Web Share API is available", async () => {
    const user = userEvent.setup();
    navigator.share = vi.fn().mockResolvedValue(undefined);
    render(<ResultDisplay result="Some explanation text" source="ai" />);

    await user.click(screen.getByRole("button", { name: /share this explanation/i }));
    expect(navigator.share).toHaveBeenCalledWith({
      title: "Vewkod explanation",
      text: "Vewkod code explanation:\n\nSome explanation text",
    });
    expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
  });

  it("calls onClear when the Clear button is clicked, and hides Clear when no handler is given", async () => {
    const user = userEvent.setup();
    const onClear = vi.fn();
    const { rerender } = render(
      <ResultDisplay result="Some explanation text" source="ai" onClear={onClear} />
    );

    await user.click(screen.getByRole("button", { name: /clear this explanation/i }));
    expect(onClear).toHaveBeenCalledTimes(1);

    rerender(<ResultDisplay result="Some explanation text" source="ai" />);
    expect(screen.queryByRole("button", { name: /clear this explanation/i })).not.toBeInTheDocument();
  });
});
