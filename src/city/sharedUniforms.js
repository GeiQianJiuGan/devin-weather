import { Color, Matrix4 } from 'three';

// Uniform objects shared (by reference) between all exterior materials, so the
// lighting / weather systems only have to write each value once per frame.
export const ext = {
  uTime: { value: 0 },
  uWet: { value: 0 },
  uSnow: { value: 0 },
  uRain: { value: 0 },
  uReflTex: { value: null },
  uReflMatrix: { value: new Matrix4() },
  uReflOn: { value: 0 },
  uCityLights: { value: 0 },
  uWindowGain: { value: 1.6 },
  uSkyRefl: { value: new Color(0.3, 0.4, 0.5) },
  uHeadOn: { value: 0 },
  uTailOn: { value: 0 },
  uBlink: { value: 0 },
  uFogDensity: { value: 0.001 },
  uWind: { value: 0.3 },
};