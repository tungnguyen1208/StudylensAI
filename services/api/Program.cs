using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using StudyLens.Api.AI;
using StudyLens.Api.Data;

try
{
    var builder = WebApplication.CreateBuilder(args);

    builder.Services.AddControllers();
    builder.Services.AddEndpointsApiExplorer();
    builder.Services.AddSwaggerGen();

    builder.Services.Configure<AIServiceOptions>(
        builder.Configuration.GetSection(AIServiceOptions.SectionName));

    builder.Services.AddHttpClient<AIServiceClient>((serviceProvider, client) =>
    {
        var options = serviceProvider.GetRequiredService<IOptions<AIServiceOptions>>().Value;
        var baseUrl = Environment.GetEnvironmentVariable("AI_SERVICE_URL") ?? options.BaseUrl;
        client.BaseAddress = new Uri(baseUrl);
    });

    var connectionString =
        Environment.GetEnvironmentVariable("DATABASE_CONNECTION")
        ?? builder.Configuration.GetConnectionString("StudyLens")
        ?? "Data Source=studylens.db";

    builder.Services.AddDbContext<StudyLensDbContext>(options =>
        options.UseSqlite(connectionString));

    builder.Services.AddCors(options =>
    {
        options.AddPolicy("LocalExtensionDevelopment", policy =>
        {
            policy.AllowAnyOrigin()
                .AllowAnyHeader()
                .AllowAnyMethod();
        });
    });

    var app = builder.Build();

    if (app.Environment.IsDevelopment())
    {
        app.UseSwagger();
        app.UseSwaggerUI();
    }

    app.UseCors("LocalExtensionDevelopment");
    app.MapControllers();

    app.Run();
}
catch (Exception exception)
{
    Console.Error.WriteLine($"StudyLens API failed to start: {exception.Message}");
    throw;
}

