import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Toast from "../../src/components/Toast.jsx";

describe("Toast", () => {
  it("renders the message", () => {
    render(<Toast message="Explanation generated successfully!" onClose={() => {}} />);
    expect(screen.getByText("Explanation generated successfully!")).toBeInTheDocument();
  });

  it("calls onClose when the close button is clicked", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<Toast message="Hello" onClose={onClose} />);

    await user.click(screen.getByRole("button"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("auto-dismisses after the given duration", () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    render(<Toast message="Bye" onClose={onClose} duration={1000} />);

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(onClose).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});
