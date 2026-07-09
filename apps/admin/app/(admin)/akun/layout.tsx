import { AkunNav } from "./akun-nav";

export default function AkunLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Akun</h1>
        <p className="text-sm text-muted-foreground">Kelola profil, keamanan, dan langganan Anda.</p>
      </div>
      <AkunNav />
      {children}
    </div>
  );
}
