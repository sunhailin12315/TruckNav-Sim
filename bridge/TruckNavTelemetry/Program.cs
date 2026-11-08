using System;
using System.Threading;

namespace TruckNavTelemetry;

internal static class Program
{
    private static void Main()
    {
        try
        {
            var webSocketService = new WebSocketService(30001);
            webSocketService.Start();
            new TelemetryManager(webSocketService);
            while (true)
            {
                Thread.Sleep(1000);
            }
        }
        catch (Exception ex)
        {
            Console.WriteLine($"Fatal error: {ex}");
            Environment.Exit(1);
        }
    }
}
