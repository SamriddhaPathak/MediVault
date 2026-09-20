import React from "react";
import { NavLink } from "react-router-dom";

const items = [
  { to: "/dashboard", label: "Home", icon: "⌂" },
  { to: "/records", label: "Records", icon: "▤" },
  { to: "/upload", label: "+", icon: "+", primary: true },
  { to: "/images", label: "Images", icon: "▧" },
  { to: "/profile", label: "Profile", icon: "◉" },
];

export default function MobileNav() {
  return (
    <div className="fixed bottom-0 left-0 right-0 z-20 md:hidden">
      <div className="flex justify-center pb-1">
        <img src="/medivault-cropped.png" alt="MediVault" className="h-7 w-32 object-contain rounded bg-white/80 px-1" />
      </div>
      <nav
      className="flex border-t border-[#dce9e7] bg-[#f8fbfa]/95 shadow-[0_-8px_24px_rgba(28,65,68,0.08)] backdrop-blur"
      style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
      aria-label="Primary"
    >
      {items.map((item) =>
        item.primary ? (
          <NavLink
            key={item.to}
            to={item.to}
            className="flex flex-1 items-center justify-center py-2"
            aria-label="Upload Report"
          >
            <span className="flex h-12 w-12 -translate-y-3 items-center justify-center rounded-2xl bg-brand-600 text-2xl font-light text-white shadow-lg shadow-brand-600/30">
              +
            </span>
          </NavLink>
        ) : (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
                `flex flex-1 flex-col items-center justify-center gap-0.5 py-2 text-[11px] font-semibold ${
                isActive ? "text-brand-700" : "text-gray-400"
              }`
            }
          >
            <span className="text-lg leading-5" aria-hidden="true">
              {item.icon}
            </span>
            {item.label}
          </NavLink>
        )
      )}
      </nav>
    </div>
  );
}
