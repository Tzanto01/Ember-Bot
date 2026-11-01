using Ember.Core.Data;
using Microsoft.EntityFrameworkCore;
using Testcontainers.PostgreSql;

namespace Ember.Api.TestHost;

/// <summary>
/// Runs the real API in Development against a throwaway PostgreSQL container, with the outbox and fake Discord from
/// <see cref="TestFakes"/> and the <see cref="TestEndpoints"/>. <c>Ember:WebOrigin</c> defaults to the first <c>--urls</c> value;
/// <c>--webroot &lt;dir&gt;</c> serves a built web app (as <c>Ember:WebRoot</c>).
/// </summary>
public static class TestHostProgram
{
    public static async Task Main(string[] args)
    {
        var webRoot = Array.IndexOf(args, "--webroot");
        if (webRoot >= 0 && webRoot + 1 < args.Length)
            args = [.. args[..webRoot], $"--webroot={args[webRoot + 1]}", .. args[(webRoot + 2)..]];
        args = args.Select(a => a.StartsWith("--webroot=", StringComparison.Ordinal)
            ? $"--Ember:WebRoot={Path.GetFullPath(a["--webroot=".Length..])}"
            : a).ToArray();

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
