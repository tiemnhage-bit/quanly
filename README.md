# Nhà Gé MVP 0.7

Bản kho thực tế:
- Danh mục Nguyên liệu & Bao bì dùng chung toàn hệ thống.
- Phiếu nhập chỉ chọn từ danh mục, không gõ tên tự do.
- Kiểm kê và điều chỉnh cũng dùng cùng mã nguyên liệu.
- Món có thể thiết lập cách trừ kho bằng cách chọn nguyên liệu từ cùng danh mục.
- Bán món tại quán tự trừ kho nếu món đã có cách trừ kho.
- Hủy đơn hoàn lại kho theo lượng đã trừ.
- App Food vẫn nhập tổng cuối ngày nên chưa tự trừ nguyên liệu.
- Dữ liệu kho đồng bộ qua Supabase giữa các thiết bị.

Sau khi upload mã nguồn lên GitHub, cần chạy lại file supabase.sql một lần trong Supabase SQL Editor để thêm các cột dữ liệu kho.
