import React from "react";
import { useNavigate } from "react-router-dom";

interface Props {
  title: string;
  subtitle?: string;
  backTo?: string;
  actions?: React.ReactNode;
}

/**
 * Consistent page header with an explicit "back" affordance. Sub-pages
 * (Review, Record Detail) previously relied entirely on the browser's
 * back button with no in-app way to tell where "back" would go, which
 * left users unsure how to navigate out of a deep screen.
 */
export default function PageHeader({ title, subtitle, backTo, actions }: Props) {
  const navigate = useNavigate();
  return (
    <div className="mb-7 flex flex-wrap items-start justify-between gap-3">
      <div className="flex items-start gap-2">
        {backTo && (
          <button
            onClick={() => navigate(backTo)}
            aria-label="Go back"
            className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-xl border border-[#dce9e7] bg-white text-gray-500 shadow-sm hover:bg-gray-50"
          >
            <span aria-hidden="true">{"\u2190"}</span>
          </button>
        )}
        <div>
          <p className="eyebrow mb-1">MediVault</p>
          <h1 className="text-2xl font-bold tracking-tight text-[#173b45]">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-gray-500">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}
