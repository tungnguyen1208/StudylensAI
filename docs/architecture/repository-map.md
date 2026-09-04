# Repository Map

Tài liệu này mô tả ý nghĩa và trách nhiệm của các file/folder hiện có trong StudyLens AI. Repo đang ở giai đoạn walking skeleton, nên nhiều thư mục là khung chuẩn để các module MVP phát triển tiếp, chưa chứa business feature thật.

## Root

| Path | Ý nghĩa |
| --- | --- |
| `AGENTS.md` | Rulebook kiến trúc và quy tắc phát triển cho StudyLens AI. Đây là nguồn chuẩn về scope MVP, boundary giữa Extension, ASP.NET Backend, FastAPI và LLM provider. |
| `README.md` | Hướng dẫn tổng quan repo, cách cài/chạy từng component và các health endpoint hiện có. |
| `PROMPT_BOOTSTRAP_REPO.md` | Prompt bootstrap đã dùng để dựng walking skeleton. Đây là tài liệu yêu cầu khởi tạo, không phải runtime code. |
| `.editorconfig` | Quy tắc format cơ bản cho editor: encoding, newline, indent, trim whitespace. |
| `.env.example` | Mẫu biến môi trường với placeholder, không chứa secret thật. Gồm URL backend, URL AI service, database connection và cấu hình LLM tương lai. |
| `.gitignore` | Bỏ qua dependency, build output, virtual environment, local database, log và file IDE. |

## `apps/`

Chứa các ứng dụng client. Hiện chỉ có Chrome/Edge extension cho MVP.

### `apps/extension/`

Extension Manifest V3 dùng TypeScript, React và Vite.

| Path | Ý nghĩa |
| --- | --- |
| `manifest.json` | Manifest V3 của Chrome/Edge extension: khai báo side panel, service worker, content script, permissions và host permissions. |
| `package.json` | Metadata, dependency và npm scripts cho extension. |
| `package-lock.json` | Lockfile để cài dependency Node nhất quán. |
| `tsconfig.json` | Cấu hình TypeScript cho React, Vite, Chrome extension types và Node types cho config build. |
| `vite.config.ts` | Cấu hình Vite build nhiều entry: side panel HTML, background service worker và YouTube content script. |
| `sidepanel.html` | HTML entry cho React side panel. |
| `scripts/copy-manifest.mjs` | Script copy `manifest.json` vào `dist` sau khi build để Chrome/Edge load unpacked extension được. |

### `apps/extension/src/`

Source code extension, tách theo boundary trong `AGENTS.md`.

| Path | Ý nghĩa |
| --- | --- |
| `config.ts` | Cấu hình client-side cho extension. Hiện tập trung `VITE_BACKEND_URL` và fallback `http://localhost:5000`. |
| `api/api-client.ts` | HTTP client của extension. Hiện chỉ gọi `GET {BACKEND_URL}/api/health`; React component không gọi fetch trực tiếp. |
| `background/service-worker.ts` | Background service worker MV3. Hiện log khi install và mở side panel khi click icon extension. |
| `content/youtube-detector.ts` | Content script cô lập phần YouTube DOM/page integration. Hiện detect YouTube watch page và đọc metadata video tối thiểu. |
| `sidepanel/App.tsx` | UI React đơn giản cho side panel: title, backend status, backend URL, lỗi kết nối nếu có. |
| `sidepanel/main.tsx` | React entrypoint render `App` vào `sidepanel.html`. |
| `sidepanel/styles.css` | Style tối thiểu cho side panel. |
| `features/activation/` | Khung module M1 Video & Activation: auto/manual activation, classification decision, override ON/OFF trong tương lai. |
| `features/session/` | Khung module M2 Learning Session: transcript, watched-time tracking, segmentation trong tương lai. |
| `features/quiz/` | Khung module M3 Quiz Generation: quiz state/UI trong tương lai. |
| `features/history/` | Khung module M5 History: lịch sử học tập trong tương lai. |
| `features/settings/` | Khung module M6 Settings & Reliability: settings và trạng thái lỗi/retry trong tương lai. |
| `models/` | Nơi đặt shared TypeScript models của extension khi bắt đầu feature thật. |

## `services/`

Chứa các service server-side của walking skeleton.

### `services/api/`

ASP.NET Core Web API. Backend là integration boundary chính cho extension, đồng thời sở hữu persistence và điều phối AI service.

