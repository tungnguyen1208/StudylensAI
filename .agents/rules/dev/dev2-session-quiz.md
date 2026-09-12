# StudyLens AI — Gói công việc Dev 2: Study Session & Quiz Generation

> Tài liệu này là nguồn giao việc trực tiếp cho **Dev 2 và Codex của Dev 2**. Mọi thay đổi phải tuân thủ ranh giới module, contract và tiêu chí nghiệm thu được mô tả bên dưới.

## 1. Vai trò và mục tiêu

Dev 2 sở hữu module **Study Session & Quiz Generation** theo chiều dọc, từ Chrome/Edge Extension đến ASP.NET Core Backend, FastAPI AI Service, contract và test.

Luồng nghiệp vụ Dev 2 phải hoàn thiện:

```text
Dev 1 quyết định StudyLens được bật
        ↓
Dev 2 bắt đầu StudySession
        ↓
Theo dõi thời gian xem thực tế và PlaybackSpan
        ↓
Đủ interval thì đóng StudySegment
        ↓
Backend yêu cầu AI sinh Quiz từ transcript của segment
        ↓
Extension hiển thị QuestionPublic
        ↓
Dev 3 nhận Quiz/Question để làm phần trả lời và chấm điểm
```

Mục tiêu cuối cùng là tạo được một lát cắt chức năng chạy xuyên suốt: người dùng bật StudyLens, thời gian học được tính đúng, đủ chu kỳ thì một quiz hợp lệ được sinh và hiển thị mà không làm lộ đáp án.

## 2. Phạm vi yêu cầu

### 2.1. Yêu cầu chức năng chính

Dev 2 chịu trách nhiệm triển khai các yêu cầu **FR-06 đến FR-09**:

- **FR-06 — Theo dõi phiên học và thời gian xem thực tế:** bắt đầu, duy trì, kết thúc phiên học gắn với đúng video; chỉ cộng thời gian khi StudyLens đang hoạt động và video thực sự phát. Không cộng khi pause, buffering, seeking, StudyLens OFF hoặc đã đổi video.
- **FR-07 — Chia nội dung thành segment theo chu kỳ:** khi thời gian học tích lũy đạt interval 5, 10 hoặc 15 phút, đóng một `StudySegment` từ những đoạn video thực tế đã xem, giữ timestamp và gửi lên Backend theo cách có thể retry an toàn.
- **FR-08 — Sinh câu hỏi bằng AI:** khi kết thúc chu kỳ, dùng transcript thuộc segment để sinh câu hỏi bám sát nguồn, hỗ trợ Multiple Choice và Short Answer.
- **FR-09 — Hiển thị quiz:** đưa `QuestionPublic` lên Side Panel mà không buộc người dùng rời YouTube và không gửi đáp án đúng ra Extension.

Dev 2 cũng chịu trách nhiệm phần liên quan của:

- **FR-15 — Tùy chọn học tập:** chỉ **đọc và áp dụng** `quizIntervalMinutes`, `questionType`, `difficulty` từ `PreferenceSnapshot` do Dev 1 cung cấp. Dev 2 không xây Settings UI và không sở hữu quy tắc lưu cấu hình.
- **FR-16 — Xử lý lỗi:** xử lý các lỗi thuộc session/segment/question generation như transcript không đủ, AI timeout, output AI sai schema, request trùng, mạng gián đoạn và retry. Lỗi của module không được làm dừng hoặc làm hỏng YouTube player.

### 2.2. Ngoài phạm vi

Dev 2 **không thực hiện** các việc sau:

- Không đọc hay thao tác trực tiếp YouTube DOM.
- Không tự lấy video ID, title, URL, duration hoặc transcript.
- Không viết logic `play`, `pause`, `seek` cho YouTube player.
- Không làm video classification, confidence threshold, Auto/Manual activation.
- Không làm Settings UI hoặc API sở hữu cài đặt.
- Không làm form nhập câu trả lời.
- Không chấm MCQ hoặc short answer.
- Không làm kết quả chấm, review timestamp hoặc lịch sử học tập.
- Không gọi LLM trực tiếp từ Extension.
- Không đưa API key hoặc đáp án đúng vào Extension.

Các việc trên lần lượt thuộc Dev 1 hoặc Dev 3. Khi cần dữ liệu, Dev 2 phải dùng contract công khai thay vì import service nội bộ của module khác.

## 3. Nguyên tắc kiến trúc

Kiến trúc vật lý của hệ thống:

```text
Chrome/Edge Extension
        │ REST + extension messages
        ▼
ASP.NET Core Backend (modular monolith)
        │ internal REST
        ▼
FastAPI AI Service
        │
        ▼
Cloud LLM / vLLM / deterministic fake LLM

ASP.NET Core Backend ─────► Database
```

Các nguyên tắc bắt buộc:

1. Extension không gọi FastAPI hoặc LLM trực tiếp.
2. Backend là nơi duy nhất ghi/đọc database.
3. FastAPI không lưu trạng thái phiên người dùng.
4. Module tổ chức theo **feature**, không gom toàn bộ controller, service hoặc model của hệ thống vào thư mục chung.
5. Dev 2 sở hữu lát cắt Extension → Backend → AI → Test của `SessionQuiz`.
6. Module khác chỉ giao tiếp với `SessionQuiz` qua API, event hoặc application port đã công bố.
7. `QuestionPublic` tuyệt đối không chứa đáp án đúng, rubric chấm hoặc prompt nội bộ.
8. Tất cả mutation có khả năng retry phải idempotent.

## 4. Phạm vi đường dẫn Dev 2 sở hữu

