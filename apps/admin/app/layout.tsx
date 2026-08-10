import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({ variable: "--font-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "TokoΦ — Dashboard Seller",
  description: "Dashboard Seller TokoΦ: kelola toko online Anda untuk pasar Indonesia.",
  // Dashboard Seller (merchant): tidak boleh diindeks mesin pencari (login, daftar, akun, faktur, …).
  // Lapisan kedua di samping header X-Robots-Tag (middleware.ts + next.config.ts).
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // ⚠️ Do NOT add `maximumScale: 1` / `userScalable: false`. They stop pinch-zoom, which breaks
  // WCAG 1.4.4 (Resize Text) for anyone who needs to magnify — on the panel a merchant runs their
  // whole shop from, often one-handed on a phone. iOS ignores the flag anyway since Safari 10, so
  // the only people it succeeds against are the Android users who most need it.
};

// Apply saved theme before paint (no flash).
const themeScript = `try{var t=localStorage.getItem('theme');if(t==='dark'||(!t&&matchMedia('(prefers-color-scheme:dark)').matches))document.documentElement.classList.add('dark')}catch(e){}`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="id" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`} suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: themeScript }} /></head>
      <body className="flex min-h-full flex-col font-sans">{children}</body>
    </html>
  );
}
