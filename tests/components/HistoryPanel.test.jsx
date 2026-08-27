import { describe, it, expect, vi } from "vitest";
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
  it("renders nothing when closed", () => {
    render(
      <HistoryPanel
        open={false}
        history={sampleHistory}
        onClose={() => {}}
        onRestore={() => {}}
        onDelete={() => {}}
        onClearAll={() => {}}
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
        onClearAll={() => {}}
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
        onClearAll={() => {}}
      />
    );

    const item = screen.getByText("print('hello')");
    await user.click(item);
    expect(onRestore).toHaveBeenCalledWith(sampleHistory[0]);
  });

  it("calls onClearAll when Clear all history is clicked", async () => {
    const user = userEvent.setup();
    const onClearAll = vi.fn();
    render(
      <HistoryPanel
        open={true}
        history={sampleHistory}
        onClose={() => {}}
        onRestore={() => {}}
        onDelete={() => {}}
        onClearAll={onClearAll}
      />
    );

    await user.click(screen.getByText(/clear all history/i));
    expect(onClearAll).toHaveBeenCalledTimes(1);
  });
});
