using System.Text.Json;
using System.Text.Json.Serialization;

namespace TruckNavTelemetry;

/// <summary>
/// Source-generated serializer context (same camelCase policy as the shipped
/// bridge). The generator emits the fast-path metadata; DateTime values use
/// the default ISO-8601 round-trip format, which is what the app parses.
/// </summary>
[JsonSourceGenerationOptions(PropertyNamingPolicy = JsonKnownNamingPolicy.CamelCase)]
[JsonSerializable(typeof(TelemetryPacket))]
internal partial class TelemetryJsonContext : JsonSerializerContext
{
}
