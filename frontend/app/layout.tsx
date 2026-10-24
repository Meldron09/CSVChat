import type { Metadata } from "next";
import { Mona_Sans } from "next/font/google";
import "./globals.css";

const mona = Mona_Sans({ subsets: ["latin"], variable: "--font-mona" });

export const metadata: Metadata = {
  title: "CSVChat",
  description: "Chat with your CSV files",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${mona.variable} h-full antialiased`} suppressHydrationWarning>
      <head>
        {/* Applies a stored light/dark choice before first paint (no flash); with none, CSS follows the OS. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var t=localStorage.getItem("theme");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`,
          }}
        />
      </head>
      <body className="min-h-full flex flex-col">
        <div aria-hidden className="h-1.5 shrink-0 bg-bar" />
        {children}
      </body>
    </html>
  );
}
