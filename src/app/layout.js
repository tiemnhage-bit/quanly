import './globals.css';

export const metadata = {
  title: 'Nhà Gé - Quản lý quán',
  description: 'MVP quản lý quán nhỏ, ưu tiên di động'
};

export default function RootLayout({ children }) {
  return (
    <html lang="vi">
      <body>{children}</body>
    </html>
  );
}
