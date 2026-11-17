import { ref } from "vue";
import RBush from "rbush";
import { loadGraph } from "~/assets/utils/routing/clientGraph";
import type { NodeIndexItem } from "~/types";
import { getSquaredDist } from "~/assets/utils/map/maths";
import {
    buildGraphIndex,
    NeighborIndex,
    NodeCoordIndex,
} from "~/assets/utils/routing/graphIndex";

const loading = ref(true);
const progress = ref(0);

export function useGraphSystem() {
    // The display thread's view of the graph: neighbour ids and node
    // positions over typed arrays (see graphIndex.ts). The routing worker
    // owns the full per-edge data and builds its own adjacency from the
    // same buffers, so the heavy object graph exists exactly once — and
    // this side never allocates per-edge objects at startup again.
    const adjacency = new NeighborIndex();
    const nodeCoords = new NodeCoordIndex();
    const nodeTree = new RBush<NodeIndexItem>();

    let workerNodesCoordsBuffer: ArrayBuffer | null = null;
    let workerGraphBuffer: ArrayBuffer | null = null;
    let workerGeometryBuffer: ArrayBuffer | null = null;

    const sleep = (ms: number) =>
        new Promise((resolve) => setTimeout(resolve, ms));

    function getClosestNodes(
        target: [number, number],
        limit = 5,
        radiusDeg = 0.02,
    ): number[] {
        const candidates = nodeTree.search({
            minX: target[0] - radiusDeg,
            minY: target[1] - radiusDeg,
            maxX: target[0] + radiusDeg,
            maxY: target[1] + radiusDeg,
        });

        if (candidates.length === 0) return [];

        return candidates
            .map((item) => ({
                id: item.id,
                dist: getSquaredDist(target, item.coord),
            }))
            .sort((a, b) => a.dist - b.dist)
            .slice(0, limit)
            .map((c) => c.id);
    }

    const initializeGraphData = async () => {
        loading.value = true;
        progress.value = 0;

        try {
            const { graphBuffer, geometryBuffer } = await loadGraph();

            workerGraphBuffer = graphBuffer;
            workerGeometryBuffer = geometryBuffer;

            adjacency.adopt(null);
            nodeCoords.adopt(null);
            nodeTree.clear();

            // Typed three-pass scan: milliseconds even on 100k+ edges, no
            // per-edge heap objects, so no startup freeze to choreograph.
            const index = buildGraphIndex(
                new Float32Array(graphBuffer),
                new Float32Array(geometryBuffer),
            );

            // The worker receives its own copy: the buffer is transferred
            // (neutered) on postMessage, while nodeCoords/adjacency keep
            // reading this one for the whole session.
            const workerCoords = index.coords.slice();
            workerNodesCoordsBuffer = workerCoords.buffer as ArrayBuffer;

            // The rbush items are the one remaining O(nodes) object pass;
            // let the paint flush before it so the loading UI settles.
            await sleep(0);
            progress.value = 60;

            const items: NodeIndexItem[] = [];
            for (let id = 0; id <= index.maxNodeId; id++) {
                const lng = index.coords[id * 2]!;
                const lat = index.coords[id * 2 + 1]!;
                if (lng === 0 && lat === 0) continue; // absent node / hole
                items.push({
                    minX: lng,
                    minY: lat,
                    maxX: lng,
                    maxY: lat,
                    id,
                    coord: [lng, lat],
                });
            }

            nodeTree.load(items);
            adjacency.adopt(index);
            nodeCoords.adopt(index);

            progress.value = 100;
        } catch (err) {
            console.error("Loading Graph Failed", err);
        } finally {
            setTimeout(() => {
                loading.value = false;
            }, 500);
        }

        return {
            nodes: workerNodesCoordsBuffer,
            graphBuffer: workerGraphBuffer,
            geometryBuffer: workerGeometryBuffer,
        };
    };

    return {
        loading,
        progress,
        adjacency,
        nodeCoords,
        getClosestNodes,
        initializeGraphData,
    };
}
