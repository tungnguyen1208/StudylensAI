using Microsoft.EntityFrameworkCore;

namespace StudyLens.Api.Infrastructure.Persistence;

public class StudyLensDbContext : DbContext
{
    public StudyLensDbContext(DbContextOptions<StudyLensDbContext> options)
        : base(options)
    {
    }

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        base.OnModelCreating(modelBuilder);
        // Allows modules to register their own entity configurations without editing this DbContext
        modelBuilder.ApplyConfigurationsFromAssembly(typeof(StudyLensDbContext).Assembly);
    }
}