Dev 2 được tạo và sửa nội dung trong các đường dẫn sau:

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

Dev 2 được **đọc nhưng không tự ý sửa** contract đầu vào của Dev 1 và phần triển khai của Dev 3.

## 5. Cây thư mục và ý nghĩa từng thành phần

### 5.1. Extension

```text
apps/extension/src/features/session-quiz/
├─ api/
│  └─ session-quiz-api.ts
├─ components/
│  ├─ SessionProgress.tsx
│  ├─ QuizLoading.tsx
│  └─ QuestionPrompt.tsx
├─ state/
│  ├─ session-store.ts
│  ├─ session-reducer.ts
│  └─ session-types.ts
├─ services/
│  ├─ session-manager.ts
│  ├─ study-timer.ts
│  ├─ playback-span-tracker.ts
│  ├─ segment-manager.ts
│  └─ quiz-coordinator.ts
├─ __tests__/
│  ├─ session-manager.spec.ts
│  ├─ study-timer.spec.ts
│  ├─ playback-span-tracker.spec.ts
│  ├─ segment-manager.spec.ts
│  └─ quiz-coordinator.spec.ts
└─ index.ts
```

#### `api/session-quiz-api.ts`

Là cổng duy nhất của feature để gọi ASP.NET Backend. File này cung cấp các hàm có kiểu dữ liệu rõ ràng như:

```ts
startSession(request)
completeSession(sessionId, request)
createSegment(sessionId, request, idempotencyKey)
generateQuiz(segmentId, request, idempotencyKey)
getQuiz(quizId)
```

Không đặt `fetch()` rải rác trong React component hoặc service nghiệp vụ. File phải chuyển lỗi HTTP sang error model thống nhất gồm `code`, `message`, `traceId` và `retryable`.

#### `components/SessionProgress.tsx`

Hiển thị tiến độ của chu kỳ hiện tại, ví dụ `07:32 / 10:00`, trạng thái phiên và thời điểm quiz tiếp theo. Component chỉ render dữ liệu; không tự tạo timer hoặc gọi API.

#### `components/QuizLoading.tsx`

Hiển thị quá trình tạo quiz, lỗi có thể retry và trạng thái transcript không đủ. Nút retry phải gọi command/callback do service cung cấp, không tự xây request riêng.

#### `components/QuestionPrompt.tsx`

Hiển thị nội dung `QuestionPublic`, loại câu hỏi và danh sách lựa chọn nếu là MCQ. File này không chứa form nộp đáp án và không biết đáp án đúng. Dev 3 ghép phần `AnswerForm` vào vùng hiển thị tương ứng.

#### `state/session-types.ts`

Khai báo state và action nội bộ của feature. Không sao chép DTO bằng tay nếu DTO đã có trong `generated/contracts.ts`.

#### `state/session-store.ts`

Giữ trạng thái phiên phía Extension như `sessionId`, `status`, `activeStudyMs`, `intervalMs`, `currentSegment`, `quizStatus` và lỗi gần nhất. Đây không phải nguồn dữ liệu lưu trữ lâu dài; Backend vẫn là source of truth.

#### `state/session-reducer.ts`

Quản lý chuyển trạng thái bằng pure function, ví dụ:

```text
IDLE → STARTING → ACTIVE → COMPLETING → COMPLETED
               ↘ ERROR

NO_QUIZ → SEGMENT_READY → GENERATING → AVAILABLE
                                  ↘ RETRYABLE_ERROR
```

Reducer không gọi API, clock hoặc browser API để có thể unit test hoàn toàn xác định.

#### `services/session-manager.ts`

Điều phối vòng đời `StudySession` dựa trên contract của Dev 1:

- Bắt đầu khi nhận `ACTIVATION_DECIDED` hợp lệ.
- Không tạo hai session active cho cùng một lần kích hoạt.
- Hoàn tất session khi StudyLens OFF, video thay đổi hoặc video kết thúc.
- Tạm dừng cộng thời gian khi player không ở trạng thái playing.
- Đồng bộ start/complete với Backend.

#### `services/study-timer.ts`

Tính `activeStudyMs` bằng chênh lệch thời điểm giữa các event, không phụ thuộc vào một `setInterval` chạy vĩnh viễn. Manifest V3 có thể suspend service worker, vì vậy state phải có thể khôi phục và tính tiếp mà không cộng thừa thời gian.

File phải nhận một abstraction `Clock` để test bằng fake clock:

```ts
interface Clock {
  nowMs(): number;
}
```

#### `services/playback-span-tracker.ts`

Chuyển chuỗi player event thành các khoảng video thực sự được xem:

```json
[
  { "startMs": 10000, "endMs": 42000 },
  { "startMs": 120000, "endMs": 150000 }
]
```

Pause, buffering, seek và video change phải đóng span đang mở. Các span không được có độ dài âm, vượt duration hoặc vô tình nối qua một thao tác seek.

#### `services/segment-manager.ts`

Theo dõi tiến độ interval; khi đủ ngưỡng thì:

1. Chốt tập `PlaybackSpan` của chu kỳ.
2. Chọn các transcript cue giao với những span đã xem.
3. Tạo `clientSegmentId` ổn định.
4. Gửi segment lên Backend với idempotency key.
5. Chỉ mở chu kỳ mới sau khi segment hiện tại đã được ghi nhận an toàn.

Nếu request timeout, retry phải dùng lại cùng `clientSegmentId`; không tạo ID mới.

#### `services/quiz-coordinator.ts`

Điều phối việc yêu cầu sinh quiz, polling/lấy kết quả nếu contract dùng xử lý bất đồng bộ, cập nhật `quizStatus` và phát `QUIZ_AVAILABLE` cho Dev 3. File này không chứa prompt và không chấm câu trả lời.

