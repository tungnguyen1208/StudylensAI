# StudyLens AI

StudyLens AI là tiện ích Chrome/Edge hỗ trợ học chủ động với video YouTube. Người dùng đăng ký hoặc đăng nhập ngay trên Extension, bật StudyLens cho video đang xem, nhận quiz dựa trên transcript, nộp bài, xem điểm và lịch sử học theo tài khoản.

Hệ thống gồm các thành phần sau:

- `apps/extension`: Extension Manifest V3, gồm Side Panel, Service Worker và Content Script.
- `services/api`: ASP.NET Core Backend, quản lý tài khoản, phiên học, transcript, quiz, bài nộp, lịch sử, quota và PostgreSQL.
- `services/ai`: FastAPI AI Service, thực hiện transcript fallback, sinh quiz và chấm câu trả lời ngắn qua Gemini hoặc provider giả lập.
- `contracts`: Public API contract `0.7.0` và contract nội bộ Backend–AI `0.5.0`.
- `deploy`: Compose và Dockerfile để chạy PostgreSQL, Backend và AI Service.

Extension chỉ gọi Backend. Backend mới gọi AI Service và PostgreSQL; API key Gemini không xuất hiện trong Extension.

## Yêu cầu môi trường

- Windows PowerShell 7 hoặc Windows PowerShell.
- Node.js 20+ và npm.
- .NET SDK 8.
- Python 3.12.
- Chrome hoặc Microsoft Edge để nạp Extension.
- Docker Desktop nếu chạy PostgreSQL hoặc toàn bộ stack bằng Docker.

## Cấu hình bí mật

Các file cấu hình cục bộ bị Git bỏ qua. Không commit `.env` hoặc `deploy/release.env`.

> **Chọn một loại terminal và dùng đúng cú pháp của nó.** Các khối lệnh có nhãn `powershell` phải chạy trong Windows PowerShell/PowerShell 7. Nếu dấu nhắc chỉ là `H:\...>` thì bạn đang dùng **Command Prompt (cmd.exe)**: không dùng `$env:` hoặc dòng chú thích bắt đầu bằng `#` trong cửa sổ đó.

```powershell
Copy-Item .env.example .env
Copy-Item deploy/release.env.example deploy/release.env
```

- Trong `deploy/release.env`, thay `POSTGRES_PASSWORD` bằng mật khẩu mạnh và đặt `POSTGRES_PORT` nếu cổng `5432` đã được dùng.
- Trong `.env`, dùng `LLM_PROVIDER=fake` để thử nghiệm không gọi AI thật, hoặc đặt `LLM_PROVIDER=gemini` và `GEMINI_API_KEY` để dùng Gemini.
- Backend chạy trực tiếp cần biến môi trường `ConnectionStrings__DefaultConnection`; script `dev.ps1 up` tự tạo giá trị này từ `deploy/release.env`.

## Chạy từng dịch vụ khi phát triển

### 1. Extension

```powershell
cd apps/extension
npm.cmd ci
npm.cmd run build
```

Nạp thư mục `apps/extension/dist` bằng chế độ **Load unpacked** của Chrome hoặc Edge. Khi sửa source, chạy `npm.cmd run dev`, sau đó reload Extension và trang YouTube.

### 2. PostgreSQL và ASP.NET Core API

Mở terminal ở thư mục gốc repository:

```powershell
docker compose --env-file deploy/release.env -f deploy/docker-compose.release.yml up -d --wait postgres

# Thay các giá trị mẫu bằng đúng dữ liệu trong deploy/release.env.
$env:ConnectionStrings__DefaultConnection = 'Host=localhost;Port=5432;Database=studylens;Username=studylens;Password=YOUR_POSTGRES_PASSWORD'
dotnet run --project services/api/src/StudyLens.Api/StudyLens.Api.csproj --launch-profile http
```

Nếu dùng **Command Prompt (cmd.exe)**, chạy khối tương đương sau (không sao chép dòng PowerShell ở trên):

```bat
docker compose --env-file deploy/release.env -f deploy/docker-compose.release.yml up -d --wait postgres
set "ConnectionStrings__DefaultConnection=Host=localhost;Port=5432;Database=studylens;Username=studylens;Password=YOUR_POSTGRES_PASSWORD"
dotnet run --project services/api/src/StudyLens.Api/StudyLens.Api.csproj --launch-profile http
```

API chạy tại `http://127.0.0.1:5000`. Kiểm tra nhanh bằng `http://127.0.0.1:5000/api/health/ready`.

### 3. FastAPI AI Service

Mở terminal khác ở thư mục gốc repository:

