using StudyLens.Api.Features.SessionQuiz.Domain;

namespace StudyLens.Api.Features.SessionQuiz.Application.Abstractions;

public interface ISegmentRepository
{
    StudySegment? Find(string sessionId, string clientSegmentId);

    StudySegment? FindById(string sessionId, string segmentId);

    StudySegment GetOrAdd(string sessionId, string clientSegmentId, Func<int, StudySegment> create);
}
