import React, { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { getErrorMessage } from "../services/api";

export default function Login() {
  const { login, loading } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  // Once the user has actually tried to log in (successfully or not), the
  // stale "session expired" banner from the ?expired=1 redirect no longer
  // applies; showing both at once reads as two contradictory messages.
  const [dismissExpiredNotice, setDismissExpiredNotice] = useState(false);
  const [dismissDeletedNotice, setDismissDeletedNotice] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setDismissExpiredNotice(true);
    setDismissDeletedNotice(true);
    try {
      await login(email.trim(), password);
      navigate("/dashboard");
    } catch (err: any) {
      setError(getErrorMessage(err, "Invalid email or password."));
    }
  }

  const showExpiredNotice = Boolean(params.get("expired")) && !dismissExpiredNotice;
  const showDeletedNotice = Boolean(params.get("accountDeleted")) && !dismissDeletedNotice;

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#eef6f4] px-4 py-6 sm:py-10 md:px-8">
      <div className="grid w-full max-w-5xl overflow-hidden rounded-[1.75rem] border border-[#d6e7e3] bg-white shadow-[0_24px_70px_rgba(28,65,68,0.12)] md:min-h-[620px] md:grid-cols-[0.9fr_1.1fr]">
        <div className="hidden flex-col justify-between bg-[#173b45] p-10 text-white md:flex lg:p-12">
          <div>
            <img src="/medivault-cropped.png" alt="MediVault" className="h-16 w-60 rounded bg-white/95 px-3 object-contain object-left" />
            <p className="mt-24 max-w-xs text-3xl font-semibold leading-tight">A calmer way to keep your health history together.</p>
            <p className="mt-4 max-w-xs text-sm leading-6 text-[#b8d2d0]">Securely organize reports, review extracted details, and keep your care history within reach.</p>
          </div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#86b8b0]">Private by design · built for clarity</p>
        </div>
        <section className="flex flex-col justify-center p-7 sm:p-10 lg:p-14">
          <div className="mb-8">
            <img src="/medivault-cropped.png" alt="MediVault" className="mb-8 h-11 w-44 object-contain object-left md:hidden" />
            <p className="eyebrow mb-2">Your health records</p>
            <h1 className="text-3xl font-bold tracking-tight text-[#173b45]">Welcome back</h1>
            <p className="mt-2 text-sm text-gray-500">Log in to your medical vault</p>
          </div>

          <div className="space-y-4">
            {showExpiredNotice && <p className="rounded-xl bg-amber-50 px-3 py-2.5 text-sm text-amber-800">Your session has expired. Please log in again.</p>}
            {showDeletedNotice && <p className="rounded-xl bg-[#f1f8f6] px-3 py-2.5 text-sm text-[#173b45]">Your account and all of its data have been permanently deleted.</p>}
            {error && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2.5 text-sm text-red-700">{error}</p>}
            <form onSubmit={onSubmit} className="space-y-4" noValidate>
              <div>
                <label htmlFor="email" className="mb-1.5 block text-sm font-semibold text-[#365861]">Email</label>
                <input
                  id="email"
                  type="email"
                  required
                  autoFocus
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    if (error) setError(null);
                  }}
                  className="field-control py-3"
                  autoComplete="email"
                  aria-invalid={Boolean(error)}
                />
              </div>
              <div>
                <label htmlFor="password" className="mb-1.5 block text-sm font-semibold text-[#365861]">Password</label>
                <div className="relative">
                  <input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    required
                    value={password}
                    onChange={(e) => {
                      setPassword(e.target.value);
                      if (error) setError(null);
                    }}
                    className="field-control py-3 pr-16"
                    autoComplete="current-password"
                    aria-invalid={Boolean(error)}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute inset-y-0 right-3 text-xs font-semibold text-brand-700 hover:underline"
                    aria-label={showPassword ? "Hide password" : "Show password"}
                  >
                    {showPassword ? "Hide" : "Show"}
                  </button>
                </div>
              </div>
              <button
                type="submit"
                disabled={loading}
                aria-busy={loading}
                className="w-full rounded-xl bg-brand-600 py-3.5 text-sm font-bold text-white shadow-sm hover:-translate-y-0.5 hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0"
              >
                {loading ? "Logging in…" : "Log in"}
              </button>
            </form>
          </div>

          <div className="mt-8 border-t border-[#e6efed] pt-6 text-center">
            <p className="text-sm text-gray-500">Don't have an account? <Link to="/register" className="font-bold text-brand-700 hover:underline">Create one</Link></p>
            <p className="mt-4 text-xs leading-5 text-gray-400">Your medical records are private and accessible only through your account.</p>
          </div>
        </section>
      </div>
    </div>
  );
}
