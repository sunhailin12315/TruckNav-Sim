using System;
using System.Text.Json;
using SCSSdkClient;
using TruckNavTelemetry;

// Smoke test A: craft a 32 KiB shared-memory image with known values and
// verify the vendored parser + serializer produce the expected JSON, with
// remainingDeliveryMinutes carrying the sign.
class Program
{
    static void WriteU32(byte[] b, int off, uint v)
    {
        b[off] = (byte)v; b[off + 1] = (byte)(v >> 8);
        b[off + 2] = (byte)(v >> 16); b[off + 3] = (byte)(v >> 24);
    }

    static void WriteStr(byte[] b, int off, string s)
    {
        var bytes = System.Text.Encoding.UTF8.GetBytes(s);
        Array.Copy(bytes, 0, b, off, Math.Min(bytes.Length, 63));
    }

    static void Main()
    {
        var data = new byte[32 * 1024];
        // FIRST ZONE @0: SdkActive=1, 3 bools, Paused=1, 3 bools, 3 u64, i64
        data[0] = 1; data[4] = 1;
        var conv = new SCSSdkClient.SCSSdkConvert();

        // SECOND ZONE @40 (offsets after alignment happen inside Get*).
        // Walk the same read order the parser uses so we can plant values.
        int off = 40;
        int Skip(int n) { while (off % 4 != 0) off++; var r = off; off += n; return r; }
        // DllVersion, GameVer major/minor, Game, TelemVer major/minor
        Skip(4); Skip(4); Skip(4);
        int oGame = Skip(4);
        Skip(4); Skip(4);
        int oGameTime = Skip(4);   // CommonValues.GameTime
        Skip(4); Skip(4); Skip(4); Skip(4); Skip(4);
        int oDelivery = Skip(4);   // SetDeliveryTime(time_abs_delivery)
        Skip(4); Skip(4); Skip(4);
        // current uints
        Skip(4); Skip(4); Skip(4); Skip(4); Skip(16 * 4);
        Skip(32 * 4); Skip(32 * 4);
        Skip(4);                     // JobDelivered.DeliveryTime
        Skip(4); Skip(4);            // started/finished
        // THIRD ZONE @500: NextRestStop int
        off = 500; Skip(4);
        Skip(4); Skip(4); Skip(32 * 4); Skip(4);
        // 4TH ZONE @700: Scale float (index 0)
        off = 700;
        int oScale = Skip(4);
        // ... to 12TH ZONE @4300: OnJob bool sequence
        off = 4300; data[off] = 1;   // OnJob = true
        // 9TH ZONE strings @4000: brandId,brand,id,name,cargo id,name, cityDestId, cityDest, ...
        off = 4000;
        string[] strs = { "eu.man", "MAN", "truck_euro6", "Euro 6", "cargo_steel",
            "Steel Coils", "paris", "Paris", "agriloop", "Agriloop", "berlin", "Berlin",
            "spedition", "Spedition" };
        foreach (var s in strs) { WriteStr(data, off, s); off += 64; }
        // shifter(16), plate(64*3), market(32), offence(32)
        off += 16; off += 64; off += 64; off += 64;
        WriteStr(data, off, "quick_job"); off += 32;
        off += 32;
        // ferry source/target/sourceid/targetid, train x4
        for (int i = 0; i < 8; i++) off += 64;

        // Values: game=Ets2(1), gameTime=day8 21:09 (12489*1440? use minutes), 
        WriteU32(data, oGame, 1);
        uint gameAbs = 8u * 24 * 60 + 21 * 60 + 9; // 12489 min into the save
        uint deadline = gameAbs + 660;              // 11h left
        WriteU32(data, oGameTime, gameAbs);
        WriteU32(data, oDelivery, deadline);
        // scale: float 19.0 at oScale
        BitConverter.GetBytes(19.0f).CopyTo(data, oScale);

        var sdk = conv.Convert(data);
        Console.WriteLine($"parsed: game={sdk.Game} gameMin={sdk.CommonValues.GameTime.Value} " +
            $"remainingSigned={sdk.JobValues.RemainingDeliveryTime.Value} " +
            $"remainingDate={sdk.JobValues.RemainingDeliveryTime.Date:O} " +
            $"onJob={sdk.SpecialEventsValues.OnJob} cityDest={sdk.JobValues.CityDestination} " +
            $"market={sdk.JobValues.Market} scale={sdk.CommonValues.Scale}");

        // Now build the packet the manager would emit and serialize it.
        var packet = new TelemetryPacket
        {
            Game = sdk.Game.ToString(),
            Common = new CommonData
            {
                MapScale = sdk.CommonValues.Scale,
                GameTime = sdk.CommonValues.GameTime.Date,
            },
            Job = new JobData
            {
                RemainingDeliveryTime = sdk.JobValues.RemainingDeliveryTime.Date,
                RemainingDeliveryMinutes = sdk.JobValues.RemainingDeliveryTime.Value,
                CityDestination = sdk.JobValues.CityDestination,
                JobType = sdk.JobValues.Market.ToString(),
            },
        };
        var json = JsonSerializer.Serialize(packet, TelemetryJsonContext.Default.TelemetryPacket);
        Console.WriteLine(json);

        // Overdue scenario: deadline 30 min in the past -> Date must be +30
        // (abs) while Minutes must be -30.
        WriteU32(data, oDelivery, gameAbs - 30);
        var sdk2 = conv.Convert(data);
        Console.WriteLine($"overdue: signed={sdk2.JobValues.RemainingDeliveryTime.Value} " +
            $"date={sdk2.JobValues.RemainingDeliveryTime.Date:O}");
    }
}
