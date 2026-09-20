import React from "react";

/**
 * A small, coherent set of line-art illustrations used across empty and
 * zero states (Dashboard, Records, Image Vault, Exports). Previously these
 * screens were a bordered box with a line of gray text and nothing else,
 * functionally fine, but the app's first and emptiest moments (a brand new
 * account, a filtered search with no matches) had no visual identity of
 * their own.
 *
 * Deliberately drawn as one family: the same stroke weight (1.6), rounded
 * caps/joins, the ink/brand palette already used everywhere else in the
 * app, and a soft brand-tinted wash behind each mark rather than a filled
 * icon. None of these are decorative for their own sake: each maps to a
 * specific state (empty vault, no search matches, everything's handled)
 * and is sized to sit inline with the copy that explains that state.
 */

const INK = "#173b45";
const TEAL = "#22a583";
const TEAL_SOFT = "#78d9ba";

function Wash({ id, color }: { id: string; color: string }) {
  return (
    <defs>
      <radialGradient id={id} cx="50%" cy="42%" r="60%">
        <stop offset="0%" stopColor={color} stopOpacity="0.16" />
        <stop offset="100%" stopColor={color} stopOpacity="0" />
      </radialGradient>
    </defs>
  );
}

/** An empty vault/folder with a soft padlock motif. Brand-new or fully-cleared views. */
export function EmptyVaultIllustration({ className = "h-32 w-32" }: { className?: string }) {
  return (
    <svg viewBox="0 0 160 160" fill="none" className={className} aria-hidden="true">
      <Wash id="vault-wash" color={TEAL} />
      <circle cx="80" cy="78" r="64" fill="url(#vault-wash)" />
      <rect x="38" y="56" width="84" height="62" rx="10" stroke={INK} strokeWidth="1.6" />
      <path d="M52 56v-8a28 28 0 0 1 56 0v8" stroke={INK} strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="80" cy="82" r="7" stroke={TEAL} strokeWidth="1.8" />
      <path d="M80 89v10" stroke={TEAL} strokeWidth="1.8" strokeLinecap="round" />
      <path d="M50 106h60" stroke={INK} strokeWidth="1.2" strokeOpacity="0.25" strokeLinecap="round" />
      <path d="M22 120c8 6 18 9 28 6" stroke={TEAL_SOFT} strokeWidth="1.6" strokeLinecap="round" />
      <path d="M110 126c9-2 17-8 22-16" stroke={TEAL_SOFT} strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

/** A document with a magnifying glass finding nothing. Filtered/searched empty results. */
export function NoResultsIllustration({ className = "h-32 w-32" }: { className?: string }) {
  return (
    <svg viewBox="0 0 160 160" fill="none" className={className} aria-hidden="true">
      <Wash id="search-wash" color={TEAL} />
      <circle cx="80" cy="78" r="64" fill="url(#search-wash)" />
      <rect x="46" y="34" width="52" height="68" rx="8" stroke={INK} strokeWidth="1.6" />
      <path d="M58 52h28M58 64h28M58 76h18" stroke={INK} strokeWidth="1.4" strokeLinecap="round" strokeOpacity="0.5" />
      <circle cx="98" cy="104" r="18" stroke={TEAL} strokeWidth="1.8" />
      <path d="M111 117l14 14" stroke={TEAL} strokeWidth="1.8" strokeLinecap="round" />
      <path d="M90 104h16" stroke={TEAL} strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

/** A shield with a check. Nothing needs attention right now. */
export function AllCaughtUpIllustration({ className = "h-16 w-16" }: { className?: string }) {
  return (
    <svg viewBox="0 0 96 96" fill="none" className={className} aria-hidden="true">
      <Wash id="shield-wash" color={TEAL} />
      <circle cx="48" cy="48" r="42" fill="url(#shield-wash)" />
      <path
        d="M48 16l24 9v18c0 17-10.5 29-24 33-13.5-4-24-16-24-33V25l24-9z"
        stroke={TEAL}
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path d="M37 47l8 8 15-16" stroke={INK} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** A single stack of documents behind a soft glow. Used in compact/inline contexts. */
export function DocumentStackIllustration({ className = "h-14 w-14" }: { className?: string }) {
  return (
    <svg viewBox="0 0 96 96" fill="none" className={className} aria-hidden="true">
      <Wash id="stack-wash" color={TEAL} />
      <circle cx="48" cy="48" r="42" fill="url(#stack-wash)" />
      <rect x="24" y="20" width="40" height="52" rx="6" stroke={TEAL_SOFT} strokeWidth="1.6" transform="rotate(-6 24 20)" />
      <rect x="30" y="26" width="40" height="52" rx="6" fill="#fff" stroke={INK} strokeWidth="1.6" />
      <path d="M40 40h20M40 50h20M40 60h12" stroke={INK} strokeWidth="1.4" strokeLinecap="round" strokeOpacity="0.55" />
    </svg>
  );
}

/**
 * The dashboard hero mark: a vault outline with a heartbeat line passing
 * through it: the one place this pass spends its visual "boldness" (per
 * the design system's own restraint principle), so it appears once, on the
 * welcome banner, and nowhere else.
 */
export function VaultPulseIllustration({ className = "h-40 w-40" }: { className?: string }) {
  return (
    <svg viewBox="0 0 200 160" fill="none" className={className} aria-hidden="true">
      <Wash id="pulse-wash" color={TEAL} />
      <circle cx="100" cy="80" r="76" fill="url(#pulse-wash)" />
      <rect x="46" y="46" width="108" height="76" rx="14" stroke={INK} strokeWidth="1.8" />
      <path d="M64 46v-10a36 36 0 0 1 72 0v10" stroke={INK} strokeWidth="1.8" strokeLinecap="round" />
      <path
        d="M56 88h20l8-16 10 32 8-24 6 8h36"
        stroke={TEAL}
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