| Path | Ý nghĩa |
| --- | --- |
| `StudyLens.Api.csproj` | Project file ASP.NET Core 8, khai báo EF Core SQLite và Swagger dependency. |
| `Program.cs` | Startup chính: controllers, Swagger, CORS local dev, HttpClient cho AI service, EF Core SQLite, exception-safe startup. |
| `appsettings.json` | Cấu hình mặc định: connection string SQLite, AI service base URL, logging. |
| `appsettings.Development.json` | Logging config cho môi trường Development. |
| `Properties/launchSettings.json` | Launch profile local, chạy backend ở `http://localhost:5000`. |
| `Controllers/HealthController.cs` | Thin controller cho `GET /api/health` và diagnostic endpoint `GET /api/health/ai-service`. |
| `AI/AIServiceClient.cs` | HTTP client encapsulation để backend gọi FastAPI `GET /health`. Extension không gọi FastAPI trực tiếp. |
| `AI/AIServiceOptions.cs` | Options binding cho `AIService:BaseUrl`. |
| `Data/StudyLensDbContext.cs` | EF Core DbContext tối thiểu, SQLite-ready, chưa tạo production schema. |
| `Data/Entities/` | Khung nơi đặt EF entities tương lai như User, Video, StudySession, TranscriptSegment, Question, Answer. |
| `Data/Migrations/` | Khung nơi đặt EF migrations khi schema được thêm. |
| `Common/Responses/HealthResponse.cs` | DTO response cho backend health. |
| `Common/Responses/AIHealthResponse.cs` | DTO response khi backend nhận health từ AI service. |
| `Common/Exceptions/` | Khung cho exception types chung trong tương lai. |
| `Common/Validation/` | Khung cho validation helper/rules trong tương lai. |
| `Features/Videos/` | Khung feature M1/MVP cho video metadata và classification orchestration. |
| `Features/Sessions/` | Khung feature M2 cho study session, watched time và transcript segments. |
| `Features/Quizzes/` | Khung feature M3/M4 cho quiz generation và answer flow. |
| `Features/History/` | Khung feature M5 cho learning history. |
| `Features/Settings/` | Khung feature M6 cho settings và reliability behavior. |

### `services/ai-service/`

FastAPI AI service. Service này sẽ xử lý classification, transcript processing, question generation, grading và output validation trong các feature sau.

| Path | Ý nghĩa |
| --- | --- |
| `requirements.txt` | Dependency runtime Python: FastAPI, Uvicorn, Pydantic. |
| `pyproject.toml` | Metadata project Python và cấu hình cơ bản. |
| `app/main.py` | Entry app FastAPI, include health router. |
| `app/api/health.py` | Route `GET /health`, trả trạng thái AI service. |
| `app/api/classification.py` | Router placeholder cho classification endpoint tương lai. |
| `app/api/questions.py` | Router placeholder cho question generation endpoint tương lai. |
| `app/api/grading.py` | Router placeholder cho grading endpoint tương lai. |
| `app/services/classifier.py` | Service placeholder cho video classification logic tương lai. |
| `app/services/transcript_processor.py` | Service placeholder cho transcript cleaning/normalization tương lai. |
| `app/services/question_generator.py` | Service placeholder cho question generation tương lai. |
| `app/services/grader.py` | Service placeholder cho short-answer grading tương lai. |
| `app/schemas/health.py` | Pydantic schema cho health response. |
| `app/schemas/classification.py` | Pydantic schema cho `ClassificationResult` theo contract StudyLens. |
| `app/schemas/question.py` | Pydantic schema cho `QuizQuestion` và question type. |
| `app/schemas/grading.py` | Pydantic schema cho `AnswerResult`. |
| `app/prompts/classification.txt` | Placeholder prompt file cho classification, chưa chứa prompt thật. |
| `app/prompts/question_generation.txt` | Placeholder prompt file cho quiz generation, chưa chứa prompt thật. |
| `app/prompts/grading.txt` | Placeholder prompt file cho grading, chưa chứa prompt thật. |
| `app/llm/client.py` | Abstract `LLMClient` để provider cloud/vLLM tương lai implement, không bind vendor cụ thể. |
| `app/llm/providers/` | Khung cho các implementation LLM provider sau này. |
| `app/core/config.py` | Cấu hình AI service tối thiểu đọc từ environment. |
| `app/core/logging.py` | Hàm cấu hình logging cơ bản cho AI service. |

## `docs/`

Tài liệu kiến trúc, API contract và test data.

| Path | Ý nghĩa |
| --- | --- |
| `docs/api-contracts/README.md` | Quy tắc: mọi API contract giữa Extension, Backend và FastAPI phải được document trước hoặc cùng lúc implement. |
| `docs/api-contracts/health.md` | Contract cho `GET /api/health`, `GET /api/health/ai-service` và `GET /health`. |
| `docs/architecture/README.md` | Tổng quan kiến trúc walking skeleton và ownership từng layer. |
| `docs/architecture/repository-map.md` | Tài liệu này: mô tả ý nghĩa các file/folder hiện tại. |
| `docs/test-data/` | Khung chứa dữ liệu test/demo sau này. |

## `scripts/`

Khung chứa script tiện ích cho development, demo hoặc automation sau này. Hiện chưa có script thực thi ngoài placeholder `.gitkeep`.

## `docker/`

Khung chứa cấu hình Docker local sau này nếu cần. Walking skeleton hiện chưa dùng Docker để tránh thêm hạ tầng không cần thiết.

## Generated And Ignored Local Outputs

Các path sau có thể xuất hiện sau khi verify nhưng không thuộc source chính:

| Path | Ý nghĩa |
| --- | --- |
| `apps/extension/node_modules/` | Dependency Node đã cài bằng npm. |
| `apps/extension/.npm-cache/` | Cache npm cục bộ trong workspace, dùng để tránh lỗi quyền cache user profile trên Windows. |
| `apps/extension/dist/` | Build output của extension để load unpacked vào Chrome/Edge. |
| `services/api/bin/`, `services/api/obj/` | Build/restore output của .NET. |
| `services/ai-service/.venv/` | Virtual environment Python local. |
| `__pycache__/` | Python bytecode cache sinh ra khi import/chạy app. |

Những output này đã được ignore trong `.gitignore`.

