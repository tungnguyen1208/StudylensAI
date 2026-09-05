# DEV 3 — Assessment, Grading & History

> Tài liệu giao việc độc lập cho Dev 3. Đọc toàn bộ trước khi giao task cho Codex. Mọi thay đổi phải nằm trong phạm vi được nêu ở đây, trừ khi có một PR tích hợp riêng được Integration Captain phê duyệt.

## 1. Vai trò và mục tiêu

Dev 3 sở hữu **module Assessment & History theo chiều dọc**: từ giao diện trả lời trên Chrome/Edge Extension, API nộp đáp án trong ASP.NET Core, logic chấm điểm trong FastAPI, lưu kết quả vào database, cho tới màn hình xem lại lịch sử.

Luồng do Dev 3 phụ trách:

```text
QuizAvailable từ Dev 2
        ↓
Người dùng nhập/chọn đáp án
        ↓
SubmitAnswer API
        ↓
MCQ grader hoặc Short Answer grader
        ↓
AnswerAttempt + GradeResult
        ↓
Hiển thị kết quả / History read model
        ↓
SEEK_REQUEST khi người dùng muốn xem lại đoạn video
```

Mục tiêu cuối cùng là người dùng có thể:

1. Trả lời câu hỏi trắc nghiệm hoặc câu hỏi ngắn.
2. Nộp lại an toàn khi mạng/AI lỗi mà không tạo bản ghi trùng.
3. Nhận kết quả, điểm, đáp án tham chiếu và giải thích có căn cứ.
4. Quay lại đúng timestamp của video để ôn tập.
5. Xem lịch sử học và kết quả theo video hoặc phiên học.

Dev 3 **không** sở hữu toàn bộ frontend hoặc backend. Dev 3 chỉ sở hữu các lát cắt Extension, Backend, AI, contract và test thuộc Assessment & History.

## 2. Phạm vi yêu cầu

### 2.1 Yêu cầu chức năng

Phạm vi chính là **FR-10 đến FR-14**:

| Yêu cầu | Trách nhiệm của Dev 3 |
|---|---|
| FR-10 | Cho phép người dùng chọn đáp án Multiple Choice hoặc nhập Short Answer và gửi câu trả lời. |
| FR-11 | Chấm câu trả lời; trả outcome/score khi áp dụng, đáp án tham chiếu và giải thích ngắn theo contract. |
| FR-12 | Hiển thị timestamp hoặc transcript reference liên quan và phát `SEEK_REQUEST`; Dev 1 thực hiện thao tác player. |
| FR-13 | Phối hợp lưu kết quả học tập theo ownership: Dev 1 lưu `Video`/`TranscriptSnapshot`; Dev 2 lưu `StudySession`/`StudySegment`/`Quiz`/`Question`; Dev 3 chỉ lưu `AnswerAttempt`/`GradeResult` và cung cấp history read model, không sửa aggregate của module khác. |
| FR-14 | Truy vấn và hiển thị lịch sử học tập cùng kết quả cơ bản theo video hoặc phiên học. |

Dev 3 đồng thời chịu phần **FR-16 liên quan trực tiếp đến module này**, gồm:

- API nộp đáp án lỗi hoặc mất mạng.
- AI grading timeout, output sai schema hoặc không đủ căn cứ.
- Người dùng bấm submit nhiều lần hoặc retry cùng một đáp án.
- Timestamp thiếu, âm, vượt duration hoặc không thuộc video hiện tại.
- Lịch sử trống, tải lỗi, phân trang lỗi hoặc dữ liệu cũ không còn tương thích.
- Không được làm dừng, reload hoặc phá trạng thái phát video khi Assessment gặp lỗi.

### 2.2 Ngoài phạm vi

Dev 3 không thực hiện các phần sau:

- Không nhận diện trang/video YouTube.
- Không đọc hoặc chuẩn hóa transcript.
- Không phân loại video và không quyết định Auto/Manual activation.
- Không tạo, pause, resume hoặc complete Study Session.
- Không tính thời gian học, playback span hoặc study segment.
- Không sinh Quiz/Question và không sửa nội dung Question.
- Không thao tác trực tiếp DOM YouTube hoặc gán `video.currentTime`.
- Không sửa entity, repository hay business rule thuộc `VideoActivation` hoặc `SessionQuiz`.
- Không đưa đáp án đúng vào `QuestionPublic` trả về Extension.
- Không tự ý sửa file dùng chung `[HOT]` hoặc tạo EF migration.

Nếu task yêu cầu một thay đổi ngoài phạm vi, dừng ở mức mô tả dependency, tạo issue/handoff cho đúng owner, rồi chờ contract đã thống nhất.

## 3. Kiến trúc và nguyên tắc phụ thuộc

### 3.1 Kiến trúc vật lý

```text
Chrome/Edge Extension
        │ HTTPS/JSON
        ▼
ASP.NET Core Backend ───────────────► Database
        │ nội bộ, theo AI contract
        ▼
FastAPI AI Service
        │
        ▼
Fake LLM trong test / Cloud LLM hoặc vLLM khi chạy thật
```

Các ràng buộc bắt buộc:

