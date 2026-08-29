import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import AuthModal from "../../src/components/AuthModal.jsx";

describe("AuthModal", () => {
  it("renders nothing when closed", () => {
    render(<AuthModal open={false} onClose={() => {}} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("opens in Login mode by default", () => {
    render(<AuthModal open={true} onClose={() => {}} />);
    expect(screen.getByRole("dialog", { name: /log in/i })).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/email address/i)).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/full name/i)).not.toBeInTheDocument();
  });

  it("switches to Register mode and shows the extra fields", async () => {
    const user = userEvent.setup();
    render(<AuthModal open={true} onClose={() => {}} />);

    await user.click(screen.getByRole("button", { name: "Register" }));

    expect(screen.getByPlaceholderText(/full name/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/confirm password/i)).toBeInTheDocument();
  });

  it("shows Google and GitHub sign-in options in Register mode", async () => {
    const user = userEvent.setup();
    render(<AuthModal open={true} onClose={() => {}} />);

    await user.click(screen.getByRole("button", { name: "Register" }));

    expect(screen.getByRole("button", { name: /google/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /github/i })).toBeInTheDocument();
  });

  it("shows Google and GitHub sign-in options in Login mode too", () => {
    render(<AuthModal open={true} onClose={() => {}} />);
    expect(screen.getByRole("button", { name: /google/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /github/i })).toBeInTheDocument();
  });

  it("blocks registration when the passwords don't match", async () => {
    const user = userEvent.setup();
    render(<AuthModal open={true} onClose={() => {}} />);

    await user.click(screen.getByRole("button", { name: "Register" }));
    await user.type(screen.getByPlaceholderText(/full name/i), "Ada Lovelace");
    await user.type(screen.getByPlaceholderText(/email address/i), "ada@example.com");
    await user.type(screen.getByPlaceholderText("Password"), "password1");
    await user.type(screen.getByPlaceholderText(/confirm password/i), "password2");
    await user.click(screen.getByRole("button", { name: /create account/i }));

    expect(await screen.findByText(/passwords don't match/i)).toBeInTheDocument();
  });

  it("calls onClose after clicking a social sign-in option", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<AuthModal open={true} onClose={onClose} />);

    await user.click(screen.getByRole("button", { name: /google/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose when the close button is clicked", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<AuthModal open={true} onClose={onClose} />);

    await user.click(screen.getByRole("button", { name: /close/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
