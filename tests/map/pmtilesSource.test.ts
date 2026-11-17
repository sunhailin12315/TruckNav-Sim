// The archive is 64 KiB; byte i of content is i % 251, so every offset has a
// distinct byte and slice comparisons between offsets never alias.
import { describe, expect, it } from "vitest";
import {
    PMTILES_MAGIC,
    probePmtilesArchive,
} from "~/assets/utils/map/pmtilesSource";

const FILE_LEN = 65536;

function archiveByte(i: number) {
    return i % 251;
}

function fullArchive(): Uint8Array {
    const out = new Uint8Array(FILE_LEN);
    for (let i = 0; i < FILE_LEN; i++) out[i] = archiveByte(i);
    // PMTiles magic at offset 0, little-endian "PM".
    out[0] = PMTILES_MAGIC & 0xff;
    out[1] = (PMTILES_MAGIC >> 8) & 0xff;
    return out;
}

type Server = (url: string, init?: RequestInit) => Promise<Response>;

function responding(status: number, body: Uint8Array, headers: HeadersInit) {
    return new Response(body, { status, headers });
}

// Express static / spec-honest server.
const seekingServer: Server = async (_url, init) => {
    const file = fullArchive();
    const range = (init?.headers as Record<string, string>)?.range;
    if (range) {
        const [, a, b] = range.match(/bytes=(\d+)-(\d+)/)!;
        const start = Number(a);
        const end = Math.min(Number(b), FILE_LEN - 1);
        const slice = file.slice(start, end + 1);
        return responding(
            206,
            slice,
            new Headers({ "Content-Length": String(slice.byteLength) }),
        );
    }
    return responding(
        200,
        file,
        new Headers({ "Content-Length": String(FILE_LEN) }),
    );
};

// Capacitor WebView's broken behavior: every Range answered 206 but with the
// body restarting from byte 0.
const fakeRangeServer: Server = async (_url, init) => {
    const file = fullArchive();
    const range = (init?.headers as Record<string, string>)?.range;
    if (range) {
        const [, a, b] = range.match(/bytes=(\d+)-(\d+)/)!;
        const start = Number(a);
        const end = Math.min(Number(b), FILE_LEN - 1);
        // Headers claim the requested window…
        const headers = new Headers({
            "Content-Length": String(end - start + 1),
        });
        // …but the stream restarts at 0 (available() from the file head).
        return responding(206, file.slice(0, end - start + 1), headers);
    }
    return responding(
        200,
        file,
        new Headers({ "Content-Length": String(FILE_LEN) }),
    );
};

// Server that ignores Range entirely and always answers 200 with the file.
const plainServer: Server = async () => {
    const file = fullArchive();
    return responding(
        200,
        file,
        new Headers({ "Content-Length": String(FILE_LEN) }),
    );
};

// 404 everything: the archive isn't there.
const missingServer: Server = async () =>
    new Response(null, { status: 404 });

function fetchFrom(server: Server): typeof fetch {
    return ((input: any, init?: any) =>
        server(String(input), init)) as typeof fetch;
}

describe("probePmtilesArchive", () => {
    it("switches to range streaming on a seeking server", async () => {
        const got = await probePmtilesArchive(
            "http://127.0.0.1:8628/maps/ets2/a.mp3",
            fetchFrom(seekingServer),
        );
        expect(got?.mode).toBe("range");
    });

    it("rejects a server that fakes ranges by restarting the body", async () => {
        const got = await probePmtilesArchive(
            "https://localhost/a.mp3",
            fetchFrom(fakeRangeServer),
        );
        expect(got?.mode).toBe("blob");
        if (got?.mode === "blob") {
            expect(got.blob.size).toBe(FILE_LEN);
        }
    });

    it("falls back to the blob on a server without byte serving", async () => {
        const got = await probePmtilesArchive(
            "http://127.0.0.1:8628/a.mp3",
            fetchFrom(plainServer),
        );
        expect(got?.mode).toBe("blob");
    });

    it("reports a missing archive as null", async () => {
        const got = await probePmtilesArchive(
            "http://127.0.0.1:8628/none.mp3",
            fetchFrom(missingServer),
        );
        expect(got).toBeNull();
    });

    it("survives a server that throws on the probe", async () => {
        const throwingProbe: Server = async (_url, init) => {
            if ((init?.headers as Record<string, string>)?.range)
                throw new Error("connection reset");
            return seekingServer(_url);
        };
        const got = await probePmtilesArchive(
            "http://127.0.0.1:8628/a.mp3",
            fetchFrom(throwingProbe),
        );
        expect(got?.mode).toBe("blob");
    });

    it("rejects a non-PMTiles archive served as 206", async () => {
        const wrongMagic: Server = async (_url, init) => {
            const range = (init?.headers as Record<string, string>)?.range;
            const body = new Uint8Array(range ? 16384 : 1000); // no PM magic
            return responding(
                range ? 206 : 200,
                body,
                new Headers({ "Content-Length": String(body.byteLength) }),
            );
        };
        const got = await probePmtilesArchive(
            "http://127.0.0.1:8628/broken.mp3",
            fetchFrom(wrongMagic),
        );
        // Not a PMTiles head → blob path, where the library reports the real
        // format error rather than streaming garbage as if it were valid.
        expect(got?.mode).toBe("blob");
    });
});