- Extension chỉ gọi ASP.NET Core Backend; không gọi trực tiếp LLM.
- Backend là thành phần duy nhất đọc/ghi database.
- AI Service không lưu session hay dữ liệu người dùng lâu dài.
- Không import service nội bộ của module khác. Giao tiếp qua public/internal contract hoặc event đã thống nhất.
- `QuestionPublic` chỉ chứa dữ liệu được phép hiển thị; đáp án chuẩn chỉ tồn tại phía server.
- Mọi mutation phải hỗ trợ idempotency.

### 3.2 Input và output của module

#### Input chính từ Dev 2

Dev 3 nhận `QuizAvailable` do Dev 2 phát theo contract version `0.1.0`. `QuizAvailable` là wrapper bắt buộc để giữ ngữ cảnh quiz, session và segment; Dev 3 không nhận một `QuestionPublic` rời rạc làm input tích hợp chính.

```ts
export type QuizAvailable = {
  quizId: string;
  sessionId: string;
  segmentId: string;
  questions: QuestionPublic[];
  createdAtUtc: string;
};

export type QuestionPublic = {
  questionId: string;
  type: "multipleChoice" | "shortAnswer";
  prompt: string;
  options?: Array<{
    optionId: string;
    text: string;
  }>;
  source: {
    youtubeVideoId: string;
    startMs: number;
    endMs: number;
  };
};
```

`QuestionPublic` không chứa `quizId` hoặc `questionType`; Dev 3 lấy `quizId` từ wrapper và dùng field canonical `type`. DTO public không được chứa `correctAnswer`, correct option ID, rubric bí mật hoặc raw model output.

Ở Backend, module SessionQuiz của Dev 2 publish server-side record `QuestionForAssessment`, chứa dữ liệu tối thiểu cần để chấm như loại câu hỏi, đáp án chuẩn hoặc rubric và source reference. Module AssessmentHistory của Dev 3 khai báo consumer port `IQuestionAssessmentReader` trả record này. Integration Captain wire adapter từ SessionQuiz vào port khi ghép host. Dev 3 chỉ consume contract đó; không sửa trực tiếp `Question.cs`, `Quiz.cs` hoặc repository của Dev 2.

#### Output của Dev 3

Dev 3 cung cấp:

- `AnswerSubmission` và trạng thái submit.
- `GradeView`: outcome, score, reference answer, explanation, source reference.
- `HistoryEntryReadModel` phục vụ UI lịch sử.
- Event `SEEK_REQUEST` cho Dev 1.

Ví dụ event:

```ts
export type SeekRequest = {
  type: "SEEK_REQUEST";
  contractVersion: "0.1.0";
  correlationId: string;
  tabId: number;
  youtubeVideoId: string;
  occurredAtUtc: string;
  payload: {
    timestampMs: number;
  };
};
```

Dev 3 chỉ validate rồi phát event. `youtube-player-adapter.ts` của Dev 1 mới là nơi seek player.

## 4. Phạm vi đường dẫn được sở hữu

Dev 3 được phép tạo/sửa trong các đường dẫn sau:

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

Nếu cấu trúc project thực tế khác đôi chút, giữ nguyên nguyên tắc: mọi code nghiệp vụ của Dev 3 phải được đặt trong feature/module AssessmentHistory hoặc Grading, không đẩy logic sang file bootstrap dùng chung.

## 5. Cây thư mục đề xuất

```text
studylens/
├─ apps/
│  └─ extension/
│     └─ src/
│        └─ features/
│           └─ assessment-history/
│              ├─ api/
│              │  └─ assessment-api.ts
│              ├─ components/
│              │  ├─ AnswerForm.tsx
│              │  ├─ MultipleChoiceAnswer.tsx
│              │  ├─ ShortAnswerInput.tsx
│              │  ├─ GradeResult.tsx
│              │  ├─ ReviewTimestampButton.tsx
│              │  └─ HistoryPage.tsx
│              ├─ state/
│              │  ├─ assessment-store.ts
│              │  └─ assessment-reducer.ts
│              ├─ services/
│              │  ├─ answer-service.ts
│              │  ├─ review-controller.ts
│              │  └─ history-service.ts
│              ├─ mappers/
│              │  └─ assessment-mapper.ts
│              ├─ types/
│              │  └─ assessment-types.ts
│              ├─ __tests__/
│              └─ index.ts
│
├─ services/
│  ├─ api/
│  │  ├─ src/StudyLens.Api/
│  │  │  └─ Features/
│  │  │     └─ AssessmentHistory/
│  │  │        ├─ Api/
│  │  │        │  ├─ SubmitAnswerEndpoint.cs
│  │  │        │  ├─ GetHistoryEndpoint.cs
│  │  │        │  └─ GetVideoHistoryEndpoint.cs
│  │  │        ├─ Application/
│  │  │        │  ├─ SubmitAnswer/
│  │  │        │  │  ├─ SubmitAnswerCommand.cs
│  │  │        │  │  ├─ SubmitAnswerValidator.cs
│  │  │        │  │  └─ SubmitAnswerHandler.cs
│  │  │        │  ├─ GradeAnswer/
│  │  │        │  │  ├─ GradeAnswerRequest.cs
│  │  │        │  │  └─ GradeAnswerService.cs
│  │  │        │  ├─ GetHistory/
│  │  │        │  │  ├─ GetHistoryQuery.cs
│  │  │        │  │  └─ HistoryEntryReadModel.cs
│  │  │        │  └─ Ports/
│  │  │        │     ├─ IQuestionAssessmentReader.cs
│  │  │        │     └─ IGradingGateway.cs
│  │  │        ├─ Domain/
│  │  │        │  ├─ AnswerAttempt.cs
│  │  │        │  ├─ GradeResult.cs
│  │  │        │  ├─ GradeOutcome.cs
│  │  │        │  └─ AssessmentErrors.cs
│  │  │        ├─ Infrastructure/
│  │  │        │  ├─ AnswerRepository.cs
│  │  │        │  ├─ HistoryQueryService.cs
│  │  │        │  ├─ GradingGateway.cs
│  │  │        │  └─ Configurations/
│  │  │        │     ├─ AnswerAttemptConfiguration.cs
│  │  │        │     └─ GradeResultConfiguration.cs
│  │  │        └─ AssessmentHistoryModule.cs
│  │  └─ tests/
│  │     └─ AssessmentHistory.Tests/
│  │        ├─ Unit/
│  │        ├─ Integration/
│  │        └─ Fixtures/
│  │
│  └─ ai/
│     └─ app/
│        └─ features/
│           └─ grading/
│              ├─ router.py
│              ├─ schemas.py
│              ├─ service.py
│              ├─ prompt.py
│              ├─ output_validator.py
│              ├─ graders/
│              │  ├─ mcq_grader.py
│              │  └─ short_answer_grader.py
│              └─ tests/
│
├─ contracts/
│  ├─ public-api/
│  │  └─ assessment-history.yaml
│  ├─ ai-api/
│  │  └─ grading.yaml
│  ├─ extension-messages/
│  │  └─ assessment-history.schema.json
│  └─ examples/
│     └─ assessment-history/
│        ├─ submit-mcq.request.json
│        ├─ submit-short-answer.request.json
│        ├─ grade-success.response.json
│        ├─ grade-timeout.error.json
│        ├─ history-page.response.json
│        └─ seek-request.message.json
│
└─ tests/
   ├─ contract/
   │  └─ assessment-history/
   └─ e2e/
      └─ assessment-history/
```

## 6. Ý nghĩa từng file/folder

### 6.1 Extension

#### `api/assessment-api.ts`

Là cổng duy nhất để feature gọi Backend. Nên cung cấp các hàm typed như:

```ts
submitAnswer(request, options)
getHistory(query)
getVideoHistory(youtubeVideoId, query)
```

File này chịu trách nhiệm gắn correlation ID, idempotency key, map error envelope và abort signal. Không đặt `fetch()` rải rác trong React component.

#### `components/AnswerForm.tsx`

Component điều phối form theo `questionType`:

- Render `MultipleChoiceAnswer` cho MCQ.
- Render `ShortAnswerInput` cho câu hỏi ngắn.
- Khóa submit trong lúc request đang chạy.
- Hiển thị validation nhưng không tự chấm.
- Giữ nguyên draft khi request thất bại.

Component này nhận `QuestionPublic` bằng props; không tự lấy/sửa Question của Dev 2.

#### `components/MultipleChoiceAnswer.tsx`

Hiển thị danh sách option theo `optionId`, hỗ trợ keyboard và trạng thái selected/disabled. Gửi `selectedOptionId`, không gửi nguyên object option và không biết option đúng.

#### `components/ShortAnswerInput.tsx`

Nhập câu trả lời dạng text, trim hợp lý, áp dụng giới hạn độ dài từ contract và giữ draft qua retry. Không gọi LLM từ Extension.

#### `components/GradeResult.tsx`

Hiển thị:

- `correct`, `incorrect` hoặc `partiallyCorrect`.
- Score theo thang contract.
- Reference answer.
- Explanation ngắn gọn, có căn cứ.
- Nút xem lại timestamp khi source reference hợp lệ.

Phải phân biệt rõ “chưa chấm được” với “trả lời sai”. Timeout không được hiển thị thành incorrect.

#### `components/ReviewTimestampButton.tsx`

Nhận `youtubeVideoId` và `timestampMs`, gọi `review-controller.ts`. Nút phải disable hoặc ẩn khi timestamp không hợp lệ.

#### `components/HistoryPage.tsx`

Hiển thị lịch sử theo video/session, trạng thái loading/empty/error, phân trang và nút xem lại. Component không tự join dữ liệu client-side từ nhiều endpoint nếu Backend đã cung cấp read model.

#### `state/assessment-store.ts`

Lưu state thuộc module:

```ts
type AssessmentState = {
  draftsByQuestionId: Record<string, AnswerDraft>;
  submissionByQuestionId: Record<string, SubmissionState>;
  gradeByQuestionId: Record<string, GradeView>;
  history: HistoryState;
};
```

Không đưa player state, activation state hay session clock vào store này.

#### `state/assessment-reducer.ts`

Pure reducer quản lý các chuyển trạng thái:

```text
idle → editing → submitting → graded
                    └──────→ retryableError
                    └──────→ terminalError
```

Pure function giúp fake request và unit test deterministic.

#### `services/answer-service.ts`

Validate request, tạo/reuse `clientAttemptId`, gọi `assessment-api.ts`, map kết quả và đảm bảo retry không làm mất draft. Không tạo Question hoặc sửa Session.

#### `services/review-controller.ts`

Kiểm tra:

