c	Người 1	Người 2	Người 3	Mốc tích hợp
1	Detector, PlayerPort, Extension shell	Session skeleton, fake clock	Quiz UI bằng seed data	Extension → Backend → fake AI → UI chạy được
2	Manual ON/OFF, transcript adapter	Session, timer, segment bằng transcript fixture	Answer/result/history bằng quiz fixture	Manual flow tạo session và làm mock quiz
3	Classification, Auto, settings	Question pipeline với deterministic fake LLM	Grading và persistence với fake LLM	Toàn bộ E2E chạy với fake LLM
4	Threshold, unknown, override, transcript lỗi	LLM thật sinh MCQ/short answer	LLM thật chấm, giải thích, seek, history	Auto và Manual chạy end-to-end
5	Browser/video-change failure cases	Timeout, idempotency, invalid output	Retry, invalid timestamp, history consistency	Fault matrix và Chrome/Edge pass
6	Acceptance, packaging Extension	Migration, security, deployment	AI evaluation, release E2E	Hoàn thành 15 tiêu chí nghiệm thu
