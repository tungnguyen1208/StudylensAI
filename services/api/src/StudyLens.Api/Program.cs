using Microsoft.EntityFrameworkCore;
using StudyLens.Api.BuildingBlocks.Health;
using StudyLens.Api.BuildingBlocks.Http;
using StudyLens.Api.Features.AssessmentHistory;
using StudyLens.Api.Features.SessionQuiz;
using StudyLens.Api.Features.VideoActivation;
using StudyLens.Api.Infrastructure.Persistence;

var builder = WebApplication.CreateBuilder(args);

// Add services to the container
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();

// Configure CORS for Chrome/Edge extensions and local development
builder.Services.AddCors(options =>
{
    options.AddPolicy("AllowLocalAndExtension", policy =>
    {
        policy.SetIsOriginAllowed(origin =>
            {
                if (string.IsNullOrEmpty(origin)) return false;
                var uri = new Uri(origin);
                return uri.Host == "localhost"
                       || uri.Scheme == "chrome-extension"
                       || uri.Scheme == "edge-extension";
            })
            .AllowAnyHeader()
            .AllowAnyMethod();
    });
});

// Configure EF Core SQLite
var connectionString = builder.Configuration.GetConnectionString("DefaultConnection")
                       ?? "Data Source=studylens.db";
builder.Services.AddDbContext<StudyLensDbContext>(options =>
{
    options.UseSqlite(connectionString);
});

// Register AI Health Client
builder.Services.AddHttpClient<AiHealthClient>();

// Register Vertical Feature Modules (Dev 1, Dev 2, Dev 3)
builder.Services.AddVideoActivationModule(builder.Configuration);
builder.Services.AddSessionQuizModule(builder.Configuration);
builder.Services.AddAssessmentHistoryModule(builder.Configuration);

var app = builder.Build();

// Configure the HTTP request pipeline
if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();
}

app.UseCors("AllowLocalAndExtension");

// Map Health Endpoints
app.MapHealthEndpoints();

// Map Vertical Feature Endpoints
app.MapVideoActivationEndpoints();
app.MapSessionQuizEndpoints();
app.MapAssessmentHistoryEndpoints();

app.Run();
