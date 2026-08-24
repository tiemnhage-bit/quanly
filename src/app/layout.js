import './globals.css';
import { Be_Vietnam_Pro } from 'next/font/google';

const beVietnam = Be_Vietnam_Pro({
  subsets: ['vietnamese', 'latin'],
  weight: ['400', '500', '600', '700', '800'],
  display: 'swap',
  variable: '--font-be-vietnam'
});

export const metadata = {
  title: 'Nhà Gé - Quản lý quán',
  description: 'Quản lý quán nhỏ, ưu tiên di động'
};

export default function RootLayout({ children }) {
  return (
    <html lang="vi">
      <body className={beVietnam.variable}>{children}</body>
    </html>
  );
}
