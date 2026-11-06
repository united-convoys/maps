import fs from 'fs';
import path from 'path';
import type { Argv, BuilderArguments } from 'yargs';
import { checkGraph } from '../graph/check-graph';
import { toDemoGraph } from '../graph/demo-graph';
import { generateGraph } from '../graph/graph';
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