- `youtubeVideoId` khớp video đang mở.
- `timestampMs` là số nguyên không âm.
- Nếu biết duration thì timestamp không vượt duration.

Nếu hợp lệ, phát `SEEK_REQUEST` qua event bus/message contract. Không truy cập `document`, `<video>` hoặc YouTube DOM.

#### `services/history-service.ts`

Chuẩn hóa filter, cursor/phân trang, gọi API và map `HistoryEntryReadModel` sang view model. Không tự ghi history.

#### `mappers/assessment-mapper.ts`

Chuyển DTO từ contract sang UI view model. Đây là nơi hấp thụ khác biệt naming/optional field, tránh component phụ thuộc chặt vào HTTP DTO.

#### `types/assessment-types.ts`

Chỉ chứa type nội bộ của feature. Type sinh từ OpenAPI nằm trong `generated/` và không được copy/chỉnh thủ công tại đây.

#### `index.ts`

Public surface duy nhất của feature. Chỉ export component/hook/event cần cho shell hoặc module khác; không export repository/service nội bộ.

### 6.2 ASP.NET Core Backend

#### `Api/SubmitAnswerEndpoint.cs`

Nhận `questionId`, nội dung đáp án và idempotency data; validate HTTP-level; gọi use case; trả đúng status/error envelope. Endpoint không chứa prompt, EF query hoặc business logic chấm điểm.

#### `Api/GetHistoryEndpoint.cs`

Trả lịch sử của installation/user hiện tại, hỗ trợ cursor/page size và filter session nếu contract cho phép.

#### `Api/GetVideoHistoryEndpoint.cs`

Trả history đã lọc theo `youtubeVideoId`; không nhận SQL-like filter từ client.

#### `Application/SubmitAnswer/*`

Một vertical use case:

- `SubmitAnswerCommand.cs`: dữ liệu đầu vào đã chuẩn hóa.
- `SubmitAnswerValidator.cs`: rule bắt buộc theo loại câu hỏi.
- `SubmitAnswerHandler.cs`: đọc server-side Question contract, tạo/reuse attempt, gọi grading và lưu kết quả.

Handler phải xử lý idempotency: cùng một installation/user và `clientAttemptId` không tạo hai `AnswerAttempt`.

#### `Application/GradeAnswer/*`

Map dữ liệu nội bộ sang AI grading contract, gọi `IGradingGateway`, validate kết quả và chuyển lỗi AI thành error domain rõ ràng. Không để raw model output đi thẳng ra Extension.

#### `Application/GetHistory/*`

Chứa query và `HistoryEntryReadModel`. Read model là projection dành cho màn hình, không phải aggregate để ghi.

#### `Application/Ports/IQuestionAssessmentReader.cs`

Consumer port do Dev 3 khai báo để đọc `QuestionForAssessment` theo `questionId`. Server-side record `QuestionForAssessment` do Dev 2 publish từ module SessionQuiz; Integration Captain wire adapter của Dev 2 vào port này khi tích hợp host. Dev 3 không tự triển khai adapter bằng cách truy cập repository hoặc entity `Question` của Dev 2.

#### `Application/Ports/IGradingGateway.cs`

Abstraction gọi AI Service. Unit test thay bằng fake; production dùng `GradingGateway`.

#### `Domain/AnswerAttempt.cs`

Aggregate/entity đại diện cho **một lần nộp đáp án có định danh**. Nên chứa tối thiểu:

- `AnswerAttemptId`.
- `QuestionId`, `QuizId`, `SessionId` dưới dạng reference ID.
- installation/user scope.
- `ClientAttemptId` để idempotency.
- Answer payload đã chuẩn hóa.
- Trạng thái `pending`, `graded` hoặc `gradingFailed`.
- `SubmittedAtUtc`.

Không copy toàn bộ Question, transcript hoặc Session vào entity này.

#### `Domain/GradeResult.cs`

Kết quả chấm gắn với một `AnswerAttempt`:

- Outcome.
- Score.
- Reference answer.
- Explanation đã validate.
- Source reference/timestamp.
- Grader/model/prompt version khi cần audit.
- `GradedAtUtc`.

Một retry cùng `clientAttemptId` phải trả lại hoặc hoàn tất cùng attempt theo policy; không âm thầm tạo nhiều GradeResult mâu thuẫn.

#### `Domain/GradeOutcome.cs`

Enum/string value được giới hạn ở các giá trị contract, ví dụ:

```text
correct | incorrect | partiallyCorrect
```

Lỗi grading không phải là một outcome.

#### `Domain/AssessmentErrors.cs`

Mã lỗi ổn định như `question_not_found`, `invalid_answer`, `grading_timeout`, `grading_output_invalid`, `timestamp_invalid`. HTTP layer map các mã này sang error envelope chung.

#### `Infrastructure/AnswerRepository.cs`

Đọc/ghi `AnswerAttempt` và `GradeResult`, lookup theo idempotency key. Repository không trả entity của module khác.

#### `Infrastructure/HistoryQueryService.cs`

Tạo `HistoryEntryReadModel` bằng query/projection tối ưu từ dữ liệu đã lưu. History là **read model**, không phải bảng nguồn sự thật độc lập. Nguồn sự thật là AnswerAttempt, GradeResult và các reference đã được cấp qua contract.

#### `Infrastructure/GradingGateway.cs`

