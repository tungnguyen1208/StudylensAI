# StudyLens AI — Prompt V2: Bootstrap Modular Monorepo Framework

> **Mục đích:** Dùng prompt này với Codex tại root của repository mới để dựng **khung kiến trúc / framework ban đầu** cho StudyLens AI.  
> **Phạm vi:** Chỉ dựng repository structure, project bootstrap, shared infrastructure, module entry points, health-check flow và test skeleton.  
> **Không triển khai business feature A01–A09, B01–B10, C01–C09 ở bước này.**

---

## 0. Vai trò của bạn

Bạn đang bootstrap repository cho **StudyLens AI**, một Chrome/Edge Browser Extension hỗ trợ người dùng học kiến thức từ video YouTube bằng transcript và quiz.

Hệ thống MVP gồm:

```text
YouTube Web
    ↓
Chrome / Edge Extension
    ↓ HTTP REST
ASP.NET Core 8 Backend
    ├── SQLite
    ↓ Internal HTTP REST
FastAPI AI Service
    ↓
LLM Provider
```

Repository phải được thiết kế để **3 developer + 3 phiên Codex có thể làm việc song song**, mỗi người sở hữu một **vertical business module** xuyên suốt Extension → Backend → AI → Contract → Test.

Không chia repository theo kiểu:

```text
Dev 1 = Frontend
Dev 2 = Backend
Dev 3 = AI
```

Mà phải chia theo:

```text
Dev 1 = Video Activation
Dev 2 = Session & Quiz
Dev 3 = Assessment & History
```

---

# 1. Đọc tài liệu trước khi thay đổi

Trước khi tạo hoặc sửa bất kỳ file nào:

1. Đọc `AGENTS.md` hoàn toàn.
2. Xem `AGENTS.md` là rulebook cao nhất của repository.
3. Nếu repository đã tồn tại một phần, inspect cây thư mục trước khi tạo mới.
4. Không xóa hoặc rewrite code đang tồn tại chỉ để ép repository giống prompt.
5. Nếu checkout hiện tại khác kiến trúc bên dưới, báo rõ khác biệt trước khi thay đổi lớn.
6. Không triển khai business feature trong bootstrap này.

Contract baseline:

```text
0.1.0
```

---

# 2. Stack công nghệ bắt buộc

## Extension

```text
TypeScript
React
Vite
Manifest V3
Chrome
Edge
```

## Backend

```text
C#
ASP.NET Core 8
Entity Framework Core
SQLite
Swagger / OpenAPI
```

## AI Service

```text
Python
FastAPI
Pydantic
pytest
Provider-independent LLM abstraction
```

Không tự ý thay đổi stack nếu chưa được yêu cầu.

---

# 3. Không over-engineering

Không thêm các thành phần sau trong bootstrap:

```text
Kafka
RabbitMQ
Redis
Kubernetes
Helm
Terraform
Vector Database
Event Sourcing
Distributed Event Bus
Microservice mới ngoài API + AI Service
Complex Unit of Work framework
Complex generic repository framework
Full CQRS infrastructure
Background job cluster
```

Một số pattern như Command/Query theo use case có thể xuất hiện **bên trong từng module sau này**, nhưng bootstrap không được dựng framework CQRS tổng quát phức tạp.

Ưu tiên:

1. Chạy được.
2. Dễ hiểu.
3. Dễ chia việc.
4. Ít conflict Git.
5. Dễ test.
6. Dễ demo.

---

# 4. Nguyên tắc kiến trúc cốt lõi

Các rule sau là bắt buộc:

1. Extension chỉ gọi ASP.NET Backend.
2. Extension không gọi FastAPI trực tiếp.
3. Extension không gọi Cloud LLM/vLLM trực tiếp.
4. Extension không chứa LLM API key.
5. ASP.NET Backend là nơi duy nhất đọc/ghi database nghiệp vụ.
6. FastAPI không lưu StudySession/user business state.
7. Business logic không đặt trong React component.
8. Business logic không đặt trực tiếp trong ASP.NET endpoint.
9. Business logic không đặt trực tiếp trong FastAPI router.
10. Module khác không import repository/service nội bộ của nhau.
11. Cross-module communication dùng:
    - public REST contract;
    - internal AI contract;
    - extension message;
    - server-side application port/public record đã công bố.
12. Mutation retry được trong tương lai phải có khả năng idempotent.
13. Video timestamp dùng integer milliseconds.
14. System timestamp dùng ISO-8601 UTC.
15. JSON dùng `camelCase`.
16. Enum dùng string.
17. Public Extension response không được lộ correct answer/rubric trước khi submit.

---

# 5. Ownership model của 3 developer

## Dev 1 — Video Activation & Content Acquisition

Dev 1 sẽ sở hữu:

```text
apps/extension/src/platform/youtube/**
apps/extension/src/features/video-activation/**

services/api/src/StudyLens.Api/Features/VideoActivation/**
services/api/tests/VideoActivation.Tests/**

services/ai/app/features/classification/**

contracts/public-api/video-activation.yaml
contracts/ai-api/classification.yaml
contracts/extension-messages/video-activation.schema.json
contracts/examples/video-activation/**

tests/contract/video-activation/**
tests/e2e/video-activation/**
```

