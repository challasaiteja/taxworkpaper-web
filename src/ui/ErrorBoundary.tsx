import { Component, type ReactNode } from 'react';

export class ErrorBoundary extends Component<{ children: ReactNode }, { error?: Error }> {
  state: { error?: Error } = {};

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div role="alert" className="m-6 rounded border border-red-300 bg-red-50 p-4 text-red-800">
        <p className="font-medium">Something in this packet could not be displayed.</p>
        <p className="mt-1 font-mono text-sm">{this.state.error.message}</p>
        <button
          className="mt-3 rounded border border-red-300 px-2 py-1 text-sm hover:bg-red-100"
          onClick={() => {
            window.location.hash = '';
            window.location.reload();
          }}
        >
          Reload with the bundled packet
        </button>
      </div>
    );
  }
}
