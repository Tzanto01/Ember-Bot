# ── Build stage ───────────────────────────────────────────────────────────────
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src
COPY src/ src/
RUN dotnet restore src/Ember.Api/Ember.Api.csproj
RUN dotnet publish src/Ember.Api/Ember.Api.csproj \
    -c Release \
    --no-restore \
    -o /app/publish

# ── Runtime stage ─────────────────────────────────────────────────────────────
FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS runtime
WORKDIR /app
COPY --from=build /app/publish .
RUN mkdir /keys && chown $APP_UID /keys
USER $APP_UID
ENTRYPOINT ["dotnet", "Ember.Api.dll"]
