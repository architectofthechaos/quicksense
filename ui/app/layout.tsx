import "@fontsource-variable/inter";
import "@fontsource-variable/jetbrains-mono";
import "./globals.css";
import type { ReactNode } from "react";
import type { Metadata } from "next";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "QuickSense",
  description: "The air-gapped agent control plane for your lakehouse.",
  icons: { icon: "/favicon.png" },
};

// Applied before paint to avoid a flash of the wrong theme. Mirrors lib/theme
// resolveTheme: a stored choice wins, else system preference.
const noFlashTheme = `(function(){try{var t=localStorage.getItem('theme');var d=t==='dark'||(!t&&window.matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.classList.toggle('dark',d);}catch(e){}})();`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: noFlashTheme }} />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