#### `index.ts`

Public surface duy nhất của feature. Chỉ export component, event handler và contract cần thiết cho shell/module khác. Không export repository hoặc service nội bộ tùy tiện.

### 5.2. ASP.NET Core Backend

```text
services/api/src/StudyLens.Api/Features/SessionQuiz/
├─ Api/
│  ├─ StartSessionEndpoint.cs
│  ├─ CompleteSessionEndpoint.cs
│  ├─ CreateSegmentEndpoint.cs
│  ├─ GenerateQuizEndpoint.cs
│  └─ GetQuizEndpoint.cs
├─ Application/
│  ├─ Abstractions/
│  │  ├─ IQuestionGenerationClient.cs
│  │  ├─ ISessionRepository.cs
│  │  └─ IQuizRepository.cs
│  ├─ PublishedContracts/
│  │  └─ QuestionForAssessment.cs
│  ├─ StartSession/
│  ├─ CompleteSession/
│  ├─ CreateSegment/
│  ├─ GenerateQuiz/
│  └─ GetQuiz/
├─ Domain/
│  ├─ StudySession.cs
│  ├─ PlaybackSpan.cs
│  ├─ StudySegment.cs
│  ├─ Quiz.cs
│  ├─ Question.cs
│  ├─ SessionStatus.cs
│  ├─ QuizStatus.cs
│  └─ DomainErrors.cs
├─ Infrastructure/
│  ├─ SessionRepository.cs
│  ├─ QuizRepository.cs
│  ├─ QuestionGenerationClient.cs
│  └─ Configurations/
│     ├─ StudySessionConfiguration.cs
│     ├─ PlaybackSpanConfiguration.cs
│     ├─ StudySegmentConfiguration.cs
│     ├─ QuizConfiguration.cs
│     └─ QuestionConfiguration.cs
└─ SessionQuizModule.cs
```

#### `Api/`

Nhận HTTP request, xác thực shape/authorization context, gọi use case và ánh xạ kết quả sang HTTP response. Endpoint không chứa business rule hoặc gọi trực tiếp DbContext/LLM.

- `StartSessionEndpoint.cs`: tạo phiên từ envelope `ACTIVATION_DECIDED`; payload là `ActivationDecision` canonical và chứa `TranscriptSnapshotRef`/`PreferenceSnapshot` khi có.
- `CompleteSessionEndpoint.cs`: kết thúc phiên một cách idempotent.
- `CreateSegmentEndpoint.cs`: nhận playback spans và `clientSegmentId`; trả lại segment cũ nếu request bị gửi trùng.
- `GenerateQuizEndpoint.cs`: yêu cầu tạo quiz cho một segment hợp lệ.
- `GetQuizEndpoint.cs`: trả `QuizPublic`/`QuestionPublic`, không trả answer key.

#### `Application/`

Mỗi thư mục là một use case và nên chứa command/query, validator, handler, result DTO cùng test tương ứng. Application điều phối Domain, repository và AI client nhưng không phụ thuộc React hoặc YouTube DOM.

`Application/Abstractions/` chứa port do Dev 2 sở hữu và infrastructure của Dev 2 triển khai. Test handler phải thay repository/AI client bằng fake.

Riêng transcript, Dev 2 phải consume trực tiếp server-side contract do Dev 1 publish: `ITranscriptSnapshotReader` và record trả về `TranscriptSnapshotForSession`. Handler truyền `transcriptSnapshotId` từ `ActivationDecision.transcriptSnapshot` vào `ITranscriptSnapshotReader`; dữ liệu cue/content phục vụ segment chỉ được đọc từ `TranscriptSnapshotForSession`. Dev 2 không định nghĩa một API/repository transcript mơ hồ, không truy cập repository nội bộ của Dev 1 và không đọc lại YouTube DOM.

`Application/PublishedContracts/QuestionForAssessment.cs` là record server-side do Dev 2 publish cho tích hợp chấm đáp án. Dev 3 sở hữu port `IQuestionAssessmentReader`; Integration Captain chịu trách nhiệm wire adapter từ module Dev 2 sang port đó. Dev 2 không phụ thuộc trực tiếp module Dev 3.

#### `Domain/`

Chứa entity, value object, trạng thái và invariant cốt lõi. Domain không phụ thuộc HTTP, EF Core, FastAPI hoặc SDK LLM.

#### `Infrastructure/`

- Repository hiện thực hóa persistence cho session/segment/quiz.
- `QuestionGenerationClient.cs` gọi FastAPI theo `contracts/ai-api/question-generation.yaml`.
- `Configurations/` chứa EF Core configuration của entity do Dev 2 sở hữu.

Không tự sửa `StudyLensDbContext.cs`. Cấu hình entity được nạp bằng `ApplyConfigurationsFromAssembly()`.

#### `SessionQuizModule.cs`

Đăng ký service và route của module. Nếu cần nối module này vào `Program.cs`, Dev 2 gửi yêu cầu tích hợp cho Integration Captain thay vì tự sửa file HOT trong PR nghiệp vụ.

### 5.3. AI Service

```text
services/ai/app/features/question_generation/
├─ router.py
├─ schemas.py
├─ service.py
├─ prompt.py
├─ output_validator.py
└─ tests/
   ├─ test_router.py
   ├─ test_service.py
   ├─ test_output_validator.py
   └─ fixtures/
```

