using System;
using System.Collections.Generic;
using System.Linq;
using Fleck;

namespace TruckNavTelemetry;

/// <summary>
/// Minimal fan-out server: every telemetry packet is broadcast as one JSON
/// text message to each connected client (the TruckNav web/electron/mobile UI).
/// </summary>
internal sealed class WebSocketService
{
    private readonly WebSocketServer _server;
    private readonly List<IWebSocketConnection> _clients = new();
    private readonly object _listLock = new();

    public WebSocketService(int port)
    {
        _server = new WebSocketServer($"ws://0.0.0.0:{port}", true);
    }

    public void Start()
    {
        try
        {
            _server.Start(socket =>
            {
                socket.OnOpen = () =>
                {
                    lock (_listLock)
                    {
                        _clients.Add(socket);
                    }
                    Console.WriteLine("New Client Connected");
                };
                socket.OnClose = () =>
                {
                    lock (_listLock)
                    {
                        _clients.Remove(socket);
                    }
                };
            });
        }
        catch
        {
            Environment.Exit(1);
        }
    }

    public void Broadcast(string message)
    {
        List<IWebSocketConnection> snapshot;
        lock (_listLock)
        {
            snapshot = _clients.ToList();
        }
        foreach (var client in snapshot)
        {
            if (client.IsAvailable)
            {
                client.Send(message);
            }
        }
    }
}
