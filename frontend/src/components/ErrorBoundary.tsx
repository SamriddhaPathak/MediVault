import React from "react";

interface Props {
  children: React.ReactNode;
}
interface State {
  hasError: boolean;
}

/**
 * Catches render-time exceptions anywhere in the tree below it so a single
 * broken component (a bad date parse, a null-ref on unexpected API shape,
 * etc.) shows a recoverable error screen instead of a blank white page.
 * Previously there was no boundary at all: any uncaught render error
 * white-screened the entire app with nothing in the UI to recover from.
 */
export default class ErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: unknown) {
    // eslint-disable-next-line no-console
    console.error("Unhandled UI error:", error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-gray-50 px-6 text-center">
          <img src="/medivault-cropped.png" alt="MediVault" className="h-12 w-44 object-contain" />
          <p className="text-lg font-semibold text-gray-900">Something went wrong.</p>
          <p className="max-w-sm text-sm text-gray-500">
            We hit an unexpected error displaying this page. Your data is safe – try reloading.
          </p>
          <button
            onClick={() => window.location.reload()}
            className="rounded-lg bg-brand-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-brand-700"
          >
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