Business tương lai:

```text
YouTube detector
PlayerPort
Transcript acquisition
Transcript normalization
Manual activation
Auto classification
Settings
ActivationDecision
```

Bootstrap **không triển khai các business trên**.

---

## Dev 2 — Study Session & Quiz Generation

Dev 2 sẽ sở hữu:

```text
apps/extension/src/features/session-quiz/**

services/api/src/StudyLens.Api/Features/SessionQuiz/**
services/api/tests/SessionQuiz.Tests/**

services/ai/app/features/question_generation/**

contracts/public-api/session-quiz.yaml
contracts/ai-api/question-generation.yaml
contracts/extension-messages/session-quiz.schema.json
contracts/examples/session-quiz/**

tests/contract/session-quiz/**
tests/e2e/session-quiz/**
```

Business tương lai:

```text
StudySession
activeStudyMs
PlaybackSpan
StudySegment
Quiz
Question
Question generation
QuestionPublic
```

Bootstrap **không triển khai các business trên**.

---

## Dev 3 — Assessment, Grading & History

Dev 3 sẽ sở hữu:

```text
apps/extension/src/features/assessment-history/**

services/api/src/StudyLens.Api/Features/AssessmentHistory/**
services/api/tests/AssessmentHistory.Tests/**

services/ai/app/features/grading/**

contracts/public-api/assessment-history.yaml
contracts/ai-api/grading.yaml
contracts/extension-messages/assessment-history.schema.json
contracts/examples/assessment-history/**

tests/contract/assessment-history/**
tests/e2e/assessment-history/**
```

Business tương lai:

```text
AnswerForm
AnswerAttempt
GradeResult
MCQ grading
Short Answer grading
SEEK_REQUEST
History
```

Bootstrap **không triển khai các business trên**.

---

# 6. Kiến trúc repository bắt buộc

Tạo hoặc normalize repository về dạng:

```text
studylens/
├── AGENTS.md
├── README.md
├── .gitignore
├── .editorconfig
├── .env.example
│
├── apps/
│   └── extension/
│       ├── manifest.json
│       ├── package.json
│       ├── tsconfig.json
│       ├── vite.config.ts
│       └── src/
│           ├── shell/
│           │   ├── App.tsx
│           │   ├── sidepanel-main.tsx
│           │   ├── service-worker.ts
│           │   ├── content-script.ts
│           │   ├── feature-registry.ts
│           │   └── app-store.ts
│           │
│           ├── platform/
│           │   └── youtube/
│           │       └── .gitkeep
│           │
│           ├── features/
│           │   ├── video-activation/
│           │   │   └── index.ts
│           │   ├── session-quiz/
│           │   │   └── index.ts
│           │   └── assessment-history/
│           │       └── index.ts
│           │
│           ├── shared/
│           │   ├── config/
│           │   │   └── extension-config.ts
│           │   ├── http/
│           │   │   ├── http-client.ts
│           │   │   └── http-error.ts
│           │   └── messaging/
│           │       ├── message-bus.ts
│           │       └── message-types.ts
│           │
│           └── generated/
│               └── .gitkeep
│
├── services/
│   ├── api/
│   │   ├── src/
│   │   │   └── StudyLens.Api/
│   │   │       ├── Program.cs
│   │   │       ├── StudyLens.Api.csproj
│   │   │       │
│   │   │       ├── Features/
│   │   │       │   ├── VideoActivation/
│   │   │       │   │   └── VideoActivationModule.cs
│   │   │       │   ├── SessionQuiz/
│   │   │       │   │   └── SessionQuizModule.cs
│   │   │       │   └── AssessmentHistory/
│   │   │       │       └── AssessmentHistoryModule.cs
│   │   │       │
│   │   │       ├── BuildingBlocks/
│   │   │       │   ├── Health/
│   │   │       │   │   └── HealthEndpoint.cs
│   │   │       │   ├── Errors/
│   │   │       │   │   └── ErrorEnvelope.cs
│   │   │       │   └── Http/
│   │   │       │       └── AiHealthClient.cs
│   │   │       │
│   │   │       ├── Infrastructure/
│   │   │       │   └── Persistence/
│   │   │       │       ├── StudyLensDbContext.cs
│   │   │       │       └── Migrations/
│   │   │       │           └── .gitkeep
│   │   │       │
│   │   │       ├── appsettings.json
│   │   │       └── appsettings.Development.json
│   │   │
│   │   └── tests/
│   │       ├── VideoActivation.Tests/
│   │       │   └── VideoActivation.Tests.csproj
│   │       ├── SessionQuiz.Tests/
│   │       │   └── SessionQuiz.Tests.csproj
│   │       └── AssessmentHistory.Tests/
│   │           └── AssessmentHistory.Tests.csproj
│   │
│   └── ai/
│       ├── requirements.txt
│       ├── pyproject.toml
│       └── app/
│           ├── __init__.py
│           ├── main.py
│           │
│           ├── platform/
│           │   ├── __init__.py
│           │   ├── config.py
│           │   ├── health.py
│           │   └── llm/
│           │       ├── __init__.py
│           │       ├── provider.py
│           │       └── fake_provider.py
│           │
│           └── features/
│               ├── __init__.py
│               ├── classification/
│               │   ├── __init__.py
│               │   └── router.py
│               ├── question_generation/
│               │   ├── __init__.py
│               │   └── router.py
│               └── grading/
│                   ├── __init__.py
│                   └── router.py
│
├── contracts/
│   ├── public-api/
│   │   ├── root.yaml
│   │   ├── video-activation.yaml
│   │   ├── session-quiz.yaml
│   │   └── assessment-history.yaml
│   │
│   ├── ai-api/
│   │   ├── root.yaml
│   │   ├── classification.yaml
│   │   ├── question-generation.yaml
│   │   └── grading.yaml
│   │
│   ├── extension-messages/
│   │   ├── video-activation.schema.json
│   │   ├── session-quiz.schema.json
│   │   └── assessment-history.schema.json
│   │
│   └── examples/
│       ├── video-activation/
│       │   └── .gitkeep
│       ├── session-quiz/
│       │   └── .gitkeep
│       └── assessment-history/
│           └── .gitkeep
│
├── tests/
│   ├── contract/
│   │   ├── video-activation/
│   │   │   └── .gitkeep
│   │   ├── session-quiz/
│   │   │   └── .gitkeep
│   │   └── assessment-history/
│   │       └── .gitkeep
│   │
│   └── e2e/
│       ├── video-activation/
│       │   └── .gitkeep
│       ├── session-quiz/
│       │   └── .gitkeep
│       └── assessment-history/
│           └── .gitkeep
│
├── docs/
│   └── architecture/
│       ├── README.md
│       └── module-ownership.md
│
├── scripts/
│   └── README.md
│
└── deploy/
    └── README.md
```