HTTP client typed gọi FastAPI, có timeout, cancellation, correlation ID và map error. Retry chỉ dùng cho lỗi transient và phải phối hợp với idempotency.

#### `Infrastructure/Configurations/*`

EF Core configuration cho entity của Dev 3. Đặt index/unique constraint cho idempotency. Dev 3 viết configuration nhưng **không tự tạo migration**; Integration Captain gom và tạo migration trong PR tích hợp.

#### `AssessmentHistoryModule.cs`

Đăng ký service/repository/endpoint của module qua extension method hoặc module convention. Không sửa `Program.cs` trực tiếp để nhét logic nghiệp vụ.

### 6.3 FastAPI AI Service

#### `router.py`

Khai báo endpoint grading nội bộ. Chỉ parse request, gọi service và trả schema; không chứa prompt/logic chấm.

#### `schemas.py`

Pydantic model cho MCQ và Short Answer. Dùng discriminated union theo `questionType` để không chấp nhận payload lẫn lộn.

#### `service.py`

Điều phối grader:

- MCQ dùng deterministic comparison khi đủ dữ liệu.
- Short Answer dùng fake LLM trong test và provider cấu hình khi chạy thật.
- Gắn model/prompt version.
- Validate output trước khi trả Backend.

#### `prompt.py`

Prompt có version, yêu cầu chỉ dựa vào reference answer/transcript excerpt được cung cấp, trả JSON đúng schema và không làm theo instruction nằm trong nội dung transcript/câu trả lời người dùng.

#### `output_validator.py`

Reject output thiếu trường, score ngoài range, outcome không khớp score, timestamp ngoài source range hoặc explanation rỗng. Raw output sai schema phải thành lỗi `grading_output_invalid`, không tự đoán để “sửa” kết quả.

#### `graders/mcq_grader.py`

So sánh `selectedOptionId` với correct option ID phía server. Không cần gọi LLM cho phép so sánh chính xác này.

#### `graders/short_answer_grader.py`

Tạo prompt từ reference answer/rubric/source excerpt, gọi provider và trả structured result. Phải có fake deterministic để CI không phụ thuộc network/chi phí.

#### `tests/`

Test MCQ đúng/sai, short answer đúng/sai/một phần, prompt-injection text, timeout, malformed JSON, hallucinated timestamp và output ngoài thang điểm.

### 6.4 Contracts và examples

#### `contracts/public-api/assessment-history.yaml`

Mô tả API Extension ↔ Backend, gồm submit answer, grade view và history. Contract version canonical là `0.1.0`. JSON dùng `camelCase`, ID là opaque string/UUID, thời điểm hệ thống là ISO-8601 UTC, timestamp video là integer millisecond.

#### `contracts/ai-api/grading.yaml`

Mô tả API Backend ↔ FastAPI, version `0.1.0`. Đây là contract nội bộ và có thể chứa reference answer/rubric; tuyệt đối không tái sử dụng schema này làm public response.

#### `contracts/extension-messages/assessment-history.schema.json`

Mô tả `SEEK_REQUEST` và các message nội bộ cần thiết ở version `0.1.0`. Envelope `SEEK_REQUEST` bắt buộc có `type`, `contractVersion`, `correlationId`, `tabId`, `youtubeVideoId`, `occurredAtUtc` và `payload.timestampMs`; không chuyển `youtubeVideoId` vào trong `payload`.

#### `contracts/examples/assessment-history/`

Fixture được review như code, ít nhất gồm:

- MCQ submit hợp lệ.
- Short Answer submit hợp lệ.
- Grade success/partially correct.
- AI timeout và invalid output.
- Duplicate/retry cùng `clientAttemptId`.
- Invalid timestamp.
- History empty và history có phân trang.

### 6.5 Tests

#### `services/api/tests/AssessmentHistory.Tests/Unit/`

Test Domain/Application bằng fake clock, fake question reader, fake grading gateway và in-memory fake repository. Không gọi network/LLM thật.

#### `services/api/tests/AssessmentHistory.Tests/Integration/`

Test HTTP endpoint, persistence, unique constraint/idempotency, query history và error mapping với database test phù hợp.

#### `tests/contract/assessment-history/`

Kiểm tra provider/consumer đều tuân schema và examples. Đây là hàng rào chống Dev 2 hoặc Dev 1 đổi contract làm hỏng module.

#### `tests/e2e/assessment-history/`

Chạy luồng UI → Backend → fake AI → database → UI. E2E phải deterministic bằng seed Question và fake LLM; chỉ có smoke/evaluation riêng mới dùng LLM thật.

## 7. Quy tắc dữ liệu và nghiệp vụ

### 7.1 Multiple Choice

- Extension gửi `selectedOptionId`, không biết đáp án đúng.
- Backend kiểm tra option có thuộc Question hay không.
- Chấm deterministic; không gọi LLM nếu chỉ cần so sánh ID.
- Option không tồn tại trả validation error, không ghi thành incorrect.

### 7.2 Short Answer

- Không chấp nhận text rỗng sau normalization.
- Giới hạn độ dài theo contract.
- Grader chỉ dùng reference answer/rubric/source excerpt do Backend cấp.
- Phân biệt `incorrect`, `partiallyCorrect`, `correct` theo rubric có version.
- Timeout/output invalid tạo trạng thái retryable; không kết luận người dùng trả lời sai.

