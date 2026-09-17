Tuần	Người 1	Người 2	Người 3	Mốc tích hợp
1	Detector, PlayerPort, Extension shell	Session skeleton, fake clock	Quiz UI bằng seed data	Extension → Backend → fake AI → UI chạy được
2	Manual ON/OFF, transcript adapter	Session, timer, segment bằng transcript fixture	Answer/result/history bằng quiz fixture	Manual flow tạo session và làm mock quiz
3	Classification, Auto, settings	Question pipeline với deterministic fake LLM	Grading và persistence với fake LLM	Toàn bộ E2E chạy với fake LLM
4	Threshold, unknown, override, transcript lỗi	LLM thật sinh MCQ/short answer	LLM thật chấm, giải thích, seek, history	Auto và Manual chạy end-to-end
5	Browser/video-change failure cases	Timeout, idempotency, invalid output	Retry, invalid timestamp, history consistency	Fault matrix và Chrome/Edge pass
6	Acceptance, packaging Extension	Migration, security, deployment	AI evaluation, release E2E	Hoàn thành 15 tiêu chí nghiệm thu

# Personal Codex Defaults

## StudyLensAI Role

Khi làm việc trong repo `StudyLensAI`, tôi là `<DEV_ROLE>`.

Thay `<DEV_ROLE>` bằng một trong các giá trị sau:
- `Dev 1 - Video Activation & Content Acquisition`
- `Dev 2 - Study Session & Quiz Generation`
- `Dev 3 - Assessment, Grading & History`
- `Integration Captain`

Trước khi sửa code trong `StudyLensAI`, luôn đọc và tuân theo:
1. Root repo `AGENTS.md`
2. Nested `AGENTS.md` gần folder đang sửa
3. `.agents/rules/common-dev-rules.md`
4. `.agents/rules/module-boundary-rules.md`
5. Rule riêng tương ứng trong `.agents/rules/dev/`
6. Custom agent profile tương ứng trong `.codex/agents/`

Không copy rule chi tiết vào file cá nhân này. Repo `StudyLensAI` là source of truth cho kiến trúc, API contract, module ownership và HOT files.

Nếu task có thay đổi API/DTO/message schema, ưu tiên dùng `$studylens-contract-first`.

Nếu task là feature thường của Dev 1/2/3, ưu tiên dùng `$studylens-vertical-feature`.

Nếu task chạm shared/HOT files, migrations, root contracts hoặc module wiring, chỉ làm khi user yêu cầu rõ và ưu tiên dùng `$studylens-integration-captain`.