import "../styles/globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Fence Planner",
  description: "Kalkulator i rysunek 2D ogrodze"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pl">
      <body className="min-h-dvh bg-background text-foreground">{children}</body>
    </html>
  );
}
