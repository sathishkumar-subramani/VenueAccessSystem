import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from "react";

export function Button({
  variant = "solid",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "solid" | "quiet" }) {
  const styles =
    variant === "solid"
      ? "bg-ink text-paper hover:bg-stamp"
      : "border border-rule bg-card text-ink hover:border-ink-soft";

  return (
    <button
      {...props}
      className={`px-4 py-2.5 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stamp disabled:opacity-50 ${styles} ${className}`}
    />
  );
}

export function Field({
  label,
  hint,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-xs uppercase tracking-wide text-ink-soft">{label}</span>
      <input
        {...props}
        className="w-full border border-rule bg-card px-3 py-2.5 text-sm focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-stamp"
      />
      {hint && <span className="block text-xs text-ink-soft">{hint}</span>}
    </label>
  );
}

export function Notice({
  tone = "info",
  children,
}: {
  tone?: "info" | "error" | "good";
  children: ReactNode;
}) {
  const tones = {
    info: "border-rule text-ink-soft",
    error: "border-void text-void",
    good: "border-valid text-valid",
  } as const;

  return (
    <p role={tone === "error" ? "alert" : undefined} className={`border-l-2 py-2 pl-3 text-sm ${tones[tone]}`}>
      {children}
    </p>
  );
}

export function Credits({ value }: { value: number }) {
  return (
    <span className="font-mono tabular-nums">
      {value.toLocaleString("en-IN")}
      <span className="ml-1 text-xs text-ink-soft">cr</span>
    </span>
  );
}

export function Spinner({ label = "Loading" }: { label?: string }) {
  return (
    <p className="py-8 text-center text-sm text-ink-soft" role="status">
      {label}…
    </p>
  );
}
