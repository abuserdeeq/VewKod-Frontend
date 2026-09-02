import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import HistoryPanel from "../../src/components/HistoryPanel.jsx";

const sampleHistory = [
  {
    id: "1",
    code: "print('hello')",
    language: "python",
    explanation: "## Overview\n\nPrints hello.",
    source: "ai",
    timestamp: new Date().toISOString(),
  },
];

describe("HistoryPanel", () => {
  beforeEach(() => {
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      configurable: true,
      writable: true,
    });
    // Simulate a browser without the Web Share API so the clipboard
    // fallback path is exercised in tests.
    delete navigator.share;
  });

  it("renders nothing when closed", () => {
    render(
      <HistoryPanel
        open={false}
        history={sampleHistory}
        onClose={() => {}}
        onRestore={() => {}}
        onDelete={() => {}}
      />
    );
    expect(screen.queryByText("History")).not.toBeInTheDocument();
  });

  it("shows an empty state when there is no history", () => {
    render(
      <HistoryPanel
        open={true}
        history={[]}
        onClose={() => {}}
        onRestore={() => {}}
        onDelete={() => {}}
      />
    );
    expect(screen.getByText(/no explanations yet/i)).toBeInTheDocument();
  });

  it("lists history items and calls onRestore when one is clicked", async () => {
    const user = userEvent.setup();
    const onRestore = vi.fn();
    render(
      <HistoryPanel
        open={true}
        history={sampleHistory}
        onClose={() => {}}
        onRestore={onRestore}
        onDelete={() => {}}
      />
    );

    const item = screen.getByText("print('hello')");
    await user.click(item);
    expect(onRestore).toHaveBeenCalledWith(sampleHistory[0]);
  });

  it("calls onDelete (not onRestore) when Delete is clicked on an item", async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn();
    const onRestore = vi.fn();
    render(
      <HistoryPanel
        open={true}
        history={sampleHistory}
        onClose={() => {}}
        onRestore={onRestore}
        onDelete={onDelete}
      />
    );

    await user.click(screen.getByRole("button", { name: /delete this history item/i }));
    expect(onDelete).toHaveBeenCalledWith("1");
    expect(onRestore).not.toHaveBeenCalled();
  });

  it("copies a shareable summary to the clipboard when Share is clicked (no Web Share API) without restoring", async () => {
    const user = userEvent.setup();
    const onRestore = vi.fn();
    render(
      <HistoryPanel
        open={true}
        history={sampleHistory}
        onClose={() => {}}
        onRestore={onRestore}
        onDelete={() => {}}
      />
    );

    await user.click(screen.getByRole("button", { name: /share this history item/i }));

    expect(navigator.clipboard.writeText).toHaveBeenCalledTimes(1);
    const sharedText = navigator.clipboard.writeText.mock.calls[0][0];
    expect(sharedText).toContain("print('hello')");
    expect(sharedText).toContain("Prints hello.");
    expect(onRestore).not.toHaveBeenCalled();

    expect(await screen.findByText("Copied")).toBeInTheDocument();
  });

  it("uses the native share sheet when the Web Share API is available", async () => {
    const user = userEvent.setup();
    navigator.share = vi.fn().mockResolvedValue(undefined);

    render(
      <HistoryPanel
        open={true}
        history={sampleHistory}
        onClose={() => {}}
        onRestore={() => {}}
        onDelete={() => {}}
      />
    );

    await user.click(screen.getByRole("button", { name: /share this history item/i }));
    expect(navigator.share).toHaveBeenCalledTimes(1);
    expect(navigator.share.mock.calls[0][0].text).toContain("print('hello')");
  });
});
