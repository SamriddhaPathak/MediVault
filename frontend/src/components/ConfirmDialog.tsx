import React, { useEffect, useRef } from "react";

interface Props {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Accessible modal confirmation dialog. Replaces window.confirm(), which
 * blocks the JS event loop, cannot be styled to match the app, and is not
 * reliably announced by screen readers the way a proper dialog role is.
 */
export default function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "Confirm",
  destructive,
  onConfirm,
  onCancel,
}: Props) {
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (open) confirmRef.current?.focus();
  }, [open]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    if (open) document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
      aria-describedby="confirm-dialog-description"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="confirm-dialog-title" className="text-base font-semibold text-gray-900">
          {title}
        </h2>
        <p id="confirm-dialog-description" className="mt-1.5 text-sm text-gray-500">
          {description}
        </p>
        <div className="mt-5 flex gap-3">
          <button
            onClick={onCancel}
            className="flex-1 rounded-lg border border-gray-300 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            ref={confirmRef}
            onClick={onConfirm}
            className={`flex-1 rounded-lg py-2.5 text-sm font-medium text-white ${
              destructive ? "bg-red-600 hover:bg-red-700" : "bg-brand-600 hover:bg-brand-700"
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
