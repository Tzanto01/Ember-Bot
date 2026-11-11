# ── Build stage ───────────────────────────────────────────────────────────────
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src
COPY src/ src/
RUN dotnet restore src/Ember.Api/Ember.Api.csproj
RUN dotnet publish src/Ember.Api/Ember.Api.csproj \
    -c Release \
    --no-restore \
    -o /app/publish

# ── Web build stage ───────────────────────────────────────────────────────────
FROM oven/bun:1.3.14 AS web
WORKDIR /web
COPY web/package.json web/bun.lock ./
RUN bun install --frozen-lockfile
COPY web/ ./
COPY docs/contracts/fixtures/ /docs/contracts/fixtures/
ARG VITE_PUBLIC_ORIGIN=""
ENV VITE_PUBLIC_ORIGIN=$VITE_PUBLIC_ORIGIN
RUN bun --bun run build

# ── Runtime stage ─────────────────────────────────────────────────────────────
FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS runtime
WORKDIR /app
COPY --from=build /app/publish .
COPY --from=web /web/dist/ember-web/browser /app/wwwroot
ENV Ember__WebRoot=/app/wwwroot
RUN mkdir /keys && chown $APP_UID /keys
USER $APP_UID
ENTRYPOINT ["dotnet", "Ember.Api.dll"]
