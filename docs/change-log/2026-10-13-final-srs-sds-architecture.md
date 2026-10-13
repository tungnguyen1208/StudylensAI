# Final SRS/SDS architecture alignment

**Date:** 2026-10-13  
**Status:** implemented  
**Document revision:** 1.2.3  
**Public contract:** 0.5.0  
**Internal quiz prompt:** 0.5.1

## Scope

- Created final SRS and SDS copies under `docs/reports/` without overwriting the Word documents that were open during the update.
- Aligned the reports with the current Extension → ASP.NET Core Backend → FastAPI → Gemini flow and PostgreSQL durable persistence.
- Replaced architecture drawings with versioned PlantUML sources under `docs/architecture/uml/`.
- Kept the reports focused on product architecture and business responsibilities rather than local development tooling.

## Verified source facts

- The Extension calls only the ASP.NET Core Backend through public contract `0.5.0`.
- FastAPI is stateless and is the only component that calls Google Gemini API.
- PostgreSQL 16 is the business source of truth for video, session, transcript, processing job, quiz, attempt and history data.
- Quiz generation receives the normalized video title and full transcript using internal prompt version `0.5.1`; the title is topic context, while transcript cues remain the only evidence.
- The actual persistence model uses `Videos`, `StudySessions`, `TranscriptCaptures`, `TranscriptCaptureCues`, `ProcessingJobs`, `QuizAssessments`, `QuestionAssessments`, `QuestionOptions`, `QuizAttempts` and `AttemptAnswers`. Legacy tables are documented separately.
- Deployment-tool details, local ports, containers and database administration utilities are intentionally excluded from the reports because they are not part of the product architecture.

## Visual QA

- SRS: 31 rendered A4 pages inspected.
- SDS: 29 rendered A4 pages inspected after removing a one-row orphan page from the database design table and local deployment prose that was outside the product architecture scope.
- Margins, centered top page numbers, Times New Roman styles, headings, captions, figure notes and table placement were checked in the rendered output.
- The canonical LibreOffice renderer was attempted but LibreOffice was not installed. Microsoft Word automation was therefore used to export PDF, followed by page-by-page PNG inspection.
- A live Extension screenshot was not inserted because browser automation could not access the protected `chrome-extension://` side-panel surface. The UI section uses a source-derived PlantUML state/navigation diagram instead of fabricated evidence.

## Remaining acceptance evidence

This documentation update does not claim completion of manual Chrome/Edge M-01…M-08 evidence or the final live Gemini quality smoke. Those items remain separate release evidence and must only be marked PASS after an actual run.
