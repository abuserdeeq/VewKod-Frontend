import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Header from "../../src/components/Header.jsx";

describe("Header", () => {
  it("renders the Vewkod title", () => {
    render(<Header />);
    expect(screen.getByText("Vewkod")).toBeInTheDocument();
  });

  it("does not show a history badge when history is empty", () => {
    render(<Header historyCount={0} onOpenHistory={() => {}} />);
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });

  it("shows a history badge with the count when history has items", () => {
    render(<Header historyCount={3} onOpenHistory={() => {}} />);
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("calls onOpenHistory when the History button is clicked", async () => {
    const user = userEvent.setup();
    const onOpenHistory = vi.fn();
    render(<Header historyCount={2} onOpenHistory={onOpenHistory} />);

    await user.click(screen.getByRole("button", { name: /open explanation history/i }));
    expect(onOpenHistory).toHaveBeenCalledTimes(1);
  });
});
