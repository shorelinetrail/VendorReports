import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Vendor Maintenance Tracker',
  description: 'Track and manage vendor maintenance reports and schedules',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased min-h-screen bg-gray-50">
        {children}
      </body>
    </html>
  );
}
