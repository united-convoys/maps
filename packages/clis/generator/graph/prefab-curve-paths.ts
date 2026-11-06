import type { Position } from '@truckermudgeon/base/geom';
import { distance, toSplinePoints } from '@truckermudgeon/base/geom';
import type { PrefabDescription } from '@truckermudgeon/map/types';

export interface PrefabCurvePath {
  /** Index into the prefab description's `nodes` the path enters at. */
  fromNodeIndex: number;
  /** Index into the prefab description's `nodes` the path leaves at. */
  toNodeIndex: number;
  /** The path in prefab space. */
  points: Position[];
  length: number;
}

/**
 * The shortest drivable path through a prefab's nav curves for every pair of
 * nodes that a path connects, in prefab space.
 *
 * `calculateLaneInfo` follows nav curves depth-first and keeps the first path
 * it finds to each exit. On roundabouts with lane changes between rings that
 * first path can be a full lap, so this searches the curves with Dijkstra
 * instead.
 */
export function shortestPrefabCurvePaths(
  prefabDesc: PrefabDescription,
): PrefabCurvePath[] {
  const { navCurves, nodes } = prefabDesc;
  const curvePoints = navCurves.map(curve =>
    toSplinePoints(
      {
        position: [curve.start.x, curve.start.y],
        rotation: curve.start.rotation,
      },
      { position: [curve.end.x, curve.end.y], rotation: curve.end.rotation },
    ),
  );
  const curveLengths = curvePoints.map(polylineLength);

  const endingCurveToNodeIndex = new Map<number, number>();
  nodes.forEach((node, nodeIndex) => {
    for (const lane of node.outputLanes) {
      endingCurveToNodeIndex.set(lane, nodeIndex);
    }
  });

  const best = new Map<string, PrefabCurvePath>();
  nodes.forEach((node, fromNodeIndex) => {
    for (const inputLane of node.inputLanes) {
      const { cost, previous } = dijkstra(
        navCurves,
        curveLengths,
        endingCurveToNodeIndex,
        inputLane,
      );
      for (const [endingCurve, toNodeIndex] of endingCurveToNodeIndex) {
        const length = cost.get(endingCurve);
        if (length === undefined) {
          continue;
        }
        const key = `${fromNodeIndex}-${toNodeIndex}`;
        const existing = best.get(key);
        if (existing && existing.length <= length) {
          continue;
        }
        const curves: number[] = [];
        for (
          let c: number | undefined = endingCurve;
          c !== undefined;
          c = previous.get(c)
        ) {
          curves.unshift(c);
        }
        best.set(key, {
          fromNodeIndex,
          toNodeIndex,
          points: joinCurves(curves.map(c => curvePoints[c])),
          length,
        });
      }
    }
  });
  return [...best.values()];
}

/**
 * Costs (summed curve lengths, including the start curve) and predecessors of
 * every curve reachable from `start`. Exits end a path: curves that are some
 * node's output lane are not followed further, as in `calculateLaneInfo`.
 */
function dijkstra(
  navCurves: PrefabDescription['navCurves'],
  curveLengths: number[],
  endingCurves: ReadonlyMap<number, number>,
  start: number,
): { cost: Map<number, number>; previous: Map<number, number> } {
  const cost = new Map<number, number>([[start, curveLengths[start]]]);
  const previous = new Map<number, number>();
  const done = new Set<number>();

  // Prefabs have at most a few hundred curves, so a linear scan for the
  // cheapest open curve is fast enough.
  for (;;) {
    let current: number | undefined;
    for (const [curve, c] of cost) {
      if (
        !done.has(curve) &&
        (current === undefined || c < cost.get(current)!)
      ) {
        current = curve;
      }
    }
    if (current === undefined) {
      return { cost, previous };
    }
    done.add(current);
    if (endingCurves.has(current)) {
      continue;
    }
    for (const next of navCurves[current].nextLines) {
      const candidate = cost.get(current)! + curveLengths[next];
      if (candidate < (cost.get(next) ?? Infinity)) {
        cost.set(next, candidate);
        previous.set(next, current);
      }
    }
  }
}

function joinCurves(curves: Position[][]): Position[] {
  const points: Position[] = [];
  for (const curve of curves) {
    for (const p of curve) {
      const last = points[points.length - 1];
      if (!last || distance(last, p) > 1e-6) {
        points.push(p);
      }
    }
  }
  return points;
}

function polylineLength(points: Position[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += distance(points[i - 1], points[i]);
  }
  return total;
}
