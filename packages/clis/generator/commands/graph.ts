import { distance, type Position } from '@truckermudgeon/base/geom';
import { calculateLaneInfo, toMapPosition } from '@truckermudgeon/map/prefabs';
import fs from 'fs';
import path from 'path';
import type { Argv, BuilderArguments } from 'yargs';
import { checkGraph } from '../graph/check-graph';
import { toDemoGraph } from '../graph/demo-graph';
import { generateGraph, rotateRight } from '../graph/graph';
import { logger } from '../logger';
import { readMapData } from '../mapped-data';
import { maybeEnsureOutputDir, untildify } from './path-helpers';

export const command = 'graph';
export const describe =
  'Generates achievements.geojson from map-parser JSON files';

export const builder = (yargs: Argv) =>
  yargs
    .option('map', {
      alias: 'm',
      describe: 'Source map. Can only specify one.',
      choices: ['usa', 'europe'] as const,
      default: 'usa' as 'usa' | 'europe',
      defaultDescription: 'usa',
    })
    .option('inputDir', {
      alias: 'i',
      describe: 'Path to dir containing parser-generated JSON files',
      type: 'string',
      coerce: untildify,
      demandOption: true,
    })
    .option('outputDir', {
      alias: 'o',
      describe: 'Path to dir graph.json file should be written to',
      type: 'string',
      coerce: untildify,
      demandOption: true,
    })
    .option('check', {
      alias: 'c',
      describe: 'Run a simple validity check on the generated graph',
      type: 'boolean',
      default: false,
    })
    .option('demo', {
      alias: 'd',
      describe: 'Output a graph.json tailored for the demo-app',
      type: 'boolean',
      default: false,
    })
    .option('dryRun', {
      describe: "Don't write out any files.",
      type: 'boolean',
      default: false,
    })
    .check(maybeEnsureOutputDir)
    .check(argv => {
      if (Array.isArray(argv.map)) {
        throw new Error('Only one "map" option can be specified.');
      }
      return true;
    });

export async function handler(args: BuilderArguments<typeof builder>) {
  // TODO read only the files necessary
  const tsMapData = readMapData(args.inputDir, args.map, {
    includeHidden: false,
  });

  const graph = generateGraph(tsMapData);
  if (args.check) {
    await checkGraph(graph, tsMapData);
  }

  if (!args.dryRun) {
    if (args.demo) {
      fs.writeFileSync(
        path.join(args.outputDir, `${args.map}-graph-demo.json`),
        JSON.stringify(toDemoGraph(graph, tsMapData)),
      );
    } else {
      fs.writeFileSync(
        path.join(args.outputDir, `${args.map}-graph.json`),
        JSON.stringify([...graph.entries()], null, 2),
      );
      fs.writeFileSync(
        path.join(args.outputDir, `${args.map}-routing-nodes.json`),
        JSON.stringify(toRoutingNodes(graph, tsMapData)),
      );
      fs.writeFileSync(
        path.join(args.outputDir, `${args.map}-routing-prefab-curves.json`),
        JSON.stringify(toRoutingPrefabCurves(graph, tsMapData)),
      );
    }
  }
  logger.success('done.');
}

/**
 * The positions and headings of every node referenced by the graph, for the
 * united-convoys/router service. Graph keys and neighbor ids are hex uids, the
 * same keys used by `tsMapData.nodes`.
 */
function toRoutingNodes(
  graph: ReturnType<typeof generateGraph>,
  tsMapData: ReturnType<typeof readMapData>,
) {
  const ids = new Set<string>();
  for (const [id, neighbors] of graph) {
    ids.add(id);
    for (const n of [...neighbors.forward, ...neighbors.backward]) {
      ids.add(n.nodeId);
    }
  }

  const round = (v: number) => Math.round(v * 1000) / 1000;
  const nodes = [];
  for (const id of ids) {
    const node = tsMapData.nodes.get(id);
    if (!node) {
      continue;
    }
    nodes.push({
      uid: id,
      x: round(node.x),
      y: round(node.y),
      z: round(node.z),
      rotation: round(node.rotation),
    });
  }
  logger.info(`${nodes.length} routing nodes`);
  return nodes;
}

/**
 * The path through a prefab for every graph edge that crosses one, keyed by
 * `${fromNodeUid}-${toNodeUid}`, in map space.
 *
 * The graph connects a prefab's entry node straight to its exit node, so
 * without these curves a route through a roundabout or junction can only be
 * drawn as a guess between the two nodes. When several lanes connect the same
 * nodes, the shortest is kept.
 */
function toRoutingPrefabCurves(
  graph: ReturnType<typeof generateGraph>,
  tsMapData: ReturnType<typeof readMapData>,
): Record<string, Position[]> {
  const { nodes, prefabs, prefabDescriptions } = tsMapData;

  const edgeKeys = new Set<string>();
  for (const [id, neighbors] of graph) {
    for (const n of [...neighbors.forward, ...neighbors.backward]) {
      edgeKeys.add(`${id}-${n.nodeId}`);
    }
  }

  const round = (v: number) => Math.round(v * 100) / 100;
  const lengthOf = (points: Position[]) =>
    points.reduce(
      (sum, p, i) => (i === 0 ? 0 : sum + distance(points[i - 1], p)),
      0,
    );

  const laneInfoByToken = new Map<
    string,
    ReturnType<typeof calculateLaneInfo> | null
  >();
  const curves: Record<string, Position[]> = {};
  let failedPrefabs = 0;

  for (const prefab of prefabs.values()) {
    const desc = prefabDescriptions.get(prefab.token);
    if (!desc) {
      continue;
    }
    if (!laneInfoByToken.has(prefab.token)) {
      try {
        laneInfoByToken.set(prefab.token, calculateLaneInfo(desc));
      } catch {
        laneInfoByToken.set(prefab.token, null);
      }
    }
    const laneInfo = laneInfoByToken.get(prefab.token);
    if (!laneInfo) {
      failedPrefabs++;
      continue;
    }

    // Same mapping from prefab description node index to item node as
    // `convertToNodeMap` in graph.ts.
    const nodeUids = rotateRight(
      prefab.nodeUids.map(id => id.toString(16)),
      prefab.originNodeIndex,
    );
    const tx = (pos: Position) => toMapPosition(pos, prefab, desc, nodes);

    for (const [fromIndex, lanes] of laneInfo) {
      const fromUid = nodeUids[fromIndex];
      if (fromUid === undefined) {
        continue;
      }
      for (const lane of lanes) {
        for (const branch of lane.branches) {
          const toUid = nodeUids[branch.targetNodeIndex];
          const key = `${fromUid}-${toUid}`;
          if (toUid === undefined || !edgeKeys.has(key)) {
            continue;
          }
          const points = branch.curvePoints.map(p => {
            const [x, y] = tx(p);
            return [round(x), round(y)] as Position;
          });
          if (!curves[key] || lengthOf(points) < lengthOf(curves[key])) {
            curves[key] = points;
          }
        }
      }
    }
  }

  logger.info(
    `${Object.keys(curves).length} prefab curves (${failedPrefabs} prefab items without lane info)`,
  );
  return curves;
}