Nếu một `.gitkeep` không cần thiết vì Git đã có file thực trong folder thì không cần tạo thêm.

---

# 7. Ý nghĩa và yêu cầu từng vùng Root

## `AGENTS.md`

Không rewrite file này nếu đã có.

Vai trò:

```text
Architecture rulebook
Allowed paths
HOT files
Contract baseline
Testing rules
Git/Codex rules
Security rules
```

Nếu thiếu hoàn toàn, chỉ tạo skeleton ngắn và báo rằng nội dung chi tiết cần được cung cấp riêng.

---

## `README.md`

Phải mô tả:

```text
StudyLens là gì
Kiến trúc hệ thống
Repository structure
Yêu cầu môi trường
Cách chạy Extension
Cách chạy Backend
Cách chạy AI Service
Health endpoints
Cách build/test
Module ownership
HOT files
```

Chỉ ghi command đã thực sự tồn tại trong project.

---

## `.gitignore`

Tối thiểu ignore:

```text
node_modules/
dist/
.env
.env.local

bin/
obj/
*.db
*.db-shm
*.db-wal

.venv/
venv/
__pycache__/
.pytest_cache/
.ruff_cache/

.vscode/
.idea/

coverage/
```

Không ignore `.env.example`.

---

## `.editorconfig`

Tạo format cơ bản thống nhất:

```text
UTF-8
LF
final newline
spaces
indent size phù hợp từng loại file
```

Không cần style rules phức tạp.

---

## `.env.example`

Chỉ chứa placeholder.

Ví dụ concept:

```text
BACKEND_URL=http://localhost:5000
AI_SERVICE_URL=http://localhost:8000
DATABASE_CONNECTION=Data Source=studylens.db
LLM_PROVIDER=fake
LLM_API_KEY=
LLM_BASE_URL=
```

Không đưa `LLM_API_KEY` vào Extension runtime config.

---

# 8. Extension framework chi tiết

## 8.1 `manifest.json` `[HOT]`

Tạo Manifest V3 tối thiểu để:

```text
load unpacked được
có service worker
có content script cho YouTube
có side panel
```

Chỉ xin permissions cần thiết cho walking skeleton.

Không xin permissions quá rộng nếu chưa cần.

Không triển khai transcript/player business trong manifest.

Sau bootstrap, đây là `[HOT]`.

---

## 8.2 `src/shell/App.tsx` `[HOT]`

Root Side Panel UI.

Chỉ render màn hình bootstrap đơn giản:

```text
StudyLens
Backend status
AI status nếu Backend trả được
Module registration status tùy chọn
```

Không render quiz thật.

Không chứa:

```text
classification logic
session timer
grading
history
```

---

## 8.3 `sidepanel-main.tsx` `[HOT]`

React entry point.

Nhiệm vụ:

```text
bootstrap React
mount App
```

Không có business logic.

---

## 8.4 `service-worker.ts` `[HOT]`

Background entry point Manifest V3.

Bootstrap chỉ cần:

```text
khởi tạo shared messaging nếu cần
listen basic lifecycle
không implement business module
```

Không tự quản lý activation/session/grading.

---

## 8.5 `content-script.ts` `[HOT]`

Content script entry point chạy trên YouTube.

Bootstrap chỉ cần:

```text
khởi động feature/platform hooks tối thiểu
không implement A01 YouTube detector hoàn chỉnh
```

Không đọc transcript trong bootstrap.

---

## 8.6 `feature-registry.ts` `[HOT]`

