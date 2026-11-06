import { calculateLaneInfo } from '@truckermudgeon/map/prefabs';
import type { PrefabDescription } from '@truckermudgeon/map/types';
import { shortestPrefabCurvePaths } from '../prefab-curve-paths';

type Point = [number, number];

/** A straight nav curve from `a` to `b`. */
function curve(a: Point, b: Point, nextLines: number[], prevLines: number[]) {
  const rotation = Math.atan2(b[1] - a[1], b[0] - a[0]);
  const end = (p: Point) => ({
    x: p[0],
    y: p[1],
    z: 0,
    rotation,
    rotationQuat: [0, 0, 0, 1] as [number, number, number, number],
  });
  return {
    navNodeIndex: -1,
    start: end(a),
    end: end(b),
    nextLines,
    prevLines,
  };
}

// A two-lane roundabout. The outer ring runs A→B→C→D→A, the inner ring
// a→b→c→d→a. Entering at A, the first exit leaves at C.
//
//  D(0,20) ←──── C(20,20) ──→ exit (30,20)
//    │  d ←── c   ↑
//    ↓  ↓     ↑   │
//    │  a ──→ b   │
//  A(0,0)  ──→  B(20,0)
//    ↑
//  entry (0,-10)
//
// Curve 1 (A→B) lists the lane change into the inner ring before staying in
// the outer lane, so a depth-first walk goes round the inner ring first.
const [A, B, C, D]: Point[] = [
  [0, 0],
  [20, 0],
  [20, 20],
  [0, 20],
];
const [a, b, c, d]: Point[] = [
  [5, 5],
  [15, 5],
  [15, 15],
  [5, 15],
];
const navCurves = [
  /* 0 entry   */ curve([0, -10], A, [1], []),
  /* 1 A→B     */ curve(A, B, [6, 2], [0, 4]),
  /* 2 B→C     */ curve(B, C, [10, 3], [1, 9]),
  /* 3 C→D     */ curve(C, D, [4], [2]),
  /* 4 D→A     */ curve(D, A, [1], [3]),
  /* 5 a→b     */ curve(a, b, [6], [8]),
  /* 6 b→c     */ curve(b, c, [7], [1, 5]),
  /* 7 c→d     */ curve(c, d, [8], [6]),
  /* 8 d→a     */ curve(d, a, [5, 9], [7]),
  /* 9 a→B     */ curve(a, B, [2], [8]),
  /* 10 exit   */ curve(C, [30, 20], [], [2]),
];
const roundabout = {
  nodes: [
    {
      x: 0,
      y: -10,
      z: 0,
      rotation: 0,
      rotationDir: [0, 0, 0],
      inputLanes: [0],
      outputLanes: [],
    },
    {
      x: 30,
      y: 20,
      z: 0,
      rotation: 0,
      rotationDir: [0, 0, 0],
      inputLanes: [],
      outputLanes: [10],
    },
  ],
  mapPoints: [],
  spawnPoints: [],
  triggerPoints: [],
  navCurves,
  semaphores: [],
  navNodes: [],
} as unknown as PrefabDescription;

const length = (points: Point[]) =>
  points.reduce(
    (sum, p, i) =>
      i === 0
        ? 0
        : sum + Math.hypot(p[0] - points[i - 1][0], p[1] - points[i - 1][1]),
    0,
  );

describe('shortestPrefabCurvePaths', () => {
  it('documents that calculateLaneInfo can return a lap of the roundabout', () => {
    const [lane] = assertDefined(calculateLaneInfo(roundabout).get(0));
    const branch = assertDefined(
      lane.branches.find(br => br.targetNodeIndex === 1),
    );
    // Entry, the inner ring and back out, then the exit: far longer than the
    // 60m direct path.
    expect(length(branch.curvePoints)).toBeGreaterThan(80);
  });

  it('follows the shortest path through the nav curves', () => {
    const paths = shortestPrefabCurvePaths(roundabout);
    const path = assertDefined(
      paths.find(p => p.fromNodeIndex === 0 && p.toNodeIndex === 1),
    );

    // entry 10m + A→B 20m + B→C 20m + exit 10m
    expect(path.length).toBeCloseTo(60, 5);
    expect(length(path.points as Point[])).toBeCloseTo(60, 5);
    expect(path.points[0]).toEqual([0, -10]);
    expect(path.points[path.points.length - 1]).toEqual([30, 20]);
    // Never enters the inner ring.
    expect(
      path.points.some(([x, y]) => x > 1 && x < 19 && y > 1 && y < 19),
    ).toBe(false);
  });

  it('returns one path per pair of connected nodes', () => {
    const paths = shortestPrefabCurvePaths(roundabout);
    expect(paths.map(p => [p.fromNodeIndex, p.toNodeIndex])).toEqual([[0, 1]]);
  });
});

function assertDefined<T>(value: T | undefined): T {
  expect(value).toBeDefined();
  return value as T;
}
