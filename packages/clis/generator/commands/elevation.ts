import { execSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { Argv, BuilderArguments } from 'yargs';
import { convertToElevationGeoJson } from '../geo-json/elevation';
import { logger } from '../logger';
import { readArrayFile } from '../read-array-file';
import { writeGeojsonFile } from '../write-geojson-file';
import { maybeEnsureOutputDir, untildify } from './path-helpers';

export const command = 'elevation';
export const describe =
  'Generates elevation point tiles (exact node heights) from map-parser JSON files';

export const builder = (yargs: Argv) =>
  yargs
    .option('map', {
      alias: 'm',
      describe:
        'Source map.\nSpecify multiple source maps with multiple -m arguments.',
      choices: ['usa', 'europe'] as const,
      default: ['usa'] as ('usa' | 'europe')[],
      defaultDescription: 'usa',
    })
    .option('inputDir', {
      alias: 'i',
      describe: 'Path to dir containing elevation.json files',
      type: 'string',
      coerce: untildify,
      demandOption: true,
    })
    .option('outputDir', {
      alias: 'o',
      describe: 'Path to dir output GeoJSON should be written to',
      type: 'string',
      coerce: untildify,
      demandOption: true,
    })
    .option('type', {
      alias: 't',
      describe:
        'Type of files to write.\nSpecify multiple types with multiple -t arguments.',
      choices: ['pmtiles', 'geojson'] as const,
      default: ['pmtiles'] as ('pmtiles' | 'geojson')[],
      defaultDescription: 'pmtiles',
    })
    .option('dryRun', {
      describe: "Don't write out any files.",
      type: 'boolean',
      default: false,
    })
    .check(maybeEnsureOutputDir);

export function handler(args: BuilderArguments<typeof builder>) {
  const toJsonPath = (map: 'usa' | 'europe', suffix: string) =>
    path.join(args.inputDir, `${map}-${suffix}.json`);

  for (const map of [args.map].flat()) {
    const points = readArrayFile<[number, number, number]>(
      toJsonPath(map, 'elevation'),
    );
    const geoJson = convertToElevationGeoJson({ map, points });
    if (args.dryRun) {
      continue;
    }

    let geoJsonPath: string | undefined;
    const gamePrefix = map === 'usa' ? 'ats' : 'ets2';
    const geojsonFilename = `${gamePrefix}-elevation.geojson`;
    if (args.type.includes('geojson')) {
      geoJsonPath = path.join(args.outputDir, geojsonFilename);
      logger.log('writing', geoJsonPath + '...');
      writeGeojsonFile(geoJsonPath, geoJson);
    }
    if (!args.type.includes('pmtiles')) {
      continue;
    }

    let cleanupGeoJson = false;
    if (geoJsonPath == null) {
      geoJsonPath = path.join(os.tmpdir(), geojsonFilename);
      logger.log('writing temporary GeoJSON file...');
      writeGeojsonFile(geoJsonPath, geoJson);
      cleanupGeoJson = true;
    }

    const pmtilesFilename = `${gamePrefix}-elevation.pmtiles`;
    // write to tmp dir, in case webpack-dev-server is watching (we don't
    // want crazy reloads while the file is being written to)
    const tmpPmTilesPath = path.join(os.tmpdir(), pmtilesFilename);
    const tmpPmTilesLog = path.join(os.tmpdir(), `${pmtilesFilename}.log`);
    const cmd =
      // single zoom 9, matching the contours' max zoom: these tiles are only
      // queried for height lookups, never drawn.
      `tippecanoe -Z9 -z9 ` +
      '-y height ' +
      '-l elevation ' + // hardcoded layer name, common to both ats/ets2 files
      '-r1 ' + // keep every point (no dropping)
      '-d14 ' + // 16384 extent, so points keep ~1m precision
      '-b 32 ' + // wide buffer, so triangles near tile edges have neighbours
      '--no-feature-limit --no-tile-size-limit ' +
      `--force -o ${tmpPmTilesPath} ${geoJsonPath} ` +
      `> ${tmpPmTilesLog} 2>&1`;

    logger.log('running tippecanoe to generate pmtiles file...');
    logger.info('  ', cmd);
    execSync(cmd);
    logger.log(
      '\n',
      'tippecanoe output:\n',
      fs
        .readFileSync(tmpPmTilesLog, 'utf-8')
        .split('\n')
        .map(l => `  ${l}`)
        .join('\n'),
      '\n',
    );

    const pmTilesPath = path.join(args.outputDir, pmtilesFilename);
    fs.renameSync(tmpPmTilesPath, pmTilesPath);
    fs.rmSync(tmpPmTilesLog);
    if (cleanupGeoJson) {
      logger.log('deleting temporary GeoJSON files...');
      fs.rmSync(geoJsonPath);
    }
  }

  logger.success('done.');
}
