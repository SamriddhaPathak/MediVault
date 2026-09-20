import React from "react";
import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { getStoredTokens } from "../services/api";

export default function ProtectedRoute() {
  const { user } = useAuth();
  const tokens = getStoredTokens();
  if (!user || !tokens) return <Navigate to="/login" replace />;
  return <Outlet />;
}