Đây là integration point quan trọng.

Tạo stable registration cho ba feature:

```text
registerVideoActivationFeature()
registerSessionQuizFeature()
registerAssessmentHistoryFeature()
```

Trong bootstrap, cả ba function có thể là compile-safe no-op hoặc trả metadata đơn giản.

`feature-registry.ts` đăng ký cả ba từ đầu.

Mục tiêu:

```text
Dev 1/2/3 không cần sửa feature-registry.ts trong task thường ngày
```

Không đặt business rule trong registry.

---

## 8.7 `app-store.ts` `[HOT]`

Chỉ tạo root integration store minimal nếu thực sự cần.

Không tạo complex state management framework.

Nếu React Context/plain reducer đủ dùng thì không tự thêm Redux/Zustand chỉ vì bootstrap.

Nếu tạo file này, nó chỉ nên đóng vai trò:

```text
root state composition
```

Business state sau này vẫn nằm trong từng feature.

---

# 9. Extension feature folders

## `features/video-activation/` — Dev 1

Bootstrap chỉ tạo:

```text
index.ts
```

Public entry point tối thiểu.

Không tạo:

```text
ActivationToggle
activation-manager
transcript-service
```

trong bootstrap.

Các file đó thuộc Axx.

---

## `features/session-quiz/` — Dev 2

Bootstrap chỉ tạo:

```text
index.ts
```

Không tạo timer/segment/quiz thật.

---

## `features/assessment-history/` — Dev 3

Bootstrap chỉ tạo:

```text
index.ts
```

Không tạo AnswerForm/grading/history thật.

---

# 10. `platform/youtube/` — vùng Dev 1

Chỉ tạo folder.

Không triển khai:

```text
youtube-detector.ts
youtube-player-adapter.ts
transcript-reader.ts
youtube-events.ts
```

Các file trên sẽ được tạo bởi A01–A03.

Không dùng một implementation tạm quá lớn vì sẽ giẫm task Dev 1.

---

# 11. Extension Shared Infrastructure

## `shared/config/extension-config.ts`

Tập trung đọc config an toàn cho browser.

Tối thiểu cung cấp:

```text
backendUrl
```

Không expose:

```text
LLM_API_KEY
database connection string
AI internal secret
```

---

## `shared/http/http-client.ts`

Tạo HTTP primitive dùng chung.

Tối thiểu hỗ trợ:

```text
base URL
GET
JSON parsing
AbortSignal / timeout nếu đơn giản
typed error
```

Walking skeleton dùng nó để gọi:

```text
GET {BACKEND_URL}/api/health
```

Business API cụ thể sau này vẫn nằm trong:

```text
features/video-activation/api/
features/session-quiz/api/
features/assessment-history/api/
```

Không biến shared HTTP thành một God Service.

---

## `shared/http/http-error.ts`

Model lỗi transport chung.

Có thể chuẩn bị shape gần với:

```text
code
status
message
traceId
retryable
```

Không invent domain error codes A/B/C trong bootstrap.

---

## `shared/messaging/message-bus.ts`

Tạo abstraction messaging tối thiểu nếu cần.

Mục tiêu tương lai:

```text
content script
service worker
side panel
feature modules
```

có thể giao tiếp mà không gọi trực tiếp nhau.

Không implement business events đầy đủ trong bootstrap.

---

## `shared/messaging/message-types.ts`

Chỉ định nghĩa technical/basic message type cần để project compile.

Không định nghĩa đầy đủ:

```text
ACTIVATION_DECIDED
QUIZ_AVAILABLE
SEEK_REQUEST
```

nếu các contract A01/B01/C01 chưa bắt đầu.

---

## `generated/`

Dành cho generated OpenAPI/schema client về sau.

Không sửa code trong đây bằng tay.

Bootstrap chỉ tạo folder.

---

# 12. Backend framework chi tiết

Backend dùng **modular monolith theo business feature**.

Không tạo global business folders:

```text
Controllers/
Services/
Repositories/
Entities/
Models/
```

Toàn bộ business feature về sau nằm dưới:

```text
Features/VideoActivation/
Features/SessionQuiz/
Features/AssessmentHistory/
```

Mỗi module sau này tự tổ chức:

```text
Api/
Application/
Domain/
Infrastructure/
```

---

# 13. `Program.cs` `[HOT]`

Bootstrap phải cấu hình:

```text
WebApplication
Configuration
CORS
Swagger/OpenAPI
EF Core SQLite
HttpClient
Health endpoint
3 module registrations
3 module endpoint mappings
```

Ví dụ concept:

```csharp
builder.Services.AddVideoActivationModule(builder.Configuration);
builder.Services.AddSessionQuizModule(builder.Configuration);
builder.Services.AddAssessmentHistoryModule(builder.Configuration);
```

và:

```csharp
app.MapVideoActivationEndpoints();
app.MapSessionQuizEndpoints();
app.MapAssessmentHistoryEndpoints();
```

Các method trong bootstrap có thể chưa map business endpoint.

Mục tiêu là **Program.cs chỉ cần nối module một lần**.

Sau bootstrap:

```text
Dev 1 không tự sửa Program.cs
Dev 2 không tự sửa Program.cs
Dev 3 không tự sửa Program.cs
```

