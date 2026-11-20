import { Vector3 } from 'three';

// World layout, in metres. The intersection centre is the world origin; the
// avenue runs along X and the cross street along Z. "North" is -Z.

export const LANE_W = 3.5;
export const ROAD_HALF = 7; // two lanes per direction
export const SIDEWALK_W = 4;
export const BUILD_LINE = ROAD_HALF + SIDEWALK_W;
export const CURB_H = 0.16;
export const CURB_RADIUS = 3;

export const CROSSWALK_NEAR = ROAD_HALF + 0.8;
export const CROSSWALK_FAR = ROAD_HALF + 3.8;
export const STOP_NEAR = ROAD_HALF + 4.6;
export const STOP_FAR = ROAD_HALF + 5.0;

/** Distance from the centre at which vehicles enter and leave the simulation. */
export const ROAD_LENGTH = 320;
export const GROUND_SIZE = 1400;

// The apartment sits on the first floor above the shops of the south-west
// block. Its glass corner is the building corner closest to the intersection.
export const FLOOR_Y = 3.1;
export const ROOM = {
  w: 5.6, // extent along -X from the east glass
  d: 4.2, // extent along +Z from the north glass
  h: 3.0,
  glassNorth: 5.1, // glazed length of the north wall, starting at the corner
  glassEast: 3.6, // glazed length of the east wall, starting at the corner
  glassY0: 0.08,
  glassY1: 2.82,
};
export const ROOM_ORIGIN = new Vector3(-BUILD_LINE, FLOOR_Y, BUILD_LINE);

export const CAMERA = {
  // room-local position (x: 0 at the east glass, z: 0 at the north glass)
  position: new Vector3(-3.7, 1.5, 2.85),
  // world-space look-at target (just above the middle of the intersection)
  target: new Vector3(0, 3.2, 0),
  fov: 50,
};