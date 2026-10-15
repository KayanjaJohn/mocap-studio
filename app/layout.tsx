import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MoCap Studio — Motion Capture & Character Integration",
  description: "Browser-based multi-person motion capture and 3D character animation workspace."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