---

# 14. `VideoActivationModule.cs`

Tạo public module entry point tối thiểu.

Nên có shape ổn định kiểu:

```csharp
public static IServiceCollection AddVideoActivationModule(
    this IServiceCollection services,
    IConfiguration configuration);

public static IEndpointRouteBuilder MapVideoActivationEndpoints(
    this IEndpointRouteBuilder endpoints);
```

Bootstrap implementation có thể không đăng ký business service nào.

Không tạo entity/business handler Axx.

---

# 15. `SessionQuizModule.cs`

Tương tự Dev 2.

Tạo stable module registration/mapping entry point.

Không implement B02+.

---

# 16. `AssessmentHistoryModule.cs`

Tương tự Dev 3.

Không implement C03+.

---

# 17. `BuildingBlocks/Health/HealthEndpoint.cs`

Implement:

```text
GET /api/health
```

Response tối thiểu:

```json
{
  "status": "ok",
  "service": "studylens-api"
}
```

Có thể thêm AI health status nếu thiết kế response vẫn đơn giản, nhưng không bắt buộc.

Endpoint không thuộc Dev 1/2/3.

---

# 18. `BuildingBlocks/Errors/ErrorEnvelope.cs`

Tạo shared error response shape:

```text
code
status
message
traceId
retryable
```

Chỉ tạo model chung.

Domain-specific error code sẽ do module owner định nghĩa sau.

---

# 19. `BuildingBlocks/Http/AiHealthClient.cs`

Walking-skeleton client duy nhất dùng chung để chứng minh:

```text
ASP.NET Backend
      ↓
FastAPI /health
```

Tối thiểu:

```text
typed HttpClient
configurable AI_SERVICE_URL
timeout/cancellation cơ bản
```

Không implement:

```text
classification
question generation
grading
```

Các AI business clients tương lai nằm trong từng module:

```text
VideoActivation/Infrastructure/ClassificationAiClient.cs
SessionQuiz/Infrastructure/QuestionGenerationClient.cs
AssessmentHistory/Infrastructure/GradingGateway.cs
```

---

# 20. `StudyLensDbContext.cs` `[HOT]`

Tạo EF Core DbContext tối thiểu.

Không tạo business DbSet nếu chưa cần.

Phải hỗ trợ tương lai module-owned configuration bằng assembly scanning.

Ví dụ concept:

```csharp
protected override void OnModelCreating(ModelBuilder modelBuilder)
{
    base.OnModelCreating(modelBuilder);
    modelBuilder.ApplyConfigurationsFromAssembly(typeof(StudyLensDbContext).Assembly);
}
```

Mục tiêu:

```text
Dev 1 thêm VideoConfiguration trong module Dev 1
Dev 2 thêm QuizConfiguration trong module Dev 2
Dev 3 thêm AnswerAttemptConfiguration trong module Dev 3
```

mà không phải sửa `StudyLensDbContext.cs`.

---

# 21. `Migrations/` `[HOT]`

Chỉ tạo folder.

Không tạo full production schema.

Không tạo migration cho:

```text
Video
TranscriptSnapshot
StudySession
Quiz
Question
AnswerAttempt
GradeResult
```

trong bootstrap.

Sau này Integration Captain quản lý migration/model snapshot.

---

# 22. Backend test projects

Tạo ba test project độc lập:

```text
VideoActivation.Tests
SessionQuiz.Tests
AssessmentHistory.Tests
```

Mỗi project reference `StudyLens.Api`.

Bootstrap test có thể chỉ kiểm tra:

```text
module entry point exists / compile
```

nếu cần.

Không viết business tests A/B/C.

---

# 23. FastAPI framework

Cấu trúc:

```text
services/ai/app/
├── main.py
├── platform/
└── features/
```

Không dùng kiến trúc global:

```text
api/
services/
schemas/
prompts/
```

cho toàn AI service.

Business AI phải chia theo feature owner.

---

# 24. `main.py` `[HOT]`

Tạo FastAPI app.

Register từ bootstrap:

```text
classification router
question_generation router
grading router
health router
```

Ví dụ concept:

```python
app.include_router(classification_router)
app.include_router(question_generation_router)
app.include_router(grading_router)
```

Router business lúc bootstrap có thể rỗng nhưng syntactically valid.

Sau bootstrap Dev 1/2/3 không cần sửa `main.py` cho task thường ngày.

---

# 25. `platform/config.py`

Đọc environment/config AI service:

```text
LLM_PROVIDER
LLM_API_KEY
LLM_BASE_URL
```

Có default an toàn:

```text
LLM_PROVIDER=fake
```

Không hardcode provider-specific key.

---

# 26. `platform/health.py`

Implement:

```text
GET /health
```

Response:

```json
{
  "status": "ok",
  "service": "studylens-ai"
}
```

---

# 27. `platform/llm/provider.py`

Tạo abstraction provider-independent tối thiểu.

Không bind vào OpenAI/Gemini/Claude.

Shape có thể là Protocol/ABC đơn giản.

Ví dụ concept:

```python
class LlmProvider(Protocol):
    async def generate(self, prompt: str) -> str:
        ...
```

