using DotNet.Testcontainers.Configurations;
using Npgsql;
using Testcontainers.PostgreSql;

namespace Ember.Tests;

/// <summary>
/// Fact that needs Docker: skipped locally when Docker is unreachable, but never skipped when <c>CI=true</c>,
/// so a CI runner without Docker fails instead of silently passing.
/// </summary>
public sealed class DockerFactAttribute : FactAttribute
{
    internal static readonly bool ShouldRun =
        TestcontainersSettings.OS.DockerEndpointAuthConfig is not null
        || string.Equals(Environment.GetEnvironmentVariable("CI"), "true", StringComparison.OrdinalIgnoreCase);

    public DockerFactAttribute()
    {
        if (!ShouldRun)
            Skip = "Docker is not available (set CI=true to force these tests to run).";
    }
}

/// <summary>Starts one Postgres container per test run and hands out an empty database per test.</summary>
public sealed class PostgresFixture : IAsyncLifetime
{
    private PostgreSqlContainer? _container;

    public async Task InitializeAsync()
    {
        if (!DockerFactAttribute.ShouldRun)
            return;

        _container = new PostgreSqlBuilder("postgres:17-alpine").Build();
        await _container.StartAsync();
    }

    public async Task<string> CreateDatabaseAsync()
    {
        if (_container is null)
            throw new InvalidOperationException("Postgres container is not running.");

        var name = $"ember_{Guid.NewGuid():N}";
        await using (var connection = new NpgsqlConnection(_container.GetConnectionString()))
        {
            await connection.OpenAsync();
            await using var command = new NpgsqlCommand($"CREATE DATABASE \"{name}\"", connection);
            await command.ExecuteNonQueryAsync();
        }

        return new NpgsqlConnectionStringBuilder(_container.GetConnectionString()) { Database = name }.ConnectionString;
    }

    public async Task DisposeAsync()
    {
        if (_container is not null)
            await _container.DisposeAsync();
    }
}

[CollectionDefinition("Postgres")]
public class PostgresCollection : ICollectionFixture<PostgresFixture>;
