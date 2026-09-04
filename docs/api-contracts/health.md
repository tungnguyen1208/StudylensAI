# Health API Contracts

## GET /api/health

- Caller: Chrome/Edge Extension, developers, health checks
- Target service: ASP.NET Core Backend
- Request: no body
- Success status: `200 OK`
- Error status codes: `500 Internal Server Error` for unexpected backend failures

### Response

```json
{
  "status": "ok",
  "service": "studylens-api"
}
```

## GET /api/health/ai-service

- Caller: developers, backend diagnostics
- Target service: ASP.NET Core Backend, which calls FastAPI AI Service
- Request: no body
- Success status: `200 OK`
- Error status codes: `502 Bad Gateway` or `500 Internal Server Error` when the AI service cannot be reached or returns invalid data

### Response

```json
{
  "status": "ok",
  "service": "studylens-ai-service"
}
```

## GET /health

- Caller: ASP.NET Core Backend, developers, health checks
- Target service: FastAPI AI Service
- Request: no body
- Success status: `200 OK`
- Error status codes: `500 Internal Server Error` for unexpected AI service failures

### Response

```json
{
  "status": "ok",
  "service": "studylens-ai-service"
}
```