```powershell
cd services/ai
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

Khối trên cũng chạy được trong **cmd.exe**. Dấu `./` hoặc `/` không dùng được để gọi Python environment trong cmd; cần đúng dạng `\.venv\Scripts\python.exe`.

AI Service đọc provider và key từ file `.env` ở thư mục gốc. Với `LLM_PROVIDER=fake`, luồng kiểm thử không gọi Gemini.

### Lệnh phát triển một lần

Sau khi đã cài dependency cho Extension và AI Service, có thể dùng:

```powershell
.\dev.ps1 validate
.\dev.ps1 up
```

Lệnh `up` khởi động PostgreSQL, API, AI Service và watcher build Extension. Nhấn `Ctrl+C` để dừng watcher; dùng `.\dev.ps1 down` để dừng PostgreSQL nhưng vẫn giữ volume dữ liệu.

### Khôi phục sau khi Backend từng chưa chạy

Một phiên học chỉ được tạo khi content script đang hoạt động và Backend đã sẵn sàng. Nếu đã mở YouTube trong lúc API chưa chạy, thực hiện theo thứ tự sau:

1. Chạy `.\dev.ps1 up` và xác nhận `http://127.0.0.1:5000/api/health/ready` trả `ready`.
2. Mở `chrome://extensions` hoặc `edge://extensions`, bấm **Reload** tại StudyLens đã nạp từ `apps/extension/dist`.
3. Quay lại trang YouTube và tải lại trang một lần. Nếu panel vẫn hiện lỗi tiến trình, bấm **Thử lại**: Extension sẽ gửi lại yêu cầu tạo phiên với cùng khóa idempotency, không tạo phiên học trùng.

Không cần xóa PostgreSQL volume hoặc chạy migration lại để xử lý lỗi kết nối này.

## Chạy toàn bộ hệ thống bằng Docker

Sau khi đã tạo `.env` và `deploy/release.env`:

```powershell
# Kiểm tra source, contract, package Extension và cấu hình Compose.
.\release.ps1 verify -Provider fake

# Build image Backend và AI Service, đồng thời đóng gói Extension ZIP.
.\release.ps1 build -Provider fake

# Chạy stack local với provider giả lập, không tốn quota Gemini.
.\release.ps1 smoke -Provider fake

# Khi đã đặt GEMINI_API_KEY trong .env, chạy với Gemini thật.
.\release.ps1 smoke -Provider configured

# Dừng stack, giữ lại PostgreSQL volume.
.\release.ps1 down
```

Docker expose Backend tại `http://127.0.0.1:5000` và PostgreSQL tại `127.0.0.1:5432` (đều chỉ loopback); AI Service vẫn nằm trong mạng nội bộ Docker. Extension vẫn cần build rồi nạp `apps/extension/dist` như phần trên.

## Kiểm thử và đóng gói

```powershell
# Chạy toàn bộ gate tự động với provider giả lập.
.\release.ps1 verify -Provider fake

# Hoặc chạy riêng từng thành phần.
cd apps/extension; npm.cmd test; npm.cmd run typecheck; npm.cmd run build
cd ../..
dotnet test .\services\api\StudyLens.sln -c Release
cd services/ai; .\.venv\Scripts\python.exe -m pytest app -q
```

Khi đang dùng **cmd.exe**, gọi script PowerShell bằng lệnh sau thay vì gõ trực tiếp `release.ps1`:

```bat
powershell -NoProfile -ExecutionPolicy Bypass -File .\release.ps1 verify -Provider fake
```

ZIP Extension được tạo trong `artifacts/release`. File ZIP chỉ dùng để sideload; không chứa key, file `.env`, test, fixture hoặc source map.

## Quản trị tài khoản local

Người dùng tự đăng ký trên Extension bằng username và mật khẩu. Để cấp credential cho tài khoản cũ hoặc reset mật khẩu local:

```powershell
.\scripts\account-admin.ps1 -Action reset -Username learner.one
.\scripts\account-admin.ps1 -Action assign -Username learner.one -UserId 00000000-0000-0000-0000-000000000000
```

### PostgreSQL dùng chung

Mọi lệnh chạy trực tiếp (`dev.ps1 up` hoặc `dotnet run`), Docker release và script quản trị đều dùng đúng PostgreSQL trong `deploy/docker-compose.release.yml` với cấu hình tại `deploy/release.env`. Không còn database development thứ hai.

Mật khẩu mới có tối đa 128 ký tự và phải có ít nhất một chữ cái cùng một chữ số. Không truyền mật khẩu trên dòng lệnh: script luôn hỏi qua prompt ẩn. Nếu panel báo `rateLimited`, đợi đúng số giây trong thông báo rồi thử lại. Đăng ký/đăng nhập có giới hạn 10 lần/phút; refresh token dùng giới hạn riêng nên không tiêu chung lượt đăng nhập.

Script yêu cầu nhập mật khẩu qua prompt ẩn và thu hồi token cũ sau khi reset.
