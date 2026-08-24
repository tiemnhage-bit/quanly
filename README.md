# Nhà Gé MVP 0.2

Bản dự án thật bằng Next.js, ưu tiên giao diện di động và tự mở rộng khi dùng trên máy tính.

## Đã có
- Trang chủ
- Bán hàng
- Danh sách đơn hàng
- Xem chi tiết đơn
- Sửa tổng tiền / số lượng tổng / ghi chú
- Hủy đơn
- Nhập đơn từ App Food theo tổng cuối ngày
- Chọn ngày cũ để nhập bù
- Kho cơ bản
- Thu chi cơ bản
- Báo cáo cơ bản
- Lưu dữ liệu đơn hàng thử nghiệm ngay trên trình duyệt

## Chưa có
- Cơ sở dữ liệu thật
- Đăng nhập
- Đồng bộ nhiều thiết bị
- Tự động trừ kho thật
- Phiếu nhập hàng lưu dữ liệu
- Giá vốn lịch sử

## Chạy trên máy
Cần Node.js 20.9 trở lên.

```bash
npm install
npm run dev
```

Sau đó mở http://localhost:3000

## Bước kỹ thuật tiếp theo
1. Nối Supabase.
2. Tạo bảng quán, người dùng, sản phẩm, đơn hàng, chi tiết đơn, kho, phiếu nhập và thu chi.
3. Chuyển dữ liệu thử nghiệm từ localStorage sang Supabase.
4. Thêm lịch sử thay đổi giá vốn để không ghi đè dữ liệu cũ.
