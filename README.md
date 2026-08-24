# Nhà Gé MVP 0.9

Đã import dữ liệu từ file nguyên liệu người dùng cung cấp.

## Danh mục được nạp
- Cà Phê Hạt — g — tồn đầu 20.000 — cảnh báo 100
- Sữa Đặc — ml — tồn đầu 6.000 — cảnh báo 2.000
- Sữa Tươi Vinamil — ml
- Phindi Hạnh Nhân — ml
- Ly Cà Phê — cái — tồn đầu 1.000 — cảnh báo 200
- Rích Lùn — ml
- Ly Lùn 500ml — cái

## Công thức được nối với kho
- Cà Phê Đen: Cà Phê Hạt 20g + Ly Cà Phê 1 cái
- Cà Phê Sữa: Cà Phê Hạt 20g + Ly Cà Phê 1 cái + Sữa Đặc 30ml
- Bạc Xỉu: Cà Phê Hạt 20g + Ly Lùn 500ml 1 cái + Sữa Đặc 20ml + Rích Lùn 10ml

## Cách nhập dữ liệu
Bản 0.9 tự gộp danh mục trên vào dữ liệu Supabase sau lần đăng nhập đầu tiên.
Nếu một nguyên liệu cùng tên đã tồn tại thì giữ tồn hiện tại, không tạo dòng trùng.
