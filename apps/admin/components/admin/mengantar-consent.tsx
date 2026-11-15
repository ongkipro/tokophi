import { cn } from "@tokophi/ui/lib/utils";

// THE consent sentence for the store's own Mengantar account. Mengantar's Partner docs ("What Mengantar
// expects from you"): "Get their agreement to the Mengantar Terms and Conditions and Privacy Policy. This
// route does not show them the consent checkbox the sign-up form has, so it has to happen on your side."
// It is shown wherever an owner action creates that account — the signup page (creation is automatic after
// approval) and the Pengaturan "Hubungkan Mengantar" button — and the server records consent only from
// those two actions (`connectStoreMengantar` refuses without it). Seller surface: the brand may be named
// (owner O5). URLs verified live 2026-11-11 (HTTP 200).
export const MENGANTAR_TERMS_URL = "https://www.mengantar.com/terms/";
export const MENGANTAR_PRIVACY_URL = "https://www.mengantar.com/privacy-policy/";
export const TOKOPHI_PRIVACY_URL = "https://tokophi.com/privasi/";

const link = "font-medium text-foreground underline underline-offset-2 hover:text-primary";
const Ext = ({ href, children }: { href: string; children: React.ReactNode }) => (
  <a href={href} target="_blank" rel="noopener noreferrer" className={link}>
    {children}
  </a>
);

export function MengantarConsent({ action, className }: { action: "signup" | "connect"; className?: string }) {
  return (
    <p data-mengantar-consent={action} className={cn("text-xs leading-relaxed text-muted-foreground", className)}>
      {action === "signup" ? (
        <>
          Dengan membuat toko, kamu setuju TokoΦ membuatkan akun <span className="font-medium text-foreground">Mengantar</span> untuk pengiriman
          tokomu — memakai email dan nomor HP toko — dan menyetujui <Ext href={MENGANTAR_TERMS_URL}>Syarat &amp; Ketentuan</Ext> serta{" "}
          <Ext href={MENGANTAR_PRIVACY_URL}>Kebijakan Privasi</Ext> Mengantar. Baca juga <Ext href={TOKOPHI_PRIVACY_URL}>Kebijakan Privasi TokoΦ</Ext>.
        </>
      ) : (
        <>
          Dengan menekan “Hubungkan Mengantar”, kamu setuju TokoΦ membuatkan akun Mengantar atas nama toko ini — memakai email pemilik dan
          nomor HP pengirim — dan menyetujui <Ext href={MENGANTAR_TERMS_URL}>Syarat &amp; Ketentuan</Ext> serta{" "}
          <Ext href={MENGANTAR_PRIVACY_URL}>Kebijakan Privasi</Ext> Mengantar.
        </>
      )}
    </p>
  );
}
