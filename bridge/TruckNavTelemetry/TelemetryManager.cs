using System;
using System.Linq;
using System.Text.Json;
using SCSSdkClient;
using SCSSdkClient.Object;

namespace TruckNavTelemetry;

/// <summary>
/// Polls the SCS shared-memory telemetry (via SCSSdkTelemetry), maps it to a
/// TelemetryPacket and broadcasts JSON to every WebSocket client at up to
/// ~30 Hz.
/// </summary>
internal sealed class TelemetryManager
{
    private readonly SCSSdkTelemetry _telemetry;
    private readonly WebSocketService _wsService;
    private DateTime _lastUpdate = DateTime.MinValue;

    public TelemetryManager(WebSocketService wsService)
    {
        _wsService = wsService;
        _telemetry = new SCSSdkTelemetry();
        _telemetry.Data += OnTelemetryData;
    }

    private void OnTelemetryData(SCSTelemetry data, bool updated)
    {
        // At most one broadcast per ~33 ms regardless of the SDK poll rate.
        if ((DateTime.Now - _lastUpdate).TotalMilliseconds < 33.0)
        {
            return;
        }

        var dashboard = data.TruckValues.CurrentValues.DashboardValues;
        var packet = new TelemetryPacket
        {
            Paused = data.Paused,
            Game = data.Game.ToString(),
            GameVersion = data.GameVersion.ToString(),
            TelemetryVersion = data.TelemetryVersion.ToString(),
            Common = new CommonData
            {
                MapScale = data.CommonValues.Scale,
                GameTime = data.CommonValues.GameTime.Date,
                NextRestStopMinutes = data.CommonValues.NextRestStop.Value,
            },
            Truck = new TruckData
            {
                Constants = new TruckConstants
                {
                    FuelCapacity = data.TruckValues.ConstantsValues.CapacityValues.Fuel,
                    Brand = data.TruckValues.ConstantsValues.Brand,
                    Name = data.TruckValues.ConstantsValues.Name,
                },
                Current = new TruckCurrent
                {
                    Dashboard = new DashboardData
                    {
                        FuelAmount = dashboard.FuelValue.Amount,
                        AverageConsumption = dashboard.FuelValue.AverageConsumption,
                        FuelRange = dashboard.FuelValue.Range,
                        FuelWarning = dashboard.WarningValues.FuelW,
                        CurrentGear = dashboard.GearDashboards,
                        SpeedKph = dashboard.Speed.Kph,
                        SpeedMph = dashboard.Speed.Mph,
                        CruiseControlSpeedKph = dashboard.CruiseControlSpeed.Kph,
                        CruiseControlSpeedMph = dashboard.CruiseControlSpeed.Mph,
                        CruiseControlActive = dashboard.CruiseControl,
                        Rpm = dashboard.RPM,
                        Odometer = dashboard.Odometer,
                    },
                    Lights = new LightsData
                    {
                        Parking = data.TruckValues.CurrentValues.LightsValues.Parking,
                        BeamLow = data.TruckValues.CurrentValues.LightsValues.BeamLow,
                        BeamHigh = data.TruckValues.CurrentValues.LightsValues.BeamHigh,
                    },
                    Damage = new TruckDamageData
                    {
                        Engine = data.TruckValues.CurrentValues.DamageValues.Engine,
                        Transmission =
                            data.TruckValues.CurrentValues.DamageValues.Transmission,
                        Cabin = data.TruckValues.CurrentValues.DamageValues.Cabin,
                        Chassis = data.TruckValues.CurrentValues.DamageValues.Chassis,
                        Wheels = data.TruckValues.CurrentValues.DamageValues.WheelsAvg,
                    },
                    Position = new Vector3
                    {
                        X = data.TruckValues.CurrentValues.PositionValue.Position.X,
                        Y = data.TruckValues.CurrentValues.PositionValue.Position.Y,
                        Z = data.TruckValues.CurrentValues.PositionValue.Position.Z,
                    },
                    Heading =
                        data.TruckValues.CurrentValues.PositionValue.Orientation.Heading,
                    ParkingBrake =
                        data.TruckValues.CurrentValues.MotorValues.BrakeValues
                            .ParkingBrake,
                },
            },
            Trailers = data.TrailerValues.Select(
                t => new TrailerData
                {
                    Attached = t.Attached,
                    Damage = new TrailerDamageData
                    {
                        Chassis = t.DamageValues.Chassis,
                        Wheels = t.DamageValues.Wheels,
                        Cargo = t.DamageValues.Cargo,
                    },
                    Position = new Vector3
                    {
                        X = t.Position.Position.X,
                        Y = t.Position.Position.Y,
                        Z = t.Position.Position.Z,
                    },
                    Heading = t.Position.Orientation.Heading,
                    Brand = t.Brand,
                    Name = t.Name,
                }
            ),
            Job = new JobData
            {
                RemainingDeliveryTime = data.JobValues.RemainingDeliveryTime.Date,
                // New in 1.1.0: the signed minute count. The SDK computes it
                // against the game clock (negative = late); the epoch-anchored
                // .Date above only survives as |delta|.
                RemainingDeliveryMinutes = data.JobValues.RemainingDeliveryTime.Value,
                CargoLoaded = data.JobValues.CargoLoaded,
                SpecialJob = data.JobValues.SpecialJob,
                JobType = data.JobValues.Market.ToString(),
                Cargo = new CargoData
                {
                    Mass = data.JobValues.CargoValues.Mass,
                    Name = data.JobValues.CargoValues.Name,
                    CargoDamage = data.JobValues.CargoValues.CargoDamage,
                },
                CityDestinationId = data.JobValues.CityDestinationId,
                CityDestination = data.JobValues.CityDestination,
                CompanyDestinationId = data.JobValues.CompanyDestinationId,
                CompanyDestination = data.JobValues.CompanyDestination,
                CitySourceId = data.JobValues.CitySourceId,
                CitySource = data.JobValues.CitySource,
                CompanySourceId = data.JobValues.CompanySourceId,
                CompanySource = data.JobValues.CompanySource,
                income = data.JobValues.Income,
            },
            Navigation = new NavigationData
            {
                Distance = data.NavigationValues.NavigationDistance,
                Time = data.NavigationValues.NavigationTime,
                SpeedLimitKph = data.NavigationValues.SpeedLimit.Kph,
                SpeedLimitMph = data.NavigationValues.SpeedLimit.Mph,
            },
            SpecialEvents = new SpecialEvents
            {
                OnJob = data.SpecialEventsValues.OnJob,
                JobCancelled = data.SpecialEventsValues.JobCancelled,
                JobDelivered = data.SpecialEventsValues.JobDelivered,
                Fined = data.SpecialEventsValues.Fined,
                Tollgate = data.SpecialEventsValues.Tollgate,
                Ferry = data.SpecialEventsValues.Ferry,
                Train = data.SpecialEventsValues.Train,
            },
            GamePlayEvents = new GamePlayEvents
            {
                FerryData = new TransportEvent
                {
                    PayAmount = data.GamePlay.FerryEvent.PayAmount,
                    SourceName = data.GamePlay.FerryEvent.SourceName,
                    TargetName = data.GamePlay.FerryEvent.TargetName,
                },
                FinedData = new FinedEvent
                {
                    PayAmount = data.GamePlay.FinedEvent.Amount,
                    Offence = data.GamePlay.FinedEvent.Offence.ToString(),
                },
                JobCancelledPenalty = data.GamePlay.JobCancelled.Penalty,
                JobDelivered = new Delivered
                {
                    AutoLoaded = data.GamePlay.JobDelivered.AutoLoaded,
                    AutoParker = data.GamePlay.JobDelivered.AutoParked,
                    CargoDamage = data.GamePlay.JobDelivered.CargoDamage,
                    DeliveryTime = data.GamePlay.JobDelivered.DeliveryTime.Date,
                    DistanceKm = data.GamePlay.JobDelivered.DistanceKm,
                    EarnedXp = data.GamePlay.JobDelivered.EarnedXp,
                    Revenue = data.GamePlay.JobDelivered.Revenue,
                },
                // TrainData / TollgatePayment are intentionally left at their
                // defaults: the shipped bridge's TelemetryManager never set
                // them either, so every existing field stays byte-identical
                // and only remainingDeliveryMinutes is added.
            },
        };

        var json = JsonSerializer.Serialize(
            packet,
            TelemetryJsonContext.Default.TelemetryPacket
        );

        _wsService.Broadcast(json);
        _lastUpdate = DateTime.Now;
    }
}
