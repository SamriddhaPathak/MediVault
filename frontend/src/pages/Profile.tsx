import React, { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api, getErrorMessage } from "../services/api";
import { HealthProfile } from "../types";
import { useAuth } from "../auth/AuthContext";
import { useToast } from "../components/ToastProvider";
import ErrorState from "../components/ErrorState";
import { SkeletonBlock } from "../components/Skeleton";

export default function Profile() {
  const { user, logout } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [profile, setProfile] = useState<HealthProfile>({});
  const [editing, setEditing] = useState(params.get("onboarding") === "1");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deletePassword, setDeletePassword] = useState("");
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await api.get("/profile");
      if (res.data.profile) setProfile(res.data.profile);
    } catch (err: any) {
      setLoadError(getErrorMessage(err, "We couldn't load your profile. Please try again."));
    } finally {
      setLoading(false);
    }
  }

  async function save() {
    setSaving(true);
    setSaveError(null);
    try {
      const res = await api.patch("/profile", profile);
      setProfile(res.data.profile);
      setEditing(false);
      showToast("Profile updated.");
    } catch (err: any) {
      setSaveError(getErrorMessage(err, "We couldn't save your profile. Please try again."));
    } finally {
      setSaving(false);
    }
  }

  async function uploadPhoto(file: File) {
    if (!file.type.startsWith("image/") || file.size > 5 * 1024 * 1024) {
      setSaveError("Choose a JPG, PNG, or WebP image under 5MB.");
      return;
    }
    setPhotoBusy(true);
    setSaveError(null);
    try {
      const formData = new FormData();
      formData.append("photo", file);
      const res = await api.post("/profile/photo", formData, { headers: { "Content-Type": "multipart/form-data" } });
      setProfile(res.data.profile);
      showToast("Profile photo updated.");
    } catch (err: any) {
      setSaveError(getErrorMessage(err, "We couldn't update your profile photo."));
    } finally {
      setPhotoBusy(false);
    }
  }

  async function removePhoto() {
    setPhotoBusy(true);
    setSaveError(null);
    try {
      await api.delete("/profile/photo");
      setProfile((current) => ({ ...current, profilePhotoUrl: null }));
      showToast("Profile photo removed.");
    } catch (err: any) {
      setSaveError(getErrorMessage(err, "We couldn't remove your profile photo."));
    } finally {
      setPhotoBusy(false);
    }
  }

  function closeDeleteDialog() {
    if (deleteBusy) return;
    setDeleteOpen(false);
    setDeletePassword("");
    setDeleteError(null);
  }

  async function deleteAccount() {
    if (!deletePassword) {
      setDeleteError("Enter your password to confirm.");
      return;
    }
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      await api.delete("/profile", { data: { password: deletePassword } });
      await logout();
      navigate("/login?accountDeleted=1", { replace: true });
    } catch (err: any) {
      setDeleteError(getErrorMessage(err, "We couldn't delete your account. Please try again."));
      setDeleteBusy(false);
    }
  }

  const initials = (profile.displayName || user?.email || "M").slice(0, 1).toUpperCase();

  const completenessFields: Array<[string, unknown]> = [
    ["Display name", profile.displayName],
    ["Phone number", profile.phone],
    ["Age", profile.age],
    ["Blood group", profile.bloodGroup],
    ["Emergency contact", profile.emergencyContact],
    ["Allergies", profile.allergies],
    ["Known conditions", profile.knownConditions],
  ];
  const completedCount = completenessFields.filter(([, value]) => value !== undefined && value !== null && value !== "").length;
  const completenessPct = Math.round((completedCount / completenessFields.length) * 100);

  if (loading) {
    return (
      <div className="mx-auto max-w-lg space-y-4">
        <SkeletonBlock className="h-8 w-48" />
        <SkeletonBlock className="h-48 w-full" />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="mx-auto max-w-lg">
        <ErrorState message={loadError} onRetry={load} />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow mb-1">Account & health</p>
          <h1 className="text-2xl font-bold tracking-tight text-[#173b45]">Your profile</h1>
          <p className="mt-1 text-sm text-gray-500">Keep the details that help you and your care team understand your history.</p>
        </div>
        {!editing && (
          <button onClick={() => setEditing(true)} className="rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-bold text-white shadow-sm hover:-translate-y-0.5 hover:bg-brand-700">
            Edit profile
          </button>
        )}
      </div>

      {saveError && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {saveError}
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-[0.82fr_1.18fr]">
        <div className="space-y-6">
          <section className="surface overflow-hidden">
            <div className="h-24 bg-[#173b45]" />
            <div className="-mt-12 px-5 pb-5">
              <div className="flex items-end justify-between gap-3">
                {profile.profilePhotoUrl ? (
                  <img src={profile.profilePhotoUrl} alt="Profile" className="h-24 w-24 rounded-3xl border-4 border-white object-cover shadow-lg" />
                ) : (
                  <div className="flex h-24 w-24 items-center justify-center rounded-3xl border-4 border-white bg-brand-100 text-3xl font-bold text-brand-800 shadow-lg">{initials}</div>
                )}
                <div className="mb-1 flex gap-2">
                  <button onClick={() => photoInputRef.current?.click()} disabled={photoBusy} className="rounded-xl border border-[#cbdedb] bg-white px-3 py-2 text-xs font-bold text-[#365861] hover:bg-[#f3f9f7]">
                    {photoBusy ? "Updating..." : "Change photo"}
                  </button>
                  {profile.profilePhotoUrl && <button onClick={removePhoto} disabled={photoBusy} aria-label="Remove profile photo" className="rounded-xl border border-red-100 px-3 py-2 text-xs font-bold text-red-600 hover:bg-red-50">Remove</button>}
                </div>
              </div>
              <input ref={photoInputRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => e.target.files?.[0] && uploadPhoto(e.target.files[0])} />
              <h2 className="mt-4 text-xl font-bold text-[#173b45]">{profile.displayName || "Your name"}</h2>
              <p className="mt-1 text-sm text-gray-500">{user?.email}</p>
              {!editing && completedCount < completenessFields.length ? (
                <div className="mt-4">
                  <div className="mb-1.5 flex items-center justify-between text-xs">
                    <span className="font-bold text-[#365861]">Profile completeness</span>
                    <span className="text-gray-400">{completedCount} of {completenessFields.length} details</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-[#eef3f2]">
                    <div className="h-1.5 rounded-full bg-brand-500" style={{ width: `${Math.max(6, completenessPct)}%` }} />
                  </div>
                </div>
              ) : (
                <p className="mt-4 text-xs leading-5 text-gray-400">Use a clear photo so your account is easy to recognize when managing shared care records.</p>
              )}
            </div>
          </section>
          {!editing && <section className="surface p-5"><p className="eyebrow mb-3">Health snapshot</p><div className="grid grid-cols-2 gap-3"><Snapshot label="Age" value={profile.age ?? "–"} /><Snapshot label="Blood group" value={profile.bloodGroup || "–"} /><Snapshot label="Units" value={profile.preferredUnits === "imperial" ? "Imperial" : "Metric"} /><Snapshot label="Phone" value={profile.phone || "–"} /></div></section>}
        </div>

        <section className="surface p-5 sm:p-6">
          {!editing ? (
            <div className="space-y-5">
              <div><p className="eyebrow mb-1">Personal details</p><h2 className="text-lg font-bold text-[#173b45]">Important information</h2></div>
              <div className="space-y-1 text-sm"><Row label="Emergency contact" value={profile.emergencyContact || "Not added"} /><Row label="Allergies" value={profile.allergies || "Not added"} /><Row label="Known conditions" value={profile.knownConditions || "Not added"} /></div>
              <div className="rounded-xl bg-[#f1f8f6] p-4 text-sm leading-6 text-[#365861]">Your profile is private to your account. MediVault does not diagnose conditions or replace professional medical advice.</div>
            </div>
          ) : (
            <div className="space-y-5">
              <div><p className="eyebrow mb-1">Edit profile</p><h2 className="text-lg font-bold text-[#173b45]">Personal and health details</h2></div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Display name" htmlFor="profile-name"><input id="profile-name" value={profile.displayName ?? ""} onChange={(e) => setProfile((p) => ({ ...p, displayName: e.target.value }))} className="profile-input" placeholder="How should we call you?" /></Field>
                <Field label="Phone number" htmlFor="profile-phone"><input id="profile-phone" type="tel" value={profile.phone ?? ""} onChange={(e) => setProfile((p) => ({ ...p, phone: e.target.value }))} className="profile-input" placeholder="Optional" /></Field>
                <Field label="Age" htmlFor="profile-age"><input id="profile-age" type="number" min={0} max={130} value={profile.age ?? ""} onChange={(e) => setProfile((p) => ({ ...p, age: e.target.value ? parseInt(e.target.value, 10) : undefined }))} className="profile-input" /></Field>
                <Field label="Blood group" htmlFor="profile-blood"><input id="profile-blood" value={profile.bloodGroup ?? ""} onChange={(e) => setProfile((p) => ({ ...p, bloodGroup: e.target.value }))} className="profile-input" placeholder="e.g. O+" /></Field>
              </div>
              <Field label="Emergency contact" htmlFor="profile-emergency"><input id="profile-emergency" value={profile.emergencyContact ?? ""} onChange={(e) => setProfile((p) => ({ ...p, emergencyContact: e.target.value }))} className="profile-input" placeholder="Name and phone number" /></Field>
              <Field label="Preferred units" htmlFor="profile-units"><select id="profile-units" value={profile.preferredUnits ?? "metric"} onChange={(e) => setProfile((p) => ({ ...p, preferredUnits: e.target.value as "metric" | "imperial" }))} className="profile-input"><option value="metric">Metric (kg, cm)</option><option value="imperial">Imperial (lb, ft)</option></select></Field>
              <Field label="Allergies" htmlFor="profile-allergies"><textarea id="profile-allergies" value={profile.allergies ?? ""} onChange={(e) => setProfile((p) => ({ ...p, allergies: e.target.value }))} className="profile-input" rows={2} placeholder="List allergies or write none" /></Field>
              <Field label="Known conditions" htmlFor="profile-conditions"><textarea id="profile-conditions" value={profile.knownConditions ?? ""} onChange={(e) => setProfile((p) => ({ ...p, knownConditions: e.target.value }))} className="profile-input" rows={2} placeholder="Optional" /></Field>
              <div className="flex flex-col-reverse gap-3 pt-2 sm:flex-row sm:justify-end"><button onClick={() => { setEditing(false); setSaveError(null); load(); }} className="rounded-xl border border-[#cbdedb] px-4 py-2.5 text-sm font-bold text-[#365861] hover:bg-gray-50">Cancel</button><button onClick={save} disabled={saving} className="rounded-xl bg-brand-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-brand-700 disabled:opacity-60">{saving ? "Saving..." : "Save changes"}</button></div>

              <div className="mt-2 rounded-xl border border-red-100 bg-red-50/60 p-4">
                <p className="text-sm font-bold text-red-700">Danger zone</p>
                <p className="mt-1 text-xs leading-5 text-red-700/80">
                  Permanently delete your account, health profile, and every uploaded report, extracted value, and export. This can't be undone.
                </p>
                <button
                  type="button"
                  onClick={() => setDeleteOpen(true)}
                  className="mt-3 rounded-xl border border-red-200 bg-white px-4 py-2 text-sm font-bold text-red-600 hover:bg-red-50"
                >
                  Delete account
                </button>
              </div>
            </div>
          )}
        </section>
      </div>

      <p className="text-center text-xs text-gray-400">
        MediVault does not automatically infer medical conditions from your uploaded reports.
      </p>

      <DeleteAccountDialog
        open={deleteOpen}
        password={deletePassword}
        busy={deleteBusy}
        error={deleteError}
        onPasswordChange={(value) => {
          setDeletePassword(value);
          if (deleteError) setDeleteError(null);
        }}
        onConfirm={deleteAccount}
        onCancel={closeDeleteDialog}
      />
    </div>
  );
}

/**
 * Purpose-built confirmation dialog for account deletion: mirrors the
 * shared ConfirmDialog's look and accessibility behavior (focus-on-open,
 * Escape-to-close, backdrop click to cancel) but adds the password field
 * this action requires, so a hijacked-but-unattended session can't be used
 * to wipe the account without the credential (see profile.service.ts on
 * the backend).
 */
function DeleteAccountDialog({
  open,
  password,
  busy,
  error,
  onPasswordChange,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  password: string;
  busy: boolean;
  error: string | null;
  onPasswordChange: (value: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const passwordRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) passwordRef.current?.focus();
  }, [open]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && !busy) onCancel();
    }
    if (open) document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, busy, onCancel]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-account-title"
      aria-describedby="delete-account-description"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
      onClick={() => !busy && onCancel()}
    >
      <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h2 id="delete-account-title" className="text-base font-semibold text-gray-900">
          Delete your account?
        </h2>
        <p id="delete-account-description" className="mt-1.5 text-sm text-gray-500">
          This permanently deletes your account, health profile, and every uploaded report, extracted value, and export. This can't be undone.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!busy) onConfirm();
          }}
        >
          <div className="mt-4">
            <label htmlFor="delete-password" className="mb-1 block text-sm font-medium text-gray-700">
              Enter your password to confirm
            </label>
            <input
              ref={passwordRef}
              id="delete-password"
              type="password"
              value={password}
              onChange={(e) => onPasswordChange(e.target.value)}
              className="profile-input"
              autoComplete="current-password"
              aria-invalid={Boolean(error)}
            />
            {error && (
              <p role="alert" className="mt-2 text-sm text-red-600">
                {error}
              </p>
            )}
          </div>
          <div className="mt-5 flex gap-3">
            <button
              type="button"
              onClick={onCancel}
              disabled={busy}
              className="flex-1 rounded-lg border border-[#cbdedb] py-2.5 text-sm font-bold text-[#365861] hover:bg-[#f3f9f7] disabled:opacity-60"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy || !password}
              className="flex-1 rounded-lg bg-red-600 py-2.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-60"
            >
              {busy ? "Deleting..." : "Delete account"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Snapshot({ label, value }: { label: string; value: React.ReactNode }) {
  return <div className="rounded-xl bg-[#f6faf9] p-3"><p className="text-[11px] font-bold uppercase tracking-wider text-gray-400">{label}</p><p className="mt-1 truncate text-sm font-bold text-[#365861]">{value}</p></div>;
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between border-b border-gray-50 py-1.5 last:border-0">
      <span className="text-gray-500">{label}</span>
      <span className="font-medium text-gray-900">{value}</span>
    </div>
  );
}

function Field({ label, htmlFor, children }: { label: string; htmlFor: string; children: React.ReactNode }) {
  return (
    <div>
      <label htmlFor={htmlFor} className="mb-1 block text-sm font-medium text-gray-700">
        {label}
      </label>
      {children}
    </div>
  );
}