- `router.py`: khai báo FastAPI endpoint sinh câu hỏi; chỉ validate request, gọi service và trả response.
- `schemas.py`: Pydantic model cho input/output theo AI contract.
- `service.py`: tạo prompt, gọi abstraction LLM, parse và validate kết quả; không lưu session vào database.
- `prompt.py`: dùng `promptVersion` cố định `0.1.0`; yêu cầu chỉ dùng transcript được cung cấp và trả JSON đúng schema.
- `output_validator.py`: từ chối output sai loại câu hỏi, MCQ thiếu/lặp option, correct option không tồn tại, source timestamp ngoài segment hoặc nội dung không đủ dữ liệu.
- `tests/`: dùng deterministic fake LLM; không gọi LLM thật trong unit test/CI mặc định.

### 5.4. Contract và fixture

```text
contracts/
├─ public-api/session-quiz.yaml
├─ ai-api/question-generation.yaml
├─ extension-messages/session-quiz.schema.json
└─ examples/session-quiz/
   ├─ start-session.request.json
   ├─ start-session.response.json
   ├─ create-segment.request.json
   ├─ create-segment.response.json
   ├─ generate-mcq.response.json
   ├─ generate-short-answer.response.json
   ├─ no-transcript.error.json
   ├─ ai-timeout.error.json
   └─ invalid-ai-output.error.json
```

- `public-api/session-quiz.yaml`: REST contract Extension ↔ ASP.NET Backend.
- `ai-api/question-generation.yaml`: REST contract Backend ↔ FastAPI.
- `extension-messages/session-quiz.schema.json`: event giữa content script/service worker/Side Panel và event công khai cho module khác.
- `examples/session-quiz/`: fixture dùng chung để Dev 1, Dev 2 và Dev 3 phát triển độc lập.

Quy ước dữ liệu:

- JSON dùng `camelCase`.
- Enum dùng string.
- ID dùng UUID hoặc opaque string; consumer không phân tích cấu trúc ID.
- Thời gian video và duration dùng integer millisecond.
- System timestamp dùng ISO-8601 UTC.
- Error envelope có `code`, `status`, `message`, `traceId`, `retryable`.
- Mutation retry được gửi `Idempotency-Key` và business key như `clientSegmentId`.

Tất cả public API, AI API, fixture và extension message trong gói công việc này dùng `contractVersion` canonical `0.1.0`. Extension message luôn dùng đúng envelope sau; dữ liệu riêng của từng event chỉ nằm trong `payload`:

```ts
interface ExtensionMessageEnvelope<TPayload> {
  type: string;
  contractVersion: "0.1.0";
  correlationId: string;
  tabId: number;
  youtubeVideoId: string;
  occurredAtUtc: string;
  payload: TPayload;
}
```

### 5.5. Test

```text
services/api/tests/SessionQuiz.Tests/
├─ Domain/
├─ Application/
├─ Api/
└─ Infrastructure/

tests/contract/session-quiz/
├─ public-api.contract.spec.*
├─ ai-api.contract.spec.*
└─ extension-message.contract.spec.*

tests/e2e/session-quiz/
├─ manual-activation-to-quiz.spec.*
├─ pause-seek-resume.spec.*
├─ retry-idempotency.spec.*
└─ generation-failure.spec.*
```

- Unit test kiểm tra state machine, clock, spans, domain invariant và output validator.
- API/integration test kiểm tra persistence, uniqueness và HTTP behavior.
- Contract test bảo đảm provider và consumer cùng tuân thủ schema.
- E2E test kiểm tra lát cắt từ activation fixture đến quiz hiển thị.

## 6. Entity do Dev 2 sở hữu

### 6.1. `StudySession`

Đại diện cho một phiên học của một installation/user trên một video.

Trường chính đề xuất:

```text
id
installationId/userId
youtubeVideoId
transcriptSnapshotId
activationDecisionId
preferenceSnapshot
status: active | completed
startedAtUtc
completedAtUtc?
activeStudyMs
```

Invariant:

- Một session chỉ thuộc một video và một transcript snapshot.
- Preference phải được snapshot lúc bắt đầu để thay đổi settings giữa phiên không làm đổi ngược hành vi cũ.
- Complete là idempotent; session đã completed không được active lại.
- Không ghi duration âm hoặc giảm `activeStudyMs`.

### 6.2. `PlaybackSpan`

Đại diện cho một đoạn video thực sự được xem liên tục.

```text
id
sessionId
startMs
endMs
observedDurationMs
```

Invariant:

- `0 <= startMs < endMs <= videoDurationMs` khi duration đã biết.
- Span không vượt qua thao tác seek.
- Các span gửi trong cùng segment phải thuộc đúng session/video.

### 6.3. `StudySegment`

Là phần nội dung được đóng sau khi đủ interval học thực tế.

```text
id
sessionId
clientSegmentId
sequenceNumber
activeStudyMs
playbackSpans[]
transcriptCueRefs[]
status
createdAtUtc
```

Invariant:

- `(sessionId, clientSegmentId)` là duy nhất.
- `sequenceNumber` tăng theo session.
- Không tạo segment sinh quiz khi không có transcript cue hợp lệ.
- Retry cùng business key trả cùng segment, không tạo bản ghi mới.

### 6.4. `Quiz`

Nhóm câu hỏi sinh từ đúng một segment.

```text
id
segmentId
status: pending | generating | ready | failed
questionType
difficulty
promptVersion
modelVersion
createdAtUtc
failureCode?
```

Invariant:

- Một segment chỉ có tối đa một quiz hiệu lực cho cùng generation policy/idempotency key.
- Chỉ quiz `ready` mới được public cho Extension.
- Failure có mã phân biệt retryable và non-retryable.

### 6.5. `Question`

