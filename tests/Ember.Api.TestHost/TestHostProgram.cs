using Ember.Core.Data;
using Microsoft.EntityFrameworkCore;
using Testcontainers.PostgreSql;

namespace Ember.Api.TestHost;

/// <summary>
/// Runs the real API in Development against a throwaway PostgreSQL container, with the outbox and fake Discord from
/// <see cref="TestFakes"/> and the <see cref="TestEndpoints"/>. <c>Ember:WebOrigin</c> defaults to the first <c>--urls</c> value.
/// </summary>
public static class TestHostProgram
{
    public static async Task Main(string[] args)
    {
        var startup = new ConfigurationBuilder().AddEnvironmentVariables().AddCommandLine(args).Build();
        var url = (startup["urls"] ?? startup["ASPNETCORE_URLS"] ?? "http://localhost:5000")
            .Split(';', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)[0].TrimEnd('/');

        await using var postgres = new PostgreSqlBuilder("postgres:17-alpine").Build();
        await postgres.StartAsync();

        var builder = ApiApp.CreateBuilder(["--environment", "Development", .. args]);
        builder.Configuration["ConnectionStrings:DefaultConnection"] = postgres.GetConnectionString();
        builder.Configuration["Ember:WebOrigin"] = startup["Ember:WebOrigin"] is { Length: > 0 } origin ? origin : url;
        builder.Services.AddEmberTestFakes($"{url}{TestFakes.AuthorizePath}");

        await using var app = ApiApp.Build(builder, extra => extra.MapEmberTestEndpoints());

        await using (var scope = app.Services.CreateAsyncScope())
            await scope.ServiceProvider.GetRequiredService<EmberDbContext>().Database.MigrateAsync();

        await app.RunAsync();
    }
}