Không cần streaming/tool calling/vector search trong bootstrap.

---

# 28. `platform/llm/fake_provider.py`

Tạo deterministic fake implementation tối thiểu.

Mục tiêu:

```text
AI service có provider hợp lệ để test/config
không cần API key
không gọi Internet
```

Không giả lập business classification/question/grading ở bootstrap.

---

# 29. AI feature routers

## `features/classification/router.py`

Dev 1 owner.

Bootstrap:

```text
APIRouter tồn tại
không có classification endpoint thật
```

---

## `features/question_generation/router.py`

Dev 2 owner.

Bootstrap chỉ tạo router.

---

## `features/grading/router.py`

Dev 3 owner.

Bootstrap chỉ tạo router.

---

# 30. Contract framework

`contracts/` là source of truth cho giao tiếp.

Baseline:

```text
0.1.0
```

Bootstrap phải tạo cấu trúc nhưng **không invent full business DTO**.

---

# 31. `contracts/public-api/`

Giao tiếp:

```text
Extension
    ↕
ASP.NET Backend
```

Files:

```text
root.yaml
video-activation.yaml
session-quiz.yaml
assessment-history.yaml
```

Feature files thuộc owner tương ứng.

`root.yaml` là `[HOT]`.

Trong bootstrap:

- YAML phải syntactically valid nếu có nội dung.
- Có thể chỉ chứa metadata/version/minimal placeholder.
- Không tự thiết kế hết endpoint A/B/C.

---

# 32. `contracts/ai-api/`

Giao tiếp:

```text
ASP.NET Backend
    ↕
FastAPI
```

Files:

```text
root.yaml
classification.yaml
question-generation.yaml
grading.yaml
```

Không dùng contract internal này làm Extension public response.

---

# 33. `contracts/extension-messages/`

Tương lai chứa schema:

```text
video-activation.schema.json
session-quiz.schema.json
assessment-history.schema.json
```

Bootstrap có thể tạo JSON Schema shell tối thiểu hợp lệ.

Không invent đầy đủ payload trước A01/B01/C01.

Canonical future envelope sẽ bám baseline:

```text
type
contractVersion
correlationId
tabId
youtubeVideoId
occurredAtUtc
payload
```

Nhưng nếu chưa có schema được review, chỉ tạo placeholder rõ ràng, không tự khóa field business quá sớm.

---

# 34. `contracts/examples/`

Tạo ba folder:

```text
video-activation/
session-quiz/
assessment-history/
```

Chưa cần full fixture business.

Các task A01/B01/C01 sẽ thêm fixture thật.

---

# 35. Cross-module seams cần kiến trúc hỗ trợ

Bootstrap không implement business contract nhưng repository phải sẵn sàng cho các seam sau.

## Dev 1 → Dev 2

Tương lai:

```text
ActivationDecision
TranscriptSnapshotRef
PreferenceSnapshot
Player events
```

Server-side:

```text
ITranscriptSnapshotReader
TranscriptSnapshotForSession
```

Dev 2 không được import TranscriptRepository.

---

## Dev 2 → Dev 3

Tương lai:

```text
QuizAvailable
QuestionPublic
QuestionSourceRef
SessionSnapshot
```

Server-side:

```text
QuestionForAssessment
```

Dev 3 sẽ có:

```text
IQuestionAssessmentReader
```

Integration Captain wire adapter.

Dev 3 không đọc Question repository trực tiếp.

---

## Dev 3 → Dev 1

Tương lai:

```text
SEEK_REQUEST
```

Chỉ Dev 1 player adapter được điều khiển YouTube player.

Dev 3 không được thao tác DOM YouTube.

---

# 36. Test architecture

## `tests/contract/`

Tạo:

```text
video-activation/
session-quiz/
assessment-history/
```

Mục tiêu tương lai:

```text
provider/consumer contract compatibility
OpenAPI validation
JSON schema validation
fixture validation
```

Bootstrap chưa cần full business contract test.

---

## `tests/e2e/`

Tạo:

```text
video-activation/
session-quiz/
assessment-history/
```

Bootstrap không tạo full browser E2E business.

Chỉ cần walking-skeleton verification nếu setup đơn giản.

Không thêm Playwright/Cypress nếu repository chưa quyết định và không cần để chứng minh bootstrap.

Nếu phải thêm một E2E framework mới, báo trước thay vì tự chọn tùy tiện.

---

# 37. `docs/architecture/README.md`

Mô tả:

```text
physical architecture
vertical module architecture
Extension → Backend → FastAPI flow
database ownership
AI stateless rule
contract rule
```

Bao gồm sơ đồ ASCII hoặc Mermaid.

---

# 38. `docs/architecture/module-ownership.md`

Mô tả bảng ownership:

```text
Dev 1
Dev 2
Dev 3
Shared/HOT
Generated
Integration Captain
```

Liệt kê exact paths.

Mục tiêu là người mới hoặc Codex chỉ cần đọc file này là biết được vùng nào được phép sửa.

---

# 39. `scripts/README.md`

Chỉ mô tả mục đích folder.

Không cần tạo script giả.

Tương lai dùng cho:

```text
contract generation
contract validation
local setup
seed test data
```