Một câu hỏi thuộc quiz, có dữ liệu nội bộ và public projection tách biệt.

```text
id
quizId
type: multipleChoice | shortAnswer
prompt
options[]
correctAnswer/rubric          # chỉ Backend nội bộ
referenceAnswer              # chỉ phục vụ grading nội bộ
sourceStartMs
sourceEndMs
sourceTranscriptCueIds[]
ordinal
```

Invariant:

- MCQ có số option hợp lệ, option không trùng và correct option tồn tại.
- Short answer có rubric/reference answer nội bộ.
- Source reference nằm trong transcript segment.
- `QuestionPublic` không serialize `correctAnswer`, `rubric`, `referenceAnswer` hoặc prompt LLM.

## 7. Contract tích hợp với Dev 1 và Dev 3

### 7.1. Input từ Dev 1

Dev 2 chỉ bắt đầu session khi nhận dữ liệu hợp lệ từ module Video Activation.

#### `ActivationDecision`

`ActivationDecision` là payload canonical của envelope có `type: "ACTIVATION_DECIDED"`; đây không phải một event/envelope thứ hai. `youtubeVideoId` và thời điểm phát sinh lấy từ envelope. Payload không có trường timestamp riêng:

```ts
interface ActivationDecision {
  decisionId: string;
  state: "active" | "inactive";
  source: "auto" | "manual";
  reasonCode: string;
  classification?: {
    classificationResultId: string;
    label: "educational" | "nonEducational" | "unknown";
    confidence: number;
  };
  transcriptSnapshot?: TranscriptSnapshotRef;
  preferences: PreferenceSnapshot;
}
```

Dev 2 chỉ xử lý `state = active`. Nếu transcript chưa sẵn sàng, session có thể theo dõi thời gian nhưng không được sinh quiz cho đến khi nhận snapshot hợp lệ.

#### `TranscriptSnapshotRef`

```ts
interface TranscriptSnapshotRef {
  transcriptSnapshotId: string;
  youtubeVideoId: string;
  language: string;
  status: "available" | "unavailable" | "insufficient";
  contentHash?: string;
  version: string;
}
```

Ở Backend, Dev 2 dùng `transcriptSnapshotId` để gọi server-side `ITranscriptSnapshotReader` do Dev 1 publish và chỉ consume record `TranscriptSnapshotForSession` trả về. Không tự tạo transcript API/repository thay thế và không đọc lại YouTube DOM.

#### `PreferenceSnapshot`

```ts
interface PreferenceSnapshot {
  quizIntervalMinutes: 5 | 10 | 15;
  questionType: "multipleChoice" | "shortAnswer";
  difficulty: "easy" | "medium" | "hard";
}
```

Dev 2 validate và snapshot các giá trị này nhưng không cung cấp màn hình chỉnh sửa.

#### Player events

Dev 2 consume event chuẩn hóa từ Dev 1:

```text
PLAYER_PLAYING
PLAYER_PAUSED
PLAYER_BUFFERING
PLAYER_SEEKED
PLAYER_ENDED
VIDEO_CONTEXT_CHANGED
ACTIVATION_DECIDED
ACTIVATION_STOPPED
```

Mỗi event phải dùng đúng `ExtensionMessageEnvelope` với các field theo thứ tự contract: `type`, `contractVersion`, `correlationId`, `tabId`, `youtubeVideoId`, `occurredAtUtc`, `payload`. Thời gian video cần cho timer/span nằm trong `payload`; system timestamp chỉ dùng `occurredAtUtc` ở envelope.

### 7.2. Output cho Dev 3

#### `QuizAvailable`

```ts
interface QuizAvailable {
  quizId: string;
  sessionId: string;
  segmentId: string;
  questions: QuestionPublic[];
  createdAtUtc: string;
}
```

`QuizAvailable` là nguyên wrapper payload của extension message `QUIZ_AVAILABLE`; không đẩy `quizId`, `sessionId`, `segmentId` hoặc `createdAtUtc` vào từng `QuestionPublic`. `QuestionPublic` chỉ giữ `questionId`, `type`, `prompt`, `options?`, `source`; không thêm `quizId` hoặc `questionType`.

#### `QuestionPublic`

```ts
interface QuestionPublic {
  questionId: string;
  type: "multipleChoice" | "shortAnswer";
  prompt: string;
  options?: Array<{ optionId: string; text: string }>;
  source: QuestionSourceRef;
}
```

#### `QuestionSourceRef`

```ts
interface QuestionSourceRef {
  youtubeVideoId: string;
  startMs: number;
  endMs: number;
}
```

#### `SessionSnapshot`

```ts
interface SessionSnapshot {
  sessionId: string;
  youtubeVideoId: string;
  status: "active" | "completed";
  activeStudyMs: number;
  startedAtUtc: string;
  completedAtUtc?: string;
}
```

Backend của Dev 3 cần answer key để chấm nhưng không được truy cập trực tiếp entity/repository của Dev 2. Dev 2 publish record canonical `QuestionForAssessment` chỉ dùng server-side, chứa `questionId`, type, correct answer/rubric và source reference; tuyệt đối không đưa record này vào public API hoặc generated Extension client. Dev 3 publish port tên `IQuestionAssessmentReader`; Integration Captain wire adapter đọc `QuestionForAssessment` từ Dev 2 để hiện thực port đó.

## 8. Backlog thực hiện tuần tự

Không bắt đầu task sau khi dependency bắt buộc chưa được merge hoặc chưa có fixture thay thế. Mỗi task nên nằm trong một PR nhỏ, hoàn tất theo chiều dọc và giữ `main` luôn chạy được.

### B01 — Chốt contract và dựng skeleton module

