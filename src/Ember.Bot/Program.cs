using Ember.Bot;
using Microsoft.Extensions.Hosting;

var host = AppHost.CreateHostBuilder(args).Build();
await AppHost.InitializeAsync(host);

await host.RunAsync();