---

# 40. `deploy/README.md`

Chỉ ghi:

```text
deployment artifacts sẽ đặt ở đây
bootstrap chưa triển khai production deployment
```

Không thêm Docker Compose nếu chưa cần.

Nếu Docker Compose đã có trong repository thì giữ nguyên và chỉ chỉnh khi bootstrap thực sự cần.

---

# 41. HOT/shared files sau bootstrap

Sau khi bootstrap hoàn tất, các file/folder sau được coi là shared/HOT:

```text
AGENTS.md

apps/extension/manifest.json
apps/extension/vite.config.ts
apps/extension/src/shell/**
apps/extension/src/generated/**

services/api/src/StudyLens.Api/Program.cs
services/api/src/StudyLens.Api/BuildingBlocks/**
services/api/src/StudyLens.Api/Infrastructure/Persistence/StudyLensDbContext.cs
services/api/src/StudyLens.Api/Infrastructure/Persistence/Migrations/**

services/ai/app/main.py
services/ai/app/platform/**

contracts/public-api/root.yaml
contracts/ai-api/root.yaml

deploy/**
.github/workflows/**
pnpm-lock.yaml
package-lock.json
```

Trong **bootstrap task này**, bạn được phép tạo/configure các file trên.

Sau bootstrap:

```text
Dev 1/2/3 feature PR không tự ý sửa HOT files.
```

Integration Captain xử lý các thay đổi tích hợp chung.

---

# 42. Không tạo business files quá sớm

Không bootstrap sẵn các file sau:

```text
youtube-detector.ts
youtube-player-adapter.ts
transcript-reader.ts

activation-manager.ts
activation-reducer.ts
SettingsPanel.tsx

StudySession.cs
PlaybackSpan.cs
StudySegment.cs
Quiz.cs
Question.cs

AnswerAttempt.cs
GradeResult.cs

ClassifyVideoEndpoint.cs
GenerateQuizEndpoint.cs
SubmitAnswerEndpoint.cs

classification/service.py
classification/prompt.py

question_generation/service.py
question_generation/prompt.py

grading/service.py
grading/prompt.py
```

Vì đây chính là nội dung backlog của Dev 1/2/3.

Chỉ tạo file business nếu nó thực sự cần thiết để walking skeleton compile/run; nếu buộc phải tạo, giữ minimal và ghi rõ lý do.

---

# 43. Walking Skeleton phải hoạt động

Bootstrap phải chứng minh được:

```text
Extension
    ↓
ASP.NET Backend
    ↓
FastAPI AI Service
```

Cụ thể:

## FastAPI

```text
GET /health
```

trả:

```json
{
  "status": "ok",
  "service": "studylens-ai"
}
```

## ASP.NET

```text
GET /api/health
```

trả tối thiểu:

```json
{
  "status": "ok",
  "service": "studylens-api"
}
```

Backend phải có một code path testable để gọi FastAPI `/health` qua `AiHealthClient`.

## Extension

Side Panel có thể gọi Backend health qua shared HTTP client.

Không gọi FastAPI trực tiếp.

---

# 44. CORS

Cấu hình CORS phù hợp local development.

Không dùng policy production quá rộng nếu có thể tránh.

Nếu Extension origin khó cố định ở bootstrap, ghi rõ local-development policy và giới hạn của nó trong README.

---

# 45. Swagger / OpenAPI

ASP.NET phải bật Swagger/OpenAPI ở development.

Không cần bundle tất cả feature contracts vào runtime ASP.NET trong bootstrap nếu việc đó làm phức tạp không cần thiết.

`contracts/` vẫn là architecture-level source of truth cho business contracts.

---

# 46. SQLite

Cấu hình SQLite từ configuration.

Không hardcode connection string rải rác.

Backend phải start được với SQLite config hợp lệ.

Không cần tạo business table.

---

# 47. Local commands

README phải ghi command **đúng với project đã tạo**.

Ví dụ format mong muốn:

## Extension

```bash
cd apps/extension
pnpm install
pnpm dev
pnpm build
```

Nếu dùng npm thì ghi npm; không ghi pnpm nếu project không dùng pnpm.

## Backend

```bash
dotnet restore services/api/src/StudyLens.Api/StudyLens.Api.csproj
dotnet build services/api/src/StudyLens.Api/StudyLens.Api.csproj
dotnet run --project services/api/src/StudyLens.Api/StudyLens.Api.csproj
```

## AI

```bash
cd services/ai
python -m venv .venv
# activate environment
pip install -r requirements.txt
uvicorn app.main:app --reload
```

Chỉ ghi command đã kiểm tra hoặc phù hợp với file thực tế đã tạo.

---

# 48. Verification bắt buộc trước khi kết thúc

Thực hiện lần lượt:

