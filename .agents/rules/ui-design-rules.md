# Side-panel UI Design Rules

Áp dụng cho thay đổi giao diện trong `apps/extension/src/shell/**` và các
component chỉ hiển thị của Extension.

## Theme tokens

- Màu chủ đạo: `#008000`; chỉ dùng cho CTA, trạng thái đang hoạt động, tiến độ,
  focus và các lựa chọn đã chọn.
- Hover/active tối: `#006B00`; không thay thế màu chủ đạo bằng xanh lime.
- Nền side panel: `#F8FAF4` (xanh-trắng rất nhạt theo design); surface/card:
  `#FFFFFF`.
- Màu xanh nền nhẹ: `#DFF2D8`; màu bề mặt nhẹ: `#F1F6EB`.
- Viền: `#DBE8CE`; viền nhấn: `#B7C982`.
- Chữ chính: `#203820`; chữ phụ: `#66715F`; lỗi: `#B54747`.
- Khai báo và dùng CSS custom properties trong `sidepanel.css`; không rải thêm
  mã màu tương đương trực tiếp trong component.

## Layout and interaction

- Side panel phải dùng bố cục co giãn, không dùng tọa độ `absolute` để sao chép
  mockup. Card sáng, bo góc vừa phải, viền mảnh và bóng rất nhẹ hoặc không bóng.
- Giữ ba tab Học tập, Lịch sử, Cài đặt nhất quán; tab được chọn phải có dấu hiệu
  màu sắc lẫn focus trạng thái rõ ràng.
- Trạng thái thành công/đang hoạt động dùng xanh; lỗi không được chỉ dựa vào
  màu sắc và phải nêu bước lỗi cùng thao tác thử lại nếu luồng hỗ trợ.
- Transcript cue phải hiển thị timestamp, cho biết cue đang phát, và giữ được
  thao tác bàn phím/focus khi có thể bấm để tua video.
- Mọi control tương tác phải có `:focus-visible`, vùng bấm đủ lớn và độ tương
  phản đọc được trên nền xanh-trắng nhạt.

## Scope and verification

- Thay đổi giao diện không được thay đổi contract, endpoint, luồng transcript,
  session hoặc quiz. Tách thay đổi nghiệp vụ thành task riêng.
- Với thay đổi TypeScript, chạy `npm.cmd run typecheck`; với thay đổi UI, chạy
  `npm.cmd run build` và kiểm tra thủ công cả Học tập, Lịch sử, Cài đặt ở chiều
  rộng side panel trên Chrome/Edge.
