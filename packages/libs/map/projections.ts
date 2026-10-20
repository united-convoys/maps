import type { Position } from '@truckermudgeon/base/geom';
import * as proj4 from 'proj4';

const earthRadiusMeters = 6_370_997;
const lengthOfDegree = (earthRadiusMeters * Math.PI) / 180;

// from def/climate.sii
const atsDefData = {
  mapProjection: 'lambert_conic',
  standardParalel1: 33,
  standardParalel2: 45,
  mapOrigin: [39, -96],
  mapFactor: [-0.00017706234, 0.000176689948],
} as const;
const ats = [
  '+proj=lcc', // lambert conformal conic
  `+R=${earthRadiusMeters}`,
  `+lat_1=${atsDefData.standardParalel1}`,
  `+lat_2=${atsDefData.standardParalel2}`,
  `+lat_0=${atsDefData.mapOrigin[0]}`,
  `+lon_0=${atsDefData.mapOrigin[1]}`,
].join(' ');

const fromWgs84ToAtsConverter = proj4.default(ats);
export const fromAtsCoordsToWgs84 = ([x, y]: Position): Position => {
  // mapFactor is [y, x]; its negative y factor accounts for Y growing southward in ATS coords.
  const lccCoords: Position = [
    x * atsDefData.mapFactor[1] * lengthOfDegree,
    y * atsDefData.mapFactor[0] * lengthOfDegree,
  ];
  return fromWgs84ToAtsConverter.inverse(lccCoords);
};

// from def/climate.sii
const ets2DefData = {
  mapProjection: 'lambert_conic',
  standardParalel1: 37,
  standardParalel2: 65,
  mapOrigin: [50, 15],
  mapOffset: [16660, 4150],
  mapFactor: [-0.000171570875, 0.0001729241463],
} as const;
const ets2 = [
  '+proj=lcc', // lambert conformal conic
  `+R=${earthRadiusMeters}`,
  `+lat_1=${ets2DefData.standardParalel1}`,
  `+lat_2=${ets2DefData.standardParalel2}`,
  `+lat_0=${ets2DefData.mapOrigin[0]}`,
  `+lon_0=${ets2DefData.mapOrigin[1]}`,
].join(' ');
const fromWgs84ToEts2Converter = proj4.default(ets2);

const sectorSize = 4000;
const ukScaleFactor = 0.75;
const calais = [-31100, -5500] as const;

export const fromEts2CoordsToWgs84 = ([x, y]: Position): Position => {
  // UK detection uses the sector indices of the raw (pre-offset) coords.
  const sx = Math.floor(x / sectorSize);
  const sy = Math.floor(y / sectorSize);
  const isUk = sx <= -8 && sy <= -2 && !(sx === -8 && sy === -2);

  // apply mapOffset to coords before projecting.
  x -= ets2DefData.mapOffset[0];
  y -= ets2DefData.mapOffset[1];
  // the UK is modeled at a smaller scale than the rest of the map.
  if (isUk) {
    x = (x + calais[0] / 2) * ukScaleFactor;
    y = (y + calais[1] / 2) * ukScaleFactor;
  }
  // mapFactor is [y, x]; its negative y factor accounts for Y growing southward in ETS2 coords.
  const lccCoords: Position = [
    x * ets2DefData.mapFactor[1] * lengthOfDegree,
    y * ets2DefData.mapFactor[0] * lengthOfDegree,
  ];
  return fromWgs84ToEts2Converter.inverse(lccCoords);
};
