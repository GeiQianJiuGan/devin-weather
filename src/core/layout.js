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

// The cafe occupies the first floor above the shops of the south-west block.
// Its glass corner is the building corner closest to the intersection.
export const FLOOR_Y = 3.1;
export const ROOM = {
  w: 8.4, // extent along -X from the east glass
  d: 7.0, // extent along +Z from the north glass
  h: 3.4,
  glassNorth: 6.6, // glazed length of the north wall, starting at the corner
  glassEast: 5.0, // glazed length of the east wall, starting at the corner
  glassY0: 0.06,
  glassY1: 3.0,
};
export const ROOM_ORIGIN = new Vector3(-BUILD_LINE, FLOOR_Y, BUILD_LINE);

export const CAMERA = {
  // room-local position (x: 0 at the east glass, z: 0 at the north glass)
  // standing height, a few steps back from the window table for two
  position: new Vector3(-3.15, 1.52, 3.25),
  // world-space look-at target: the shop fronts across the avenue, seen from above
  target: new Vector3(-12.6, 2.3, -11),
  fov: 52,
};
