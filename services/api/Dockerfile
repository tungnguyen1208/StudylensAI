FROM mcr.microsoft.com/dotnet/sdk:8.0-bookworm-slim@sha256:78235e09001f52b6592c458ac010775ebac6725422e80cd0c1650590f67b2743 AS build
WORKDIR /src

COPY StudyLens.sln ./
COPY src/StudyLens.Api/StudyLens.Api.csproj src/StudyLens.Api/
RUN dotnet restore src/StudyLens.Api/StudyLens.Api.csproj

COPY src/StudyLens.Api/ src/StudyLens.Api/
RUN dotnet publish src/StudyLens.Api/StudyLens.Api.csproj \
    --configuration Release \
    --no-restore \
    --output /app/publish \
    /p:UseAppHost=false

FROM mcr.microsoft.com/dotnet/aspnet:8.0-bookworm-slim@sha256:2f202e1169ec507bdc07007cf68c14d0ff3a098110b17c460a60185e1f36a9d1 AS runtime
RUN apt-get update \
    && apt-get install --yes --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build --chown=app:app /app/publish ./
USER app
EXPOSE 8080
ENTRYPOINT ["dotnet", "StudyLens.Api.dll"]