### 7.3 Retry và idempotency

- Extension tạo một `clientAttemptId` khi người dùng bắt đầu submit.
- Retry cùng nội dung phải reuse ID này.
- Backend đặt unique constraint theo scope người dùng/installation và `clientAttemptId`.
- Nếu lần đầu đã thành công, retry trả kết quả cũ.
- Nếu attempt đang pending, trả trạng thái hiện tại hoặc tiếp tục theo policy đã chốt.
- Nếu người dùng sửa câu trả lời sau một attempt hoàn tất, đó là attempt mới với ID mới.

### 7.4 Timestamp

- Dùng integer millisecond, không dùng số giây dạng float.
- Không emit `SEEK_REQUEST` khi thiếu/âm/NaN/vượt duration đã biết.
- Nếu video đang mở khác `youtubeVideoId`, hiển thị yêu cầu mở đúng video thay vì seek nhầm.
- Dev 3 test việc phát event; Dev 1 test thao tác player thực tế.

### 7.5 History read model

`HistoryEntryReadModel` là dữ liệu đọc tổng hợp, ví dụ:

```ts
type HistoryEntryReadModel = {
  answerAttemptId: string;
  youtubeVideoId: string;
  videoTitle?: string;
  sessionId: string;
  questionId: string;
  questionPrompt: string;
  questionType: "multipleChoice" | "shortAnswer";
  submittedAnswer: string;
  outcome: "correct" | "incorrect" | "partiallyCorrect";
  score: number;
  explanation: string;
  timestampMs?: number;
  submittedAtUtc: string;
};
```

Không tạo `History` aggregate/bảng ghi độc lập chỉ để copy dữ liệu. Nếu cần snapshot text để lịch sử ổn định khi Question đổi, quyết định snapshot phải được ghi rõ trong ADR/contract và review với Dev 2.

## 8. Backlog tuần tự

Không bắt đầu task sau khi dependency bắt buộc của task trước chưa xanh. Mỗi task nên là một PR nhỏ, hoàn tất theo chiều dọc khi có thể.

### C01 — Chốt contract và seed data

**Dependency:** Contract `QuizAvailable`/`QuestionPublic` và server-side record `QuestionForAssessment` version `0.1.0` từ Dev 2.

**Thực hiện:**

- Viết `assessment-history.yaml`, `grading.yaml`, message schema.
- Tạo examples cho MCQ, Short Answer, error, history và seek.
- Tạo seed Question không chứa đáp án ở public fixture, đồng thời có server-side fixture riêng cho grading.

**Deliverable:** Contract module `0.1.0` và fixtures deterministic.

**Acceptance criteria:**

- Public Question không lộ correct answer/rubric.
- Tất cả example validate qua schema.
- `QuizAvailable` bao `quizId`, `sessionId`, `segmentId`, `questions` và `createdAtUtc`; `QuestionPublic` dùng `type` và có source reference canonical.
- Timestamp, ID, enum, contract version và error envelope nhất quán.
- Dev 1 review envelope `SEEK_REQUEST`; Dev 2 review `QuizAvailable`, `QuestionPublic` và `QuestionForAssessment`.

**Tests:** Schema validation và contract example tests.

### C02 — Xây UI nhập đáp án bằng seed data

**Dependency:** C01.

**Thực hiện:** `AnswerForm`, `MultipleChoiceAnswer`, `ShortAnswerInput`, store/reducer và component tests.

**Deliverable:** Có thể render và submit local callback cho cả hai loại câu hỏi bằng seed data, chưa cần Backend thật.

**Acceptance criteria:**

- MCQ gửi đúng `optionId`.
- Short Answer không cho submit rỗng và giữ draft.
- Double click không gọi callback hai lần.
- Hỗ trợ loading/disabled và keyboard cơ bản.

**Tests:** Component/unit tests với seed QuestionPublic; accessibility smoke test nếu project có công cụ.

### C03 — Xây submit API và AnswerAttempt idempotent

**Dependency:** C01; server-side question reader contract có fake hoặc implementation.

**Thực hiện:** endpoint, command/validator/handler, `AnswerAttempt`, repository/configuration và fake grading gateway.

**Deliverable:** Extension submit được vào Backend bằng fake grader và nhận GradeView.

**Acceptance criteria:**

- Question không tồn tại trả lỗi đúng contract.
- Payload sai loại bị reject.
- Hai request cùng `clientAttemptId` không tạo hai attempt.
- Không sửa Question/Session entity.

**Tests:** Domain unit, handler unit, endpoint integration, duplicate/concurrent idempotency test.

### C04 — Xây AI grading

**Dependency:** C01 và C03 gateway contract.

**Thực hiện:** FastAPI router/schema/service, MCQ deterministic grader, Short Answer fake/provider grader, prompt và validator.

**Deliverable:** Backend gọi được FastAPI grading theo `grading.yaml`.

**Acceptance criteria:**

- MCQ đúng/sai deterministic.
- Short Answer trả outcome/score/explanation hợp lệ.
- Timeout/malformed output được map thành lỗi retryable phù hợp.
- Không có raw LLM output hoặc secret trong public response/log.

**Tests:** Pytest với fake LLM, malformed JSON, timeout, score invalid, prompt injection và timestamp invalid.