1. In final directory tree.
2. Verify Extension dependencies install nếu môi trường cho phép.
3. Build Extension.
4. Run TypeScript typecheck nếu script có.
5. Build ASP.NET project.
6. Verify ASP.NET startup.
7. Verify `/api/health`.
8. Verify SQLite configuration/startup.
9. Import/start FastAPI.
10. Verify FastAPI `/health`.
11. Verify Backend → FastAPI health call.
12. Verify Extension → Backend health call khi môi trường cho phép.
13. Search repository for accidentally committed secrets.
14. Verify no Axx/Bxx/Cxx business implementation was added.
15. Verify all three Dev ownership paths exist.
16. Verify all three Backend Module entry points are wired.
17. Verify all three FastAPI feature routers are wired.
18. Verify all three Extension feature entry points are wired.
19. Verify generated folder is empty/minimal and not hand-written business DTO.
20. Verify README commands match the actual generated repo.

Không claim `PASS` nếu chưa chạy kiểm tra tương ứng.

---

# 49. Walking Skeleton Acceptance Criteria

Task chỉ DONE khi:

- [ ] Repository theo vertical module architecture.
- [ ] Không còn cấu trúc bootstrap cũ kiểu global `Controllers/Services/Repositories` cho business.
- [ ] `services/ai/` được dùng thay vì `services/ai-service/`.
- [ ] Extension build được.
- [ ] Side Panel render StudyLens bootstrap UI.
- [ ] Backend build/start được.
- [ ] FastAPI start được.
- [ ] `GET /api/health` hoạt động.
- [ ] `GET /health` của FastAPI hoạt động.
- [ ] Backend gọi được FastAPI health.
- [ ] Extension gọi được Backend health.
- [ ] Swagger hoạt động ở development.
- [ ] SQLite config hợp lệ.
- [ ] `StudyLensDbContext` hỗ trợ module EF configuration scanning.
- [ ] `VideoActivationModule` đã register.
- [ ] `SessionQuizModule` đã register.
- [ ] `AssessmentHistoryModule` đã register.
- [ ] `classification` router đã register.
- [ ] `question_generation` router đã register.
- [ ] `grading` router đã register.
- [ ] Extension feature registry biết đủ ba feature entry points.
- [ ] Contract folder baseline `0.1.0` tồn tại.
- [ ] Test folder theo ownership tồn tại.
- [ ] Không có LLM secret trong Extension.
- [ ] Không có API key thật trong repository.
- [ ] Không implement A01–A09.
- [ ] Không implement B01–B10.
- [ ] Không implement C01–C09.
- [ ] Sau bootstrap Dev 1 có thể bắt đầu A01 mà không reorganize repo.
- [ ] Sau bootstrap Dev 2 có thể bắt đầu B01 mà không reorganize repo.
- [ ] Sau bootstrap Dev 3 có thể bắt đầu C01 mà không reorganize repo.

---

# 50. Final report format

Khi hoàn thành, trả report theo format:

```markdown
# StudyLens Bootstrap Report

## 1. Final directory tree

<tree>

## 2. Files created

- ...

## 3. Shared/HOT files created

- ...

## 4. Module entry points

### Dev 1
- Extension:
- Backend:
- AI:
- Contracts:
- Tests:

### Dev 2
- Extension:
- Backend:
- AI:
- Contracts:
- Tests:

### Dev 3
- Extension:
- Backend:
- AI:
- Contracts:
- Tests:

## 5. Commands executed

- Command:
- Result:

## 6. Health verification

- Extension -> Backend:
- Backend /api/health:
- Backend -> AI:
- AI /health:

## 7. SQLite

- Configuration:
- Verification:

## 8. Security checks

- Real secrets found:
- LLM key exposed to Extension:

## 9. Items not verified

- ...

## 10. Known limitations

- ...

## 11. Architecture compliance

- Vertical modules: PASS/FAIL
- HOT boundaries: PASS/FAIL
- No premature A/B/C features: PASS/FAIL

## 12. Ready next tasks

- Dev 1: A01
- Dev 2: B01
- Dev 3: C01
```

---

# 51. Điều cấm cuối cùng

Không:

```text
rewrite AGENTS.md
đổi stack
tự thêm Redux/Zustand nếu chưa cần
tự thêm Docker/Kubernetes nếu chưa cần
tạo full database schema
tạo full contract business
triển khai classification
triển khai transcript
triển khai session timer
triển khai quiz generation
triển khai answer/grading/history
tự thay đổi module ownership
```

Nếu thấy một business feature cần được implement để bootstrap chạy, trước tiên thử dùng stub/no-op/health-only implementation.

Bootstrap phải dừng ở **framework / walking skeleton**.

---

# 52. Trạng thái sau khi hoàn tất

Kết quả mong muốn:

```text
                    STUDYLENS BASE REPOSITORY
                              │
               ┌──────────────┼──────────────┐
               │              │              │
               ▼              ▼              ▼
             DEV 1          DEV 2          DEV 3
              A01            B01            C01
               │              │              │
video-activation/**   session-quiz/**   assessment-history/**
VideoActivation/**    SessionQuiz/**    AssessmentHistory/**
classification/**     question_generation/** grading/**
```

Ba Dev phải có thể bắt đầu làm việc song song mà:

```text
không đổi lại architecture
không di chuyển folder
không cùng sửa một business service
không cùng sửa một repository
không cùng sửa một AI feature folder
không phải chờ Backend/Frontend/AI của người khác hoàn thành
```

**Không tiếp tục A01, B01 hoặc C01 trừ khi được yêu cầu rõ ràng.**
