// Choosing how a PMTiles archive reaches the pmtiles library.
//
// Whole-blob loading (fetch + response.blob()) was the only mode, which put
// every archive — a multi-hundred-MB combined tile file included — fully in
// RAM and made boot wait for the whole transfer. pmtiles can also stream by
// HTTP byte ranges (FetchSource), reading just the header and the directory
// nodes each tile lookup needs, with the browser's HTTP cache in front. That
// only works where the file server seeks ranges honestly: Express static on
// desktop does, while the Capacitor WebView server on Android answers every
// range with a 206 whose body restarts the file from byte 0 — which would
// silently corrupt every mid-file read. So probe before switching: fetch the
// archive's head, then refetch a short range from inside it and demand the
// bytes come back identical, which only a seeking server produces. Anything
// else falls back to the blob path, which works everywhere. The status and
// size headers are checked before touching bodies, so a server that would
// dump the whole archive gets discarded unread.

import { FetchSource } from "pmtiles";

export const PMTILES_MAGIC = 19792; // "PM" at offset 0 of the spec header
const HEAD_BYTES = 16384; // pmtiles' own header read is getBytes(0, 16384)
const PROBE_OFFSET = 512; // inside the head, past header noise
const PROBE_LEN = 16;

export type PmtilesAttachment =
    | { mode: "range"; url: string }
    | { mode: "blob"; blob: Blob };

/**
 * PMTiles Source for a range-served archive, under the key the maplibre
 * protocol was registered with (FetchSource keys itself by URL, but the
 * style references the archive by name).
 */
export function rangeSource(url: string, key: string) {
    const source = new FetchSource(url);
    return {
        getBytes: (
            offset: number,
            length: number,
            signal?: AbortSignal,
            etag?: string,
        ) => source.getBytes(offset, length, signal, etag),
        getKey: () => key,
    };
}

/**
 * Resolves how to attach the archive at `url`: byte-range streaming when the
 * server proves it seeks ranges, a whole blob otherwise, `null` when the
 * file cannot be read at all (missing, or the server down). `fetchImpl` is
 * injectable for tests.
 */
export async function probePmtilesArchive(
    url: string,
    fetchImpl: typeof fetch = globalThis.fetch,
): Promise<PmtilesAttachment | null> {
    try {
        const head = await fetchImpl(url, {
            headers: { range: `bytes=0-${HEAD_BYTES - 1}` },
        });
        if (
            head.status === 206 &&
            head.headers.get("Content-Length") === String(HEAD_BYTES)
        ) {
            const headBuf = await head.arrayBuffer();
            if (
                new DataView(headBuf).getUint16(0, true) === PMTILES_MAGIC
            ) {
                // The head came back. Now prove the server seeks rather than
                // restarting the file per range: refetch a short slice from
                // inside the head and demand the same bytes back, which only
                // a real seek produces. The length header is checked before
                // the body is read, so a server that would dump the whole
                // archive gets discarded unread.
                const mid = await fetchImpl(url, {
                    headers: {
                        range: `bytes=${PROBE_OFFSET}-${PROBE_OFFSET + PROBE_LEN - 1}`,
                    },
                });
                if (
                    mid.status === 206 &&
                    mid.headers.get("Content-Length") === String(PROBE_LEN)
                ) {
                    const midBuf = new Uint8Array(await mid.arrayBuffer());
                    const headBytes = new Uint8Array(headBuf);
                    const seeking =
                        midBuf.length === PROBE_LEN &&
                        midBuf.every(
                            (byte, i) => byte === headBytes[PROBE_OFFSET + i]!,
                        );
                    if (seeking) return { mode: "range", url };
                }
            }
        }
    } catch {
        // Range probing failed outright (unsupported request shape, offline
        // server…); the whole-file read below decides whether it exists.
    }

    try {
        const response = await fetchImpl(url);
        if (!response.ok) return null;
        return { mode: "blob", blob: await response.blob() };
    } catch {
        return null;
    }
}
