import React from "react";

export default function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="rounded-2xl border border-red-100 bg-[#fff8f7] p-7 text-center shadow-sm">
      <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-red-100 text-lg text-red-700" aria-hidden="true">!</div>
      <p className="text-sm font-semibold text-red-800">{message}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="mt-3 rounded-lg border border-red-200 bg-white px-4 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50"
        >
          Try again
        </button>
      )}
    </div>
  );
}