**Phụ thuộc:** cấu trúc monorepo cơ bản; tên event/DTO đầu vào của Dev 1 đã thống nhất hoặc có fixture tạm được version hóa.

**Deliverable:**

- Ba contract `session-quiz.yaml`, `question-generation.yaml`, `session-quiz.schema.json`.
- `contractVersion` của cả ba contract là `0.1.0`.
- JSON fixture happy path và lỗi chính.
- Skeleton Extension, Backend, AI cùng module test.
- Public surface trong `index.ts` và `SessionQuizModule.cs` chưa cần gắn vào file HOT.

**Acceptance criteria:**

- Contract dùng cùng cách đặt tên, enum và đơn vị thời gian.
- `QuestionPublic` không có trường đáp án/rubric.
- OpenAPI/JSON Schema validate được toàn bộ fixture.
- Dev 1 và Dev 3 review contract đầu vào/đầu ra.

**Tests:** lint OpenAPI, validate JSON Schema, contract fixture test, build skeleton ba ứng dụng.

### B02 — Xây vòng đời StudySession

**Phụ thuộc:** B01 và fixture `ActivationDecision`.

**Deliverable:** `StudySession` domain model, session reducer/manager, start/complete use case và endpoint.

**Acceptance criteria:**

- Một activation hợp lệ chỉ tạo một active session.
- OFF, video change hoặc video ended hoàn tất đúng session.
- Complete gửi lại nhiều lần vẫn trả cùng kết quả.
- Preference/transcript reference được snapshot đúng lúc start.

**Tests:** domain transition test, reducer test, API start/complete integration test, duplicate start/complete test.

### B03 — Tính active study time bằng fake clock

**Phụ thuộc:** B02 và player-event fixture từ Dev 1.

**Deliverable:** `Clock`, `study-timer.ts`, cơ chế khôi phục state khi service worker bị suspend và đồng bộ `activeStudyMs`.

**Acceptance criteria:**

- Chỉ trạng thái StudyLens active + player playing mới cộng thời gian.
- Pause, buffering, seeking, OFF và thời gian sau complete không được cộng.
- Clock lùi hoặc event out-of-order không tạo duration âm.
- Không cần đợi thời gian thật trong test.

**Tests:** fake-clock tests cho play/pause/resume, buffering, seek, suspend/resume, event duplicate/out-of-order và video change.

### B04 — Theo dõi PlaybackSpan

**Phụ thuộc:** B03.

**Deliverable:** `PlaybackSpan` entity/value object, `playback-span-tracker.ts`, serialization contract.

**Acceptance criteria:**

- Play mở span; pause/buffering/seek/end/video change đóng span.
- Seek không nối hai vị trí xa nhau thành một span giả.
- Span được clamp/validate theo video duration khi có.
- Tổng watched time có quy tắc rõ ràng khi người dùng xem lặp một đoạn.

**Tests:** continuous playback, multiple pause/resume, forward/backward seek, replay, invalid timestamps và open span khi session complete.

### B05 — Đóng StudySegment và bảo đảm idempotency

**Phụ thuộc:** B01, B03, B04 và transcript fixture có timestamp.

**Deliverable:** `StudySegment`, `segment-manager.ts`, CreateSegment use case/endpoint, uniqueness constraint theo `(sessionId, clientSegmentId)`.

**Acceptance criteria:**

- Segment được tạo khi active time đạt đúng interval 5/10/15 phút.
- Cue được chọn theo giao với playback spans, không lấy toàn bộ transcript video.
- Retry với cùng `clientSegmentId`/`Idempotency-Key` trả cùng segment ID.
- Hai request đồng thời không tạo hai segment/sequence trùng.
- Transcript unavailable/insufficient trả lỗi có mã rõ ràng và không gọi AI.

**Tests:** fake-clock interval boundaries, transcript cue selection, API duplicate/concurrency test, unique constraint test và no-transcript test.

### B06 — Persistence và Backend session/segment hoàn chỉnh

**Phụ thuộc:** B02, B04, B05.

**Deliverable:** repository, EF configurations và integration tests cho năm entity thuộc Dev 2 ở trạng thái cần thiết cho pipeline.

**Acceptance criteria:**

- Repository không rò EF entity/query ra Application.
- Quan hệ, index, uniqueness và cascade behavior có chủ đích.
- Có integration test trên database mục tiêu của MVP.
- Configuration được assembly scanning nhận diện.

**Tests:** repository CRUD, optimistic/concurrent behavior, uniqueness, reload session aggregate và database integration test.

**Lưu ý migration:** Dev 2 chỉ viết EF configuration. Integration Captain tạo migration/model snapshot trong PR tích hợp riêng.

### B07 — Xây AI question generation với fake LLM

**Phụ thuộc:** B01 và transcript fixtures.

**Deliverable:** toàn bộ `features/question_generation`, prompt version `0.1.0`, Pydantic schema, output validator và deterministic fake LLM scenario.

**Acceptance criteria:**

- Sinh được `multipleChoice` và `shortAnswer` theo difficulty.
- Mọi câu hỏi có source reference thuộc segment.
- MCQ có option hợp lệ và đáp án đúng tồn tại.
- Output sai JSON/schema bị từ chối với error code rõ ràng.
- Unit/CI không phụ thuộc mạng hoặc LLM thật.

**Tests:** valid MCQ, valid short answer, malformed JSON, missing fields, duplicate options, answer-not-in-options, timestamp ngoài segment, timeout và transcript quá ngắn.

### B08 — Điều phối GenerateQuiz và bảo vệ đáp án

**Phụ thuộc:** B05, B06, B07.

