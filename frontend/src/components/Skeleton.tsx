import React from "react";

export function SkeletonBlock({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-lg bg-gray-200 ${className}`} aria-hidden="true" />;
}

export function SkeletonList({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-2" role="status" aria-label="Loading">
      {Array.from({ length: rows }).map((_, i) => (
        <SkeletonBlock key={i} className="h-16 w-full" />
      ))}
    </div>
  );
}
