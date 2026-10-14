import { featureCollection, point } from '@turf/helpers';
import { createNormalizeFeature } from './normalize';

/**
 * Elevation nodes as GeoJSON points with their exact `height` (game Y), so
 * clients can triangulate them and interpolate heights between nodes instead
 * of being limited to the contours' 1-unit steps.
 */
export function convertToElevationGeoJson({
  map,
  points,
}: {
  map: 'usa' | 'europe';
  points: [number, number, number][];
}) {
  // 6 decimal points (~0.1m) so the projection doesn't add noise between
  // nearby nodes; tippecanoe quantizes to tile pixels anyway.
  const normalizeCoordinates = createNormalizeFeature(map, 6);
  return featureCollection(
    points.map(([x, y, height]) =>
      normalizeCoordinates(point([x, y], { height })),
    ),
  );
}
