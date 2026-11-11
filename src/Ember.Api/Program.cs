using Ember.Api;

if (args is ["--healthcheck"])
{
    var port = (Environment.GetEnvironmentVariable("ASPNETCORE_HTTP_PORTS") ?? "8080").Split([',', ';'])[0];
    using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(5) };
    try
    {
        return (await http.GetAsync($"http://127.0.0.1:{port}/health")).IsSuccessStatusCode ? 0 : 1;
    }
    catch (Exception)
    {
        return 1;
    }
}

var app = ApiApp.Build(ApiApp.CreateBuilder(args));
app.Run();
return 0;

public partial class Program { }
