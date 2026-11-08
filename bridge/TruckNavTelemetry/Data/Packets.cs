using System;
using System.Collections.Generic;

// Wire DTOs. Property order and names are the JSON contract with the TruckNav
// app (app/types/telemetry.ts); serialization is source-generated camelCase.

namespace TruckNavTelemetry;

public class Vector3
{
    public double X { get; set; }
    public double Y { get; set; }
    public double Z { get; set; }
}

public class PositionData
{
}

public class CargoData
{
    public float Mass { get; set; }
    public string Name { get; set; } = string.Empty;
    public float CargoDamage { get; set; }
}

public class CommonData
{
    public float MapScale { get; set; }
    public DateTime GameTime { get; set; }
    public int NextRestStopMinutes { get; set; }
}

public class TruckConstants
{
    public float FuelCapacity { get; set; }
    public string Brand { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
}

public class DashboardData
{
    public float FuelAmount { get; set; }
    public float AverageConsumption { get; set; }
    public float FuelRange { get; set; }
    public bool FuelWarning { get; set; }
    public int CurrentGear { get; set; }
    public float SpeedKph { get; set; }
    public float SpeedMph { get; set; }
    public float CruiseControlSpeedKph { get; set; }
    public float CruiseControlSpeedMph { get; set; }
    public bool CruiseControlActive { get; set; }
    public float Rpm { get; set; }
    public float Odometer { get; set; }
}

public class LightsData
{
    public bool Parking { get; set; }
    public bool BeamLow { get; set; }
    public bool BeamHigh { get; set; }
}

public class TruckDamageData
{
    public float Engine { get; set; }
    public float Transmission { get; set; }
    public float Cabin { get; set; }
    public float Chassis { get; set; }
    public float Wheels { get; set; }
}

public class TruckCurrent
{
    public DashboardData Dashboard { get; set; } = new();
    public LightsData Lights { get; set; } = new();
    public TruckDamageData Damage { get; set; } = new();
    public Vector3 Position { get; set; } = new();
    public float Heading { get; set; }
    public bool ParkingBrake { get; set; }
}

public class TruckData
{
    public TruckConstants Constants { get; set; } = new();
    public TruckCurrent Current { get; set; } = new();
    public PositionData Positioning { get; set; } = new();
}

public class TrailerDamageData
{
    public float Cargo { get; set; }
    public float Wheels { get; set; }
    public float Chassis { get; set; }
}

public class TrailerData
{
    public bool Attached { get; set; }
    public TrailerDamageData Damage { get; set; } = new();
    public Vector3 Position { get; set; } = new();
    public float Heading { get; set; }
    public string Brand { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
}

public class JobData
{
    public DateTime RemainingDeliveryTime { get; set; }
    public int RemainingDeliveryMinutes { get; set; }
    public bool CargoLoaded { get; set; }
    public bool SpecialJob { get; set; }
    public string JobType { get; set; } = string.Empty;
    public CargoData Cargo { get; set; } = new();
    public string CityDestinationId { get; set; } = string.Empty;
    public string CityDestination { get; set; } = string.Empty;
    public string CompanyDestinationId { get; set; } = string.Empty;
    public string CompanyDestination { get; set; } = string.Empty;
    public string CitySourceId { get; set; } = string.Empty;
    public string CitySource { get; set; } = string.Empty;
    public string CompanySourceId { get; set; } = string.Empty;
    public string CompanySource { get; set; } = string.Empty;
    public ulong income { get; set; }
}

public class NavigationData
{
    public float Distance { get; set; }
    public float Time { get; set; }
    public float SpeedLimitKph { get; set; }
    public float SpeedLimitMph { get; set; }
}

public class SpecialEvents
{
    public bool OnJob { get; set; }
    public bool JobCancelled { get; set; }
    public bool JobDelivered { get; set; }
    public bool Fined { get; set; }
    public bool Tollgate { get; set; }
    public bool Ferry { get; set; }
    public bool Train { get; set; }
}

public class TransportEvent
{
    public long PayAmount { get; set; }
    public string SourceName { get; set; } = string.Empty;
    public string TargetName { get; set; } = string.Empty;
}

public class FinedEvent
{
    public long PayAmount { get; set; }
    public string Offence { get; set; } = string.Empty;
}

public class Delivered
{
    public bool AutoLoaded { get; set; }
    public bool AutoParker { get; set; }
    public float CargoDamage { get; set; }
    public DateTime DeliveryTime { get; set; }
    public float DistanceKm { get; set; }
    public int EarnedXp { get; set; }
    public long Revenue { get; set; }
}

public class GamePlayEvents
{
    public TransportEvent FerryData { get; set; } = new();
    public FinedEvent FinedData { get; set; } = new();
    public long JobCancelledPenalty { get; set; }
    public Delivered JobDelivered { get; set; } = new();
    public long TollgatePayment { get; set; }
    public TransportEvent TrainData { get; set; } = new();
}

public class TelemetryPacket
{
    public bool Paused { get; set; }
    public string Game { get; set; } = string.Empty;
    public string GameVersion { get; set; } = string.Empty;
    public string TelemetryVersion { get; set; } = string.Empty;
    public CommonData Common { get; set; } = new();
    public TruckData Truck { get; set; } = new();
    public IEnumerable<TrailerData> Trailers { get; set; } = new List<TrailerData>();
    public JobData Job { get; set; } = new();
    public NavigationData Navigation { get; set; } = new();
    public SpecialEvents SpecialEvents { get; set; } = new();
    public GamePlayEvents GamePlayEvents { get; set; } = new();
}
