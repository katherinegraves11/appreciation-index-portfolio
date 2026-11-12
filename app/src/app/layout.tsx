import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { HorizonProvider, ModeCorners } from "@/components/Horizon";
import Ticker from "@/components/Ticker";


export const metadata: Metadata = {
  title: "The Appreciation Index",
  description: "Will it appreciate? Ask about any luxury bag; get a sourced answer for one, five and ten years.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h1">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Libre+Caslon+Display&family=EB+Garamond:ital,wght@0,400;0,500;1,400&display=swap" />
      </head>
      <body>
        <HorizonProvider>
          <div className="page">
            <header className="mast">
              <nav><Link href="/">Ask</Link><Link href="/bags">My bags</Link><Link href="/about">About</Link></nav>
              <Link href="/" className="wordmark">Appr<i>e</i>ciation</Link>
              <div className="right"></div>
            </header>
            <div className="rule" />
            <Ticker />
            <svg className="orn" viewBox="0 0 150 14" fill="none" stroke="currentColor" strokeWidth="1" aria-hidden="true"><path d="M2 7h50M98 7h50" /><path d="M60 7c4-6 10-6 15 0c5 6 11 6 15 0" /><circle cx="75" cy="7" r="1.6" fill="currentColor" /><circle cx="55" cy="7" r="1" fill="currentColor" /><circle cx="95" cy="7" r="1" fill="currentColor" /></svg>
            {children}
          </div>
          <ModeCorners />
        </HorizonProvider>
      </body>
    </html>
  );
}
