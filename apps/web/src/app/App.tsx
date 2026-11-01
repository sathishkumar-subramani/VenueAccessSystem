import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, NavLink, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from "@/features/auth/AuthContext";
import { SignInPage } from "@/features/auth/SignInPage";
import { VenuesPage } from "@/features/venues/VenuesPage";
import { VenueDetailPage } from "@/features/venues/VenueDetailPage";
import { WalletPage } from "@/features/wallet/WalletPage";
import { MyPassesPage } from "@/features/passes/MyPassesPage";
import { PassPage } from "@/features/passes/PassPage";
import { ScannerPage } from "@/features/operator/ScannerPage";
import { Spinner } from "@/ui/primitives";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000, refetchOnWindowFocus: false } },
});

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <Shell />
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  );
}

function Shell() {
  const { user, ready, signOut } = useAuth();

  if (!ready) return <Spinner label="Starting up" />;

  if (!user) {
    return (
      <Routes>
        <Route path="*" element={<SignInPage />} />
      </Routes>
    );
  }

  const isOperator = user.role === "venue_operator" || user.role === "platform_admin";

  return (
    <div className="flex min-h-full flex-col pb-16">
      <header className="flex items-center justify-between border-b border-rule px-5 py-3">
        <span className="font-mono text-xs uppercase tracking-[0.2em] text-ink-soft">
          Venue Access
        </span>
        <button
          type="button"
          onClick={() => void signOut()}
          className="text-xs text-ink-soft underline underline-offset-4"
        >
          Sign out
        </button>
      </header>

      <Routes>
        <Route path="/" element={<Navigate to="/venues" replace />} />
        <Route path="/venues" element={<VenuesPage />} />
        <Route path="/venues/:venueId" element={<VenueDetailPage />} />
        <Route path="/wallet" element={<WalletPage />} />
        <Route path="/passes" element={<MyPassesPage />} />
        <Route path="/passes/:passId" element={<PassPage />} />
        {isOperator && <Route path="/scan" element={<ScannerPage />} />}
        <Route path="*" element={<Navigate to="/venues" replace />} />
      </Routes>

      <nav className="fixed inset-x-0 bottom-0 border-t border-rule bg-card">
        <ul className="mx-auto flex max-w-lg">
          <TabLink to="/venues" label="Places" />
          <TabLink to="/passes" label="Passes" />
          <TabLink to="/wallet" label="Wallet" />
          {isOperator && <TabLink to="/scan" label="Check in" />}
        </ul>
      </nav>
    </div>
  );
}

function TabLink({ to, label }: { to: string; label: string }) {
  return (
    <li className="flex-1">
      <NavLink
        to={to}
        className={({ isActive }) =>
          `block py-3.5 text-center text-xs uppercase tracking-wide ${
            isActive ? "border-t-2 border-stamp text-ink" : "text-ink-soft"
          }`
        }
      >
        {label}
      </NavLink>
    </li>
  );
}
