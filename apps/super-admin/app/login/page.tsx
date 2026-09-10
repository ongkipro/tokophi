"use client";
import { useActionState } from "react";
import { signIn } from "@/lib/actions/auth";
import { Button } from "@tokophi/ui/button";
import { Input } from "@tokophi/ui/input";
import { Label } from "@tokophi/ui/label";
import { BrandWordmark } from "@tokophi/ui/brand-wordmark";

/**
 * THE CONTROL PLANE'S FRONT DOOR — the same shape the Seller's `/login` moved to on 2026-08-06, and
 * for the reasons measured there (`apps/admin/components/admin/front-door/front-door-shell.tsx`):
 * a 384px card floating on a background of the same colour is not a surface, an `h1` at 24px/500 is
 * body text, and a 32px submit button is a table-row control on a screen whose only job is that
 * button. This page had all three until 2026-09-11.
 *
 * What is deliberately DIFFERENT from the Seller's door: no "daftar" footer (operators are invited,
 * never self-registered), no Google (`platform_admins` is local-only), and the right panel lists
 * facts about how this panel is GOVERNED rather than what a shop can do — every line below is a
 * property of the code an operator is about to act under, checkable in `lib/platform-auth.ts`,
 * `lib/actions/auth.ts` and `impersonation_grants`.
 */
const MARKETING_HOME = process.env.NEXT_PUBLIC_MARKETING_URL || "https://tokophi.com";

export default function LoginPage() {
  const [state, action, pending] = useActionState(signIn, {});
  return (
    <div className="grid min-h-svh lg:grid-cols-[46fr_54fr]">
      <main className="flex h-svh flex-col overflow-hidden px-6 pb-5 pt-6 sm:px-10 lg:h-auto lg:min-h-svh lg:justify-center lg:overflow-visible lg:px-14 lg:py-10">
        <div className="mx-auto flex min-h-0 w-full max-w-[26rem] flex-1 flex-col lg:flex-none motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2 motion-safe:duration-500">
          {/* The only way OUT of this form leads to the marketing site: `/` is the dashboard behind
              middleware and would bounce straight back here. `py-2` keeps the target ≥ 44px. */}
          <a href={MARKETING_HOME} aria-label="TokoΦ — ke beranda" className="inline-flex shrink-0 self-start rounded-md py-2 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary">
            <BrandWordmark className="text-lg" />
          </a>

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain lg:flex-none lg:overflow-visible">
            <p className="mt-4 font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground lg:mt-6">Super Admin · control plane</p>
            {/* The page's only h1. */}
            <h1 className="mt-2 text-[clamp(1.75rem,3.4vw,2.35rem)] font-semibold leading-[1.1] tracking-[-0.035em]">Masuk ke panel platform</h1>
            <p className="mt-2.5 text-[0.9375rem] leading-relaxed text-muted-foreground">Kelola semua toko, tagihan, pencairan, dan tiket dari satu tempat.</p>

            <form action={action} className="mt-6 flex flex-col gap-4 pb-1 lg:mt-7">
              <div className="flex flex-col gap-2">
                <Label htmlFor="email">Email</Label>
                {/* ⚠️ NO `defaultValue`, and this is the CONTROL PLANE. It pre-filled the seeded
                    operator's address — an account the seed genuinely creates on deploy — so the page
                    that reaches every store on the platform named the one account worth attacking.
                    The login limiter is keyed on IP, not on account (AGENTS.md), so nothing anywhere
                    records that one specific operator is being tried. The `placeholder` shows the
                    shape without naming anyone. `no-published-credentials.test.ts` guards it. */}
                <Input id="email" name="email" type="email" placeholder="nama@tokophi.id" required autoComplete="email" className="h-11" />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="password">Kata sandi</Label>
                <Input id="password" name="password" type="password" required autoComplete="current-password" className="h-11" />
              </div>
              {/* An error gets its own surface and `role="alert"` — bare red text on a two-field screen
                  reads as a label, and a screen reader would have to hunt for it. */}
              {state?.error && (
                <p role="alert" className="rounded-lg border border-destructive/25 bg-destructive/8 px-3.5 py-2.5 text-sm text-destructive">{state.error}</p>
              )}
              {/* h-11: this is the primary action of a whole page, not a table-row control. */}
              <Button type="submit" disabled={pending} className="h-11 w-full text-[0.9375rem] transition-transform motion-safe:active:scale-[0.985]">
                {pending ? "Masuk…" : "Masuk"}
              </Button>
            </form>
          </div>

          <div className="mt-4 shrink-0 border-t pt-4 text-sm text-muted-foreground lg:mt-7 lg:pt-5">
            Akun operator hanya dibuat lewat undangan di Pengaturan → Tim Platform. Lupa kata sandi? Minta operator <span className="font-medium text-foreground">owner</span> mereset dari sana.
          </div>
        </div>
      </main>

      {/* Hidden below `lg` on purpose: on a phone the form IS the page. */}
      <aside className="relative hidden overflow-hidden bg-[oklch(0.21_0.035_265)] px-14 py-16 text-white lg:flex lg:flex-col lg:justify-center">
        <div aria-hidden className="pointer-events-none absolute inset-0 opacity-[0.07]" style={{ backgroundImage: "linear-gradient(to right, white 1px, transparent 1px), linear-gradient(to bottom, white 1px, transparent 1px)", backgroundSize: "44px 44px" }} />
        <div className="relative">
          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-white/40">Yang berlaku di balik pintu ini</p>
          <p className="mt-3 text-[1.6rem] font-semibold leading-tight tracking-[-0.03em]">Setiap tindakan di sini menjangkau semua toko — dan tercatat.</p>
          <ul className="mt-9 space-y-5 text-[0.9375rem] leading-relaxed text-white/70">
            {/* Every line is a property of the code, not a promise. */}
            <Rule k="Peran">Dibaca ulang dari <span className="text-white">platform_admins</span> pada setiap permintaan — bukan dari cookie.</Rule>
            <Rule k="Jejak">Setiap aksi yang mengubah data merchant ditulis ke <span className="text-white">Log Sistem</span> dengan nama operatornya.</Rule>
            <Rule k="Buka toko">Masuk sebagai merchant lewat pertukaran sekali pakai, sesi <span className="text-white">30 menit</span>, dua identitas di setiap catatan.</Rule>
            <Rule k="Kata sandi">Mengubahnya mencabut semua sesi lain seketika, di perangkat mana pun.</Rule>
          </ul>
        </div>
      </aside>
    </div>
  );
}

function Rule({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <li className="grid grid-cols-[5.5rem_1fr] gap-4">
      <span className="pt-0.5 font-mono text-[11px] uppercase tracking-[0.16em] text-white/40">{k}</span>
      <span>{children}</span>
    </li>
  );
}
