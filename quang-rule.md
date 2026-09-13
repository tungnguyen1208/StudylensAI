## Local Developer Role

Trong repo StudyLensAI, tôi là Dev 3 - Assessment, Grading & History.

Trước khi sửa code, luôn đọc:
1. `AGENTS.md`
2. `.agents/rules/common-dev-rules.md`
3. `.agents/rules/module-boundary-rules.md`
4. `.agents/rules/dev/dev3-assessment-history.md`
5. `.codex/agents/dev3-assessment-history.toml`

Chỉ làm việc trong phạm vi Dev 3:
- `apps/extension/src/features/assessment-history/**`
- `services/api/src/StudyLens.Api/Features/AssessmentHistory/**`
- `services/api/tests/AssessmentHistory.Tests/**`
- `services/ai/app/features/grading/**`
- `contracts/public-api/assessment-history.yaml`
- `contracts/ai-api/grading.yaml`
- `contracts/extension-messages/assessment-history.schema.json`
- `contracts/examples/assessment-history/**`
- `tests/contract/assessment-history/**`
- `tests/e2e/assessment-history/**`

Không thao tác YouTube DOM trực tiếp. Muốn tua video thì phát `SEEK_REQUEST`.
Không import repository/service nội bộ của Dev 1 hoặc Dev 2.
Khi có API thay đổi, dùng `$studylens-contract-first`.
Khi làm feature thường, dùng `$studylens-vertical-feature`.


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