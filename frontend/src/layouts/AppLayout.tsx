import React from "react";
import { Outlet } from "react-router-dom";
import Navbar from "../components/Navbar";
import MobileNav from "../components/MobileNav";

export default function AppLayout() {
  return (
    <div className="min-h-screen">
      <Navbar />
      <main className="mx-auto max-w-7xl px-4 pb-24 pt-5 md:px-8 md:pb-10 md:pt-8">
        <Outlet />
      </main>
      <MobileNav />
    </div>
  );
}
