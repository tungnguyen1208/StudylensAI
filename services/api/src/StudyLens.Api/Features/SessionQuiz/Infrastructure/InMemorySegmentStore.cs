using StudyLens.Api.Features.SessionQuiz.Application.Abstractions;
using StudyLens.Api.Features.SessionQuiz.Domain;

namespace StudyLens.Api.Features.SessionQuiz.Infrastructure;

/// Interim store until B06 replaces it with EF Core and a unique index on (SessionId, ClientSegmentId).
public sealed class InMemorySegmentStore : ISegmentRepository
{
    private readonly object _gate = new();
    private readonly Dictionary<(string SessionId, string ClientSegmentId), StudySegment> _segments = new();
    private readonly Dictionary<string, int> _sequenceBySession = new();

    public StudySegment? Find(string sessionId, string clientSegmentId)
    {
        lock (_gate)
        {
            return _segments.TryGetValue((sessionId, clientSegmentId), out var segment) ? segment : null;
        }
    }

    public StudySegment? FindById(string sessionId, string segmentId)
    {
        lock (_gate)
        {
            return _segments.Values.FirstOrDefault(segment =>
                segment.SessionId == sessionId && segment.SegmentId == segmentId);
        }
    }

    public StudySegment GetOrAdd(string sessionId, string clientSegmentId, Func<int, StudySegment> create)
    {
        lock (_gate)
        {
            var key = (sessionId, clientSegmentId);
            if (_segments.TryGetValue(key, out var existing)) return existing;

            var sequenceNumber = _sequenceBySession.TryGetValue(sessionId, out var current) ? current + 1 : 1;
            var created = create(sequenceNumber);
            _segments[key] = created;
            _sequenceBySession[sessionId] = sequenceNumber;
            return created;
        }
    }
}