**Deliverable:** `Quiz`, `Question`, GenerateQuiz/GetQuiz use case và endpoint, `QuestionGenerationClient`, mapping nội bộ → public.

**Acceptance criteria:**

- Backend chỉ gọi FastAPI với transcript segment hợp lệ.
- Retry không tạo quiz/question trùng.
- Timeout có trạng thái/lỗi retryable, invalid output là lỗi được kiểm soát.
- API public và log không làm lộ correct answer/rubric.
- Record server-side `QuestionForAssessment` do Dev 2 publish đã sẵn sàng; Dev 3 publish `IQuestionAssessmentReader` và Integration Captain có yêu cầu wire adapter rõ ràng.

**Tests:** handler với fake AI client, API integration, idempotent generation, timeout/retry, invalid output, serialization/security snapshot test.

### B09 — Hiển thị tiến độ và quiz trong Extension

**Phụ thuộc:** B02, B03, B05, B08.

**Deliverable:** `SessionProgress`, `QuizLoading`, `QuestionPrompt`, store/reducer và `quiz-coordinator.ts` nối với fake/real Backend.

**Acceptance criteria:**

- UI hiển thị đúng active time/interval và trạng thái generating/ready/error.
- Reload hoặc service-worker suspend không tạo segment/quiz trùng.
- Question hiển thị đúng loại; không có đáp án đúng trong Extension state, network payload hoặc log.
- Envelope `QUIZ_AVAILABLE` với payload nguyên wrapper `QuizAvailable` được phát đúng một lần cho một quiz tới Dev 3.

**Tests:** component tests, reducer tests, API mock tests, restore/retry test và kiểm tra payload không chứa secret answer.

### B10 — E2E, failure matrix và handoff

**Phụ thuộc:** B01–B09; contract Dev 1 và Dev 3 đã có bản tương thích.

**Deliverable:** E2E suite, báo cáo contract compatibility, README ngắn trong module nếu cần và handoff checklist hoàn chỉnh.

**Acceptance criteria:**

- Luồng activation fixture → session → timer → segment → fake LLM → quiz chạy end-to-end.
- Pause, buffering và seek không tăng sai active time.
- Không transcript thì không sinh quiz.
- Timeout/retry không làm gián đoạn video và không tạo dữ liệu trùng.
- MCQ và short answer đều tạo/hiển thị được.
- Chrome và Edge smoke test đạt khi tích hợp Extension hoàn chỉnh.

**Tests:** contract, API integration, AI tests, E2E happy path, E2E pause/seek, E2E duplicate retry và E2E generation failure.

## 9. Chiến lược test doubles bắt buộc

### Fake clock

- Extension nhận `Clock` qua dependency injection; test chủ động advance time.
- Backend dùng `.NET TimeProvider` hoặc abstraction tương đương cho system timestamps.
- Không dùng `sleep`, timeout dài hoặc phụ thuộc thời gian máy trong unit test.

### Transcript fixture

Phải có ít nhất:

- Transcript hợp lệ có nhiều cue và timestamp.
- Transcript ngắn/không đủ nội dung.
- Transcript unavailable.
- Cue chồng lấn, cue ngoài playback span và cue ở ranh giới segment.
- Video có seek tiến/lùi và xem lặp.

Fixture là contract data, không được đọc trực tiếp YouTube trong test module Dev 2.

### Deterministic fake LLM

Fake LLM nhận scenario ID hoặc fixture input và trả kết quả cố định:

- Valid MCQ.
- Valid short answer.
- Timeout.
- Malformed JSON.
- Schema-invalid output.
- Hallucinated/out-of-range source timestamp.

LLM thật chỉ dùng trong test/evaluation tách biệt, không là điều kiện để unit test hoặc CI cơ bản pass.

### Idempotency

- Extension tạo business key ổn định trước lần gửi đầu tiên.
- Retry phải dùng lại cùng key và cùng request semantic.
- Backend lưu/kiểm tra uniqueness ở database, không chỉ kiểm tra in-memory.
- Duplicate cùng key + cùng payload trả lại resource cũ.
- Duplicate cùng key + payload khác trả conflict có mã rõ ràng.
- Test cả gửi tuần tự và hai request đồng thời.

## 10. File HOT và quy trình tích hợp

Các file sau là file dùng chung, Dev 2 không tự ý sửa trong PR feature:

```text
apps/extension/manifest.json
apps/extension/src/shell/App.tsx
apps/extension/src/shell/feature-registry.ts
services/api/src/StudyLens.Api/Program.cs
services/api/src/StudyLens.Api/Infrastructure/Persistence/StudyLensDbContext.cs
services/api/src/StudyLens.Api/Infrastructure/Persistence/Migrations/**
services/ai/app/main.py
services/ai/app/platform/llm/**
contracts/public-api/root.yaml
contracts/ai-api/root.yaml
deploy/docker-compose.yml
package/pnpm/npm lockfiles
CI workflow files
```

Khi cần tích hợp:

1. Dev 2 hoàn thiện module/public registration function trong path sở hữu.
2. Ghi chính xác thay đổi cần Integration Captain thực hiện.
3. Integration Captain tạo PR nhỏ để đăng ký feature/router/DI, cập nhật root contract hoặc migration.
4. Dev 2 review và chạy lại test sau khi PR tích hợp merge.

Không đặt business logic vào file HOT để “nối tạm”.

## 11. Quy tắc Git, PR và sử dụng Codex

### Branch và PR

