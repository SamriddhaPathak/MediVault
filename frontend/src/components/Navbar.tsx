import React from "react";
import { Link, NavLink } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";

const links = [
  { to: "/dashboard", label: "Dashboard" },
  { to: "/records", label: "Records" },
  { to: "/images", label: "Image Vault" },
  { to: "/exports", label: "Export" },
  { to: "/profile", label: "Profile" },
];

export default function Navbar() {
  const { user, logout } = useAuth();

  return (
    <header className="sticky top-0 z-20 hidden border-b border-[#dce9e7] bg-[#f8fbfa]/90 backdrop-blur md:block">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-8 py-4">
        <Link to="/dashboard" className="flex items-center gap-3 text-lg font-bold tracking-tight text-[#173b45]">
          <img src="/medivault-cropped.png" alt="MediVault" className="h-12 w-52 object-contain object-left" />
        </Link>
        <nav className="flex items-center gap-1 rounded-2xl border border-[#dce9e7] bg-white/70 p-1" aria-label="Primary">
          {links.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              className={({ isActive }) =>
                `rounded-xl px-3 py-2 text-sm font-semibold ${isActive ? "bg-brand-50 text-brand-800 shadow-sm" : "text-gray-500 hover:bg-gray-50 hover:text-gray-900"}`
              }
            >
              {l.label}
            </NavLink>
          ))}
          <Link
            to="/upload"
            className="ml-2 rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:-translate-y-0.5 hover:bg-brand-700"
          >
            + Upload report
          </Link>
        </nav>
        <div className="flex items-center gap-3">
          <div className="hidden text-right lg:block">
            <p className="text-xs font-bold uppercase tracking-wider text-gray-400">Signed in as</p>
            <span className="text-sm font-semibold text-[#365861]">{user?.email}</span>
          </div>
          <button onClick={() => logout()} className="rounded-xl border border-[#dce9e7] bg-white px-3 py-2 text-sm font-semibold text-gray-500 hover:border-gray-300 hover:text-gray-900">
            Log out
          </button>
        </div>
      </div>
    </header>
  );
}
