import { Component } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";

// Class component is required here — React error boundaries can only be
// implemented with getDerivedStateFromError / componentDidCatch, which
// have no hook equivalent yet.
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, errorInfo) {
    if (import.meta.env.DEV) {
      console.error("VewKod crashed:", error, errorInfo);
    }
  }

  handleReload = () => {
    this.setState({ hasError: false });
    window.location.reload();
  };

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <div className="min-h-screen bg-[#0f172a] flex items-center justify-center px-4">
        <div className="max-w-md w-full text-center p-8 rounded-2xl bg-[#1e293b] border border-slate-700/40">
          <div className="w-14 h-14 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center justify-center mx-auto mb-5">
            <AlertTriangle className="w-7 h-7 text-red-400" />
          </div>
          <h1 className="text-lg font-semibold text-white mb-2">
            Something went wrong
          </h1>
          <p className="text-sm text-slate-400 mb-6">
            VewKod ran into an unexpected error. Reloading usually fixes it —
            your saved history is kept.
          </p>
          <button
            onClick={this.handleReload}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-500 hover:to-cyan-500 text-white text-sm font-medium transition-all"
          >
            <RotateCcw className="w-4 h-4" />
            Reload App
          </button>
        </div>
      </div>
    );
  }
}
