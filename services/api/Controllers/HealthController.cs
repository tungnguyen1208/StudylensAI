using Microsoft.AspNetCore.Mvc;
using StudyLens.Api.AI;
using StudyLens.Api.Common.Responses;

namespace StudyLens.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
public sealed class HealthController : ControllerBase
{
    private readonly AIServiceClient _aiServiceClient;

    public HealthController(AIServiceClient aiServiceClient)
    {
        _aiServiceClient = aiServiceClient;
    }

    [HttpGet]
    public ActionResult<HealthResponse> Get()
    {
        return Ok(new HealthResponse("ok", "studylens-api"));
    }

    [HttpGet("ai-service")]
    public async Task<ActionResult<AIHealthResponse>> GetAIServiceHealth(CancellationToken cancellationToken)
    {
        try
        {
            var result = await _aiServiceClient.GetHealthAsync(cancellationToken);
            return Ok(result);
        }
        catch (HttpRequestException)
        {
            return StatusCode(StatusCodes.Status502BadGateway, new
            {
                status = "unavailable",
                service = "studylens-ai-service"
            });
        }
        catch (TaskCanceledException)
        {
            return StatusCode(StatusCodes.Status502BadGateway, new
            {
                status = "timeout",
                service = "studylens-ai-service"
            });
        }
    }
}