### C05 — Hiển thị kết quả và hoàn thiện retry

**Dependency:** C02–C04.

**Thực hiện:** nối `assessment-api.ts`, `answer-service.ts`, `GradeResult.tsx`, trạng thái lỗi/retry.

**Deliverable:** Luồng QuestionPublic → submit → grade result chạy end-to-end bằng fake LLM.

**Acceptance criteria:**

- Hiển thị outcome, score, reference answer và explanation.
- Timeout không hiển thị incorrect.
- Draft còn nguyên sau lỗi.
- Retry reuse `clientAttemptId`; thành công trước đó không tạo grade trùng.

**Tests:** Extension service/component tests, API integration và E2E fake LLM.

### C06 — Review at Timestamp

**Dependency:** C05 và message handler contract của Dev 1.

**Thực hiện:** `ReviewTimestampButton`, `review-controller.ts`, event/message contract và test.

**Deliverable:** Click “Xem lại” phát `SEEK_REQUEST` hợp lệ.

**Acceptance criteria:**

- Không truy cập DOM YouTube trong module Dev 3.
- Invalid timestamp không phát event và có thông báo rõ.
- Video ID sai không seek nhầm.
- Event có correlation ID và contract version.

**Tests:** Unit test boundary values và message contract test; E2E phối hợp Dev 1 cho player seek.

### C07 — Hoàn thiện persistence và audit

**Dependency:** C03–C05.

**Thực hiện:** `GradeResult`, EF configurations, unique index, timestamps, model/prompt version và error state.

**Deliverable:** Attempt/result có thể phục hồi sau restart Backend.

**Acceptance criteria:**

- AnswerAttempt và GradeResult giữ quan hệ đúng.
- Unique constraint bảo vệ idempotency ở database.
- Tất cả system timestamp lưu UTC.
- Không log câu trả lời nhạy cảm hoặc secret ngoài policy.

**Tests:** Persistence integration, restart/read-back, concurrent duplicate request và rollback/failure tests.

> Dev 3 chỉ viết entity configuration. Integration Captain tạo và merge EF migration.

### C08 — History API và History UI

**Dependency:** C07; read references từ Dev 2 đã sẵn sàng.

**Thực hiện:** history query/read model, endpoints, `history-service.ts`, `HistoryPage.tsx`.

**Deliverable:** Xem được lịch sử theo video/session với pagination và nút xem lại.

**Acceptance criteria:**

- Empty state, loading, error và retry rõ ràng.
- Kết quả đúng scope người dùng/installation.
- Không có N+1 query rõ ràng ở trang lịch sử.
- Pagination/filter ổn định, không lặp/mất item.
- History không được ghi như một nguồn dữ liệu độc lập.

**Tests:** Query integration, authorization/scope test, pagination test, UI component test và history E2E.

### C09 — Fault matrix, hardening và nghiệm thu

**Dependency:** C01–C08.

**Thực hiện:** rà soát FR-10..FR-14, FR-16 liên quan; chạy E2E bằng fake LLM/seed data; smoke test với provider thật nếu môi trường cho phép.

**Deliverable:** Module sẵn sàng merge/release, kèm handoff và test evidence.

**Acceptance criteria:**

- Network error, timeout, duplicate submit, invalid AI output, invalid timestamp và empty history đều có hành vi xác định.
- Lỗi assessment không pause/reload/phá YouTube player.
- Không lộ correct answer/API key/raw prompt ngoài phạm vi.
- Chrome và Edge smoke flow đạt nếu extension target cả hai.

**Tests:** Toàn bộ unit, integration, contract, E2E; manual fault checklist; optional real-LLM evaluation không chặn CI deterministic.

## 9. Ma trận test tối thiểu

| Trường hợp | Kết quả mong đợi |
|---|---|
| MCQ chọn đáp án đúng | `correct`, score hợp lệ, có explanation. |
| MCQ chọn đáp án sai | `incorrect`, không lỗi hệ thống. |
| Option ID không tồn tại | Validation error; không ghi thành incorrect. |
| Short Answer đúng ý | `correct` hoặc score theo rubric. |
| Short Answer đúng một phần | `partiallyCorrect`, explanation chỉ rõ phần thiếu. |
| Short Answer rỗng | Chặn ở client và server. |
| Double click submit | Một attempt duy nhất. |
| Retry sau timeout | Giữ draft, reuse attempt ID, không tạo bản ghi trùng. |
| AI trả JSON sai schema | `grading_output_invalid`, không hiển thị sai. |
| AI timeout | Retryable error; không kết luận incorrect. |
| Timestamp âm/NaN/quá duration | Không emit `SEEK_REQUEST`. |
| Video hiện tại khác video lịch sử | Không seek nhầm; hướng dẫn mở đúng video. |
| History rỗng | Empty state, không phải error. |
| History nhiều trang | Không lặp/mất record khi chuyển trang. |
| Backend restart | Attempt/grade cũ vẫn đọc được. |
| Fake LLM CI | Kết quả deterministic, không cần network/API key. |

## 10. File dùng chung `[HOT]`

Các file sau không thuộc quyền sửa trực tiếp của Dev 3:

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

Khi cần tích hợp module vào một file `[HOT]`:

1. Hoàn thành code feature-local trước.
2. Ghi chính xác registration/import/route cần thêm trong handoff.
3. Mở PR tích hợp nhỏ hoặc yêu cầu Integration Captain thực hiện.
4. Không trộn thay đổi `[HOT]` với một PR nghiệp vụ lớn.

## 11. Quy tắc Git, PR và dùng Codex

### 11.1 Branch và PR

- Một worktree riêng cho Dev 3/Codex.
- Branch theo task, ví dụ `feat/d3-c03-answer-submit`.
- Không dùng branch dài hạn tên `frontend`, `backend` hoặc `ai`.
- Một PR chỉ giải quyết một task Cxx hoặc một hành vi nhỏ có thể review.
- Rebase/update từ `main` trước khi handoff; không sửa/xóa thay đổi của dev khác.
- Contract thay đổi phải được consumer/owner liên quan review trước khi merge.
- Không commit secret, token, raw production prompt data hoặc output chứa dữ liệu nhạy cảm.

### 11.2 Nội dung prompt giao cho Codex

Mỗi prompt phải nêu:

- Task ID, ví dụ C05.
- Yêu cầu FR liên quan.
- Paths được phép sửa.
- Paths/file `[HOT]` không được sửa.
- Contract version và fixtures cần dùng.
- Acceptance criteria cụ thể.
- Lệnh test cần chạy.
- Hành vi khi dependency chưa có: dùng fake/fixture, không tự sửa module người khác.

Prompt mẫu:

```text
Implement C05 for AssessmentHistory.

Allowed paths:
- apps/extension/src/features/assessment-history/**
- services/api/src/StudyLens.Api/Features/AssessmentHistory/**
- services/api/tests/AssessmentHistory.Tests/**
- tests/e2e/assessment-history/**

Do not modify:
- YouTube platform adapter or DOM access
- SessionQuiz and VideoActivation entities/services
- App.tsx, Program.cs, StudyLensDbContext.cs, Migrations/**
- root OpenAPI files, lockfiles, CI files

Use public-api `0.1.0`, grading-api `0.1.0`, extension-message `0.1.0`
and deterministic fake LLM fixtures. Consume `QuizAvailable` and `QuestionPublic`
exactly as published by Dev 2. Use `IQuestionAssessmentReader` for the
server-side `QuestionForAssessment` record; do not access SessionQuiz storage.
Implement result states and retry while preserving answer draft and clientAttemptId.
Run relevant unit, integration, contract and E2E tests. Report changed files,
test evidence, assumptions and required HOT-file integration separately.
```

### 11.3 Lệnh kiểm tra

Dùng đúng scripts đã khai báo trong repo. Nếu chưa có, thống nhất tên trước với Integration Captain. Nhóm lệnh tối thiểu tương ứng:

```text
Extension: lint + typecheck + unit/component tests
Backend:   dotnet build + AssessmentHistory unit/integration tests
AI:        ruff/type check nếu có + pytest grading tests
Contract:  OpenAPI/JSON Schema validation + contract tests
E2E:       assessment-history flow với seed data và fake LLM
```

Không sửa lockfile hoặc bootstrap config chỉ để làm test của một task chạy trên máy cá nhân.

## 12. Definition of Done

Một task của Dev 3 chỉ được coi là hoàn thành khi:

- Chỉ sửa đúng scope file được giao hoặc có phê duyệt cho `[HOT]`.
- Contract/examples được cập nhật trước hoặc cùng lúc với implementation liên quan.
- Extension không thao tác trực tiếp YouTube DOM.
- Không tạo/sửa transcript, session, segment, quiz hoặc question.
- Public response không lộ đáp án đúng, rubric bí mật hoặc raw LLM output.
- MCQ và Short Answer có hành vi, validation và test rõ ràng.
- Retry giữ draft và idempotency ngăn record trùng.
- Timeout/invalid output không bị hiểu thành câu trả lời sai.
- Invalid timestamp không phát seek event.
- History dùng read model, đúng scope và có empty/error/pagination state.
- Unit, integration, contract và E2E liên quan đều pass.
- Fake LLM/seed data làm CI deterministic và không cần network/API key.
- Error của module không làm hỏng hoặc dừng YouTube player.
- PR có mô tả thay đổi, test evidence, dependency và migration/HOT-file request.

## 13. Handoff khi hoàn tất

Dev 3 bàn giao theo mẫu:

```md
## Handoff — DEV 3 / Cxx

### Đã hoàn thành
- ...

### Contract đã cung cấp/tiêu thụ
- public-api version: ...
- ai-api version: ...
- extension-message version: ...

### File chính đã thay đổi
- ...

### Test evidence
- Command: ...
- Result: ...

### Dependency cho Dev 1
- SEEK_REQUEST contract/behavior: ...

### Dependency cho Dev 2
- QuizAvailable / QuestionPublic / QuestionForAssessment expectation: ...

### Việc Integration Captain cần làm
- Registration trong file HOT: ...
- EF migration: ...

### Rủi ro hoặc giới hạn còn lại
- ...
```

Handoff phải nêu rõ những gì **chưa** được tích hợp; không ghi “done” nếu mới hoàn thành riêng frontend, backend hoặc AI mà luồng tương ứng chưa được kiểm chứng. Mục tiêu là mỗi mốc merge tạo ra một lát cắt Assessment & History có thể chạy, test và ghép với hai module còn lại thông qua contract ổn định.
