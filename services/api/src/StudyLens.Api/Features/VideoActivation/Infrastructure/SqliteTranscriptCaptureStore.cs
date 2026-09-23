using Microsoft.EntityFrameworkCore;
using StudyLens.Api.Features.VideoActivation.Application.Contracts;
using StudyLens.Api.Infrastructure.Persistence;

namespace StudyLens.Api.Features.VideoActivation.Infrastructure;

internal sealed class SqliteTranscriptCaptureStore : ITranscriptCaptureReader
{
    private readonly StudyLensDbContext _db;

    public SqliteTranscriptCaptureStore(StudyLensDbContext db) => _db = db;

    public async Task<TranscriptCaptureEntity?> FindAsync(string captureId, CancellationToken cancellationToken) =>
        await _db.Set<TranscriptCaptureEntity>().Include(item => item.Cues).Include(item => item.Chunks)
            .SingleOrDefaultAsync(item => item.TranscriptCaptureId == captureId, cancellationToken);

    public async Task<TranscriptCaptureEntity?> FindByCreateKeyAsync(string idempotencyKey, CancellationToken cancellationToken) =>
        await _db.Set<TranscriptCaptureEntity>().Include(item => item.Cues).Include(item => item.Chunks)
            .SingleOrDefaultAsync(item => item.CreateIdempotencyKey == idempotencyKey, cancellationToken);

    public async Task<TranscriptAudioChunkEntity?> FindChunkAsync(string idempotencyKey, CancellationToken cancellationToken) =>
        await _db.Set<TranscriptAudioChunkEntity>().SingleOrDefaultAsync(item => item.IdempotencyKey == idempotencyKey, cancellationToken);

    public async Task AddAsync(TranscriptCaptureEntity capture, CancellationToken cancellationToken)
    {
        await _db.Set<TranscriptCaptureEntity>().AddAsync(capture, cancellationToken);
        await _db.SaveChangesAsync(cancellationToken);
    }

    public Task SaveAsync(CancellationToken cancellationToken) => _db.SaveChangesAsync(cancellationToken);

    public async Task<TranscriptCaptureForSession?> GetForSessionAsync(string transcriptCaptureId, CancellationToken cancellationToken)
    {
        var capture = await FindAsync(transcriptCaptureId, cancellationToken);
        return capture is null ? null : new TranscriptCaptureForSession(
            capture.TranscriptCaptureId,
            capture.YoutubeVideoId,
            capture.Language,
            capture.Status,
            capture.Version,
            capture.Cues.OrderBy(cue => cue.StartMs).Select(cue => new TranscriptCueForSession(cue.TranscriptCueId, cue.StartMs, cue.EndMs, cue.Text)).ToArray());
    }
}
