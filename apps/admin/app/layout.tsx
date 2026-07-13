import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({ variable: "--font-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "TokoΦ — Panel Admin",
  description: "Panel admin toko online modern untuk pasar Indonesia.",
  // Panel admin merchant: tidak boleh diindeks mesin pencari (login, daftar, akun, faktur, …).
  // Lapisan kedua di samping header X-Robots-Tag (middleware.ts + next.config.ts).
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
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
