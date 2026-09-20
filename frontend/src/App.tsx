import React from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider } from "./auth/AuthContext";
import ProtectedRoute from "./layouts/ProtectedRoute";
import AppLayout from "./layouts/AppLayout";

import Login from "./pages/Login";
import Register from "./pages/Register";
import Dashboard from "./pages/Dashboard";
import Upload from "./pages/Upload";
import Review from "./pages/Review";
import Records from "./pages/Records";
import RecordDetail from "./pages/RecordDetail";
import Trends from "./pages/Trends";
import Exports from "./pages/Exports";
import Profile from "./pages/Profile";
import ImageVault from "./pages/ImageVault";

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />

        <Route element={<ProtectedRoute />}>
          <Route element={<AppLayout />}>
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/upload" element={<Upload />} />
            <Route path="/records" element={<Records />} />
            <Route path="/images" element={<ImageVault />} />
            <Route path="/records/:id" element={<RecordDetail />} />
            <Route path="/records/:id/review" element={<Review />} />
            <Route path="/trends" element={<Trends />} />
            <Route path="/exports" element={<Exports />} />
            <Route path="/profile" element={<Profile />} />
          </Route>
        </Route>

        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </AuthProvider>
  );
}
