export const metadata = {
  title: 'YT Fact Checker API',
  description: 'Backend API for YouTube Shorts fact-checking',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