- Dùng branch theo hành vi, ví dụ `feat/d2-session-lifecycle`, `feat/d2-idempotent-segment`, `feat/d2-question-generation`.
- Không dùng branch dài hạn tên `frontend`, `backend`, `ai` hoặc `dev2`.
- Mỗi PR nên hoàn thành một task Bxx hoặc một hành vi nhỏ có thể review trong 0,5–2 ngày.
- Contract/fixture phải merge trước implementation phụ thuộc contract.
- Rebase/sync với `main` trước handoff; không merge code khi test liên quan đang đỏ.
- Không tự sửa code Dev 1/Dev 3 để né contract mismatch; mở issue hoặc PR contract có review owner.
- Migration và file HOT phải nằm trong PR tích hợp riêng do Integration Captain phụ trách.

### Nội dung PR tối thiểu

```markdown
## Task
Bxx — Tên task

## Phạm vi
- FR liên quan
- Paths đã thay đổi

## Contract
- Contract version: 0.1.0
- Breaking/non-breaking change

## Acceptance criteria
- [ ] ...

## Tests
- Lệnh đã chạy
- Kết quả

## Handoff / Integration request
- File HOT cần captain nối, nếu có
- Input/output cần Dev 1 hoặc Dev 3 xác nhận
```

### Quy tắc prompt cho Codex

Mỗi prompt phải nêu rõ:

- Task Bxx và FR liên quan.
- Hành vi cần xây cùng acceptance criteria.
- Allowed paths.
- Forbidden/HOT paths.
- Contract version `0.1.0`, prompt version `0.1.0` và fixture cần dùng.
- Test command bắt buộc.
- Yêu cầu giữ nguyên thay đổi không liên quan của người khác.

Prompt mẫu:

```text
Implement B05: idempotent StudySegment creation for SessionQuiz.

Allowed paths:
- apps/extension/src/features/session-quiz/**
- services/api/src/StudyLens.Api/Features/SessionQuiz/**
- services/api/tests/SessionQuiz.Tests/**
- contracts/public-api/session-quiz.yaml
- contracts/examples/session-quiz/**
- tests/contract/session-quiz/**

Do not modify HOT files, migrations, Dev 1 or Dev 3 modules.
Use contract version 0.1.0, prompt version 0.1.0, and existing transcript fixtures.
Retry with the same clientSegmentId must return the same segment; a changed
payload for the same idempotency key must return conflict.
Run unit, API integration and contract tests, then report exact results.
```

## 12. Definition of Done của module Dev 2

Module chỉ được coi là hoàn thành khi tất cả điều kiện sau đạt:

- [ ] FR-06 đến FR-09 được ánh xạ sang code và test cụ thể.
- [ ] Phần FR-15 được áp dụng từ immutable `PreferenceSnapshot`.
- [ ] Các lỗi session/segment/generation thuộc FR-16 có error code và UX phù hợp.
- [ ] Session lifecycle hoạt động đúng với activation, OFF, video change và ended.
- [ ] Pause, buffering, seek và inactive time không làm tăng `activeStudyMs`.
- [ ] Playback spans mô tả đúng những đoạn video thực sự được xem.
- [ ] Segment được tạo đúng interval 5/10/15 phút.
- [ ] Retry/concurrent request không tạo session, segment, quiz hoặc question trùng.
- [ ] Không transcript hợp lệ thì AI không được gọi và quiz không được sinh.
- [ ] Sinh được cả multiple choice và short answer bằng fake LLM.
- [ ] AI output sai schema/timestamp được chặn trước persistence/publication.
- [ ] `QuestionPublic` không làm lộ correct answer, rubric hoặc reference answer.
- [ ] Extension không chứa API key và không gọi AI Service trực tiếp.
- [ ] Unit, component, API integration, contract và E2E test liên quan đều pass.
- [ ] Tất cả thay đổi nằm trong path sở hữu hoặc có PR HOT riêng được duyệt.
- [ ] Dev 1 và Dev 3 xác nhận contract giao tiếp tương thích.
- [ ] Smoke test tích hợp trên Chrome và Edge đạt trước release.

## 13. Handoff cuối cùng

Khi hoàn thành B10, Dev 2 bàn giao một ghi chú ngắn với checklist sau:

```markdown
# Dev 2 SessionQuiz Handoff

## Phiên bản
- Public API contract: 0.1.0
- AI API contract: 0.1.0
- Extension message contract: 0.1.0
- Prompt version: 0.1.0

## Đầu vào đã kiểm chứng với Dev 1
- [ ] ActivationDecision
- [ ] TranscriptSnapshotRef
- [ ] PreferenceSnapshot
- [ ] Player event schemas

## Đầu ra đã kiểm chứng với Dev 3
- [ ] QuizAvailable
- [ ] QuestionPublic
- [ ] QuestionSourceRef
- [ ] SessionSnapshot
- [ ] QuestionForAssessment server-side record do Dev 2 publish
- [ ] IQuestionAssessmentReader do Dev 3 publish
- [ ] Integration Captain wire adapter giữa hai contract

## Idempotency
- Session business key:
- Segment business key:
- Quiz business key:

## Test đã chạy
- Unit:
- Component:
- API integration:
- Contract:
- E2E:
- Chrome/Edge smoke:

## Integration Captain cần thực hiện
- Router/feature registration:
- EF migration:
- Root OpenAPI registration:
- CI/deploy changes:

## Vấn đề còn lại
- Blocking:
- Non-blocking/follow-up:
```

Handoff chỉ được đánh dấu hoàn tất khi Dev 3 có thể dùng fixture hoặc API thật để hiển thị form trả lời mà không cần đọc code nội bộ của Dev 2, và Dev 1 có thể thay implementation YouTube/transcript mà không buộc Dev 2 sửa business logic.
