import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import Loader from "../../src/components/Loader.jsx";

describe("Loader", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows the analyzing message immediately", () => {
    render(<Loader />);
    expect(screen.getByText(/analyzing your code/i)).toBeInTheDocument();
  });

  it("does not show the slow-fallback hint right away", () => {
    render(<Loader />);
    expect(screen.queryByText(/fall back to the local/i)).not.toBeInTheDocument();
  });

  it("shows the slow-fallback hint after the delay", () => {
    render(<Loader />);
    act(() => {
      vi.advanceTimersByTime(4000);
    });
    expect(screen.getByText(/fall back to the local/i)).toBeInTheDocument();
  });
});
