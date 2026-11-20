# Cinematic Weather Simulator

A real-time Three.js scene: a bedroom with a corner window overlooking a living city
intersection. Weather, weather intensity and time of day are configured by hand and
rendered entirely in the browser - no weather API, no video, no image assets.

## Run

```
npm install
npm run dev       # development server (default http://127.0.0.1:5173, next free port if taken)
npm run build     # production build in dist/
npm run preview   # serve the production build
```

Requires Node 20.19+ and a browser with WebGL 2.

## Controls

| Group | Controls |
| --- | --- |
| Weather | 10 presets, intensity, wind, exterior blur |
| Time of day | 6 presets, continuous time slider, automatic day/night cycle and its speed |
| Scene | rain on glass, traffic on/off and density, interior light, desk lamp, screen brightness |
| Playback and quality | pause/resume, reset, fullscreen, low/medium/high, frame-rate readout |
| Scene configuration | the whole state as JSON: copy it, edit it, apply it |

Keys: `Space` pause, `H` hide the panel, `F` fullscreen.
The configuration is saved in `localStorage` and restored on the next visit.
URL options: `?quality=low|medium|high`, `?autoquality=0` (disable automatic adaptation).

## How it is built

```
src/
  main.js                 bootstrap
  core/App.js             scene manager: renderer, both scenes, systems, frame loop
  core/Store.js           central, validated, serialisable state
  core/PerformanceManager.js  quality presets, FPS monitor, automatic adaptation
  core/layout.js          world dimensions, room and camera placement
  render/                 exterior HDR target, blur/halo pyramids, final grade
  sky/SkyDome.js          procedural sky, sun, moon, stars, clouds
  city/CityBuilder.js     ground, sidewalks, instanced buildings, signs
  city/BuildingMaterial.js  facades and lit windows generated in the shader
  city/GroundMaterial.js  asphalt, markings, wetness, puddle reflections, snow
  city/StreetFurniture.js streetlights, traffic signals, signs, trees
  city/Vehicles.js        instanced low-poly vehicles and their lamps
  city/TrafficSystem.js   routes, signals, car following, turns
  room/RoomBuilder.js     bedroom, furniture, interior lights
  room/WindowGlass.js     window effect: drops, trails, condensation, refraction
  systems/TimeSystem.js   time of day -> sun, moon, clear-sky lighting
  systems/WeatherSystem.js  presets x intensity -> smoothed weather parameters
  systems/LightingSystem.js coordinates every light in both scenes
  weather/Precipitation.js  GPU rain and snow particles
  weather/LightningSystem.js  strike timing and the bolt mesh
  ui/UIController.js      control panel
```

Frame: update systems -> render the city into its own HDR target (plus a mirrored
low-resolution pass for wet-road reflections) -> soft-focus and halo passes -> render
the bedroom, whose glass panes composite the city textures -> bloom, exposure, tone
mapping. Because the city lives in its own target, rain blur and fog never touch the room.

## Quality presets

| Preset | Resolution | Notes |
| --- | --- | --- |
| High | native, up to 1.5x device pixel ratio | 4x MSAA, 2048 shadows, area lights, 8 real streetlights |
| Medium | 0.8x | 2x MSAA, 1024 shadows, point-light stand-ins, 4 real streetlights |
| Low | 0.6x | no MSAA, shadows, reflections or bloom; painted light pools |

On the first visit integrated GPUs start on Medium. If the frame rate stays below
24 fps the internal resolution is lowered in steps, then the preset; choosing a preset
by hand turns this off.