import "./globals.css";

export const metadata = {
  title: "DocCraft | Academic Document Editor",
  description: "A local-first workspace for academic documents.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="id">
      <body>{children}</body>
    </html>
  );
}
