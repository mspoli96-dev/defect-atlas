import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || "https://webytex-defect-atlas.vercel.app"),
  title: "Defect Atlas | Visual inspection, measured by Webytex",
  description: "Inspect product photographs with AI, route uncertain cases to review and measure the tradeoffs on a labelled dataset. An original Webytex Business demo.",
  icons: { icon: "/mark.svg" },
  openGraph: { title: "Defect Atlas by Webytex", description: "Visual inspection that makes uncertainty visible.", type: "website", locale: "en_CA", images: [{ url: "/social-preview.png", width: 1920, height: 1080, alt: "Defect Atlas visual inspection lab by Webytex Business." }] },
  twitter: { card: "summary_large_image", title: "Defect Atlas by Webytex", images: ["/social-preview.png"] },
};

export default function RootLayout({children}: Readonly<{children: React.ReactNode}>){ return <html lang="en-CA"><body>{children}</body></html>; }
