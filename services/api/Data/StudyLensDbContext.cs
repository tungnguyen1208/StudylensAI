using Microsoft.EntityFrameworkCore;

namespace StudyLens.Api.Data;

public sealed class StudyLensDbContext : DbContext
{
    public StudyLensDbContext(DbContextOptions<StudyLensDbContext> options)
        : base(options)
    {
    }
}

