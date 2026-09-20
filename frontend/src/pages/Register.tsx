import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";

export default function Register() {
  const { register, loading } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await register(email, password, confirmPassword);
      navigate("/profile?onboarding=1");
    } catch (err: any) {
      setError(err?.response?.data?.error ?? "We couldn't create your account. Please try again.");
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#eef6f4] px-4 py-6 sm:py-10 md:px-8">
      <div className="grid w-full max-w-5xl overflow-hidden rounded-[1.75rem] border border-[#d6e7e3] bg-white shadow-[0_24px_70px_rgba(28,65,68,0.12)] md:min-h-[680px] md:grid-cols-[0.9fr_1.1fr]">
        <div className="hidden flex-col justify-between bg-[#173b45] p-10 text-white md:flex lg:p-12">
          <div>
            <img src="/medivault-cropped.png" alt="MediVault" className="h-16 w-60 rounded bg-white/95 px-3 object-contain object-left" />
            <p className="mt-24 max-w-xs text-3xl font-semibold leading-tight">Your health history deserves a clear home.</p>
            <p className="mt-4 max-w-xs text-sm leading-6 text-[#b8d2d0]">Start with one secure place for your reports and personal health profile.</p>
          </div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#86b8b0]">Private by design · built for clarity</p>
        </div>
        <section className="flex flex-col justify-center p-7 sm:p-10 lg:p-14">
          <div className="mb-8">
            <img src="/medivault-cropped.png" alt="MediVault" className="mb-8 h-11 w-44 object-contain object-left md:hidden" />
            <p className="eyebrow mb-2">Get started</p>
            <h1 className="text-3xl font-bold tracking-tight text-[#173b45]">Create your vault</h1>
            <p className="mt-2 text-sm text-gray-500">Your records, organized and private</p>
          </div>

          {error && <p role="alert" className="mb-4 rounded-xl bg-red-50 px-3 py-2.5 text-sm text-red-700">{error}</p>}
          <form onSubmit={onSubmit} className="space-y-4">
            <div>
              <label htmlFor="email" className="mb-1.5 block text-sm font-semibold text-[#365861]">Email</label>
              <input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="field-control py-3" autoComplete="email" />
            </div>
            <div>
              <label htmlFor="password" className="mb-1.5 block text-sm font-semibold text-[#365861]">Password</label>
              <input id="password" type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} className="field-control py-3" autoComplete="new-password" />
            </div>
            <div>
              <label htmlFor="confirmPassword" className="mb-1.5 block text-sm font-semibold text-[#365861]">Confirm password</label>
              <input id="confirmPassword" type="password" required value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} className="field-control py-3" autoComplete="new-password" />
            </div>
            <button type="submit" disabled={loading} className="w-full rounded-xl bg-brand-600 py-3.5 text-sm font-bold text-white shadow-sm hover:-translate-y-0.5 hover:bg-brand-700 disabled:opacity-60">{loading ? "Creating account..." : "Create account"}</button>
          </form>

          <div className="mt-8 border-t border-[#e6efed] pt-6 text-center">
            <p className="text-sm text-gray-500">Already have an account? <Link to="/login" className="font-bold text-brand-700 hover:underline">Log in</Link></p>
          </div>
        </section>
      </div>
    </div>
  );
}
