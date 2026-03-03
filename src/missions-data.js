/**
 * Sample data for 4 past missions.
 *
 * Each mission:
 *   path        – array of [lng, lat] waypoints
 *   timestamps  – parallel array of time values (arbitrary units 0 → LOOP_LENGTH)
 *   color       – RGB array for the trail
 */

export const LOOP_LENGTH = 800; // total animation duration in "time units"

export const MISSIONS = [
  {
    id: 'asia-pacific',
    name: 'Pacific Sentinel',
    category: 'Defense',
    dates: 'Jan 2024 – Apr 2024',
    description:
      'Maritime domain awareness patrol across the Western Pacific, from Okinawa through the Philippine Sea to Guam.',
    color: [0, 230, 180],   // teal-green
    path: [
      [127.7, 26.3],  [128.5, 24.5],  [130.0, 22.0],  [132.0, 20.0],
      [134.0, 18.5],  [136.0, 17.0],  [138.0, 16.0],  [140.0, 15.5],
      [142.0, 15.0],  [144.0, 14.0],  [144.8, 13.4],  [143.5, 12.0],
      [141.0, 11.0],  [138.0, 10.5],  [135.0, 12.0],  [132.5, 14.0],
      [130.0, 16.5],  [128.5, 19.0],  [127.0, 21.0],  [126.5, 23.0],
    ],
    timestamps: [
      0, 14, 28, 42, 56, 70, 84, 98, 112, 126,
      140, 154, 168, 182, 196, 210, 224, 238, 250, 260,
    ],
  },

  {
    id: 'south-china-sea',
    name: 'South China Sea Survey',
    category: 'Science',
    dates: 'Mar 2024 – Jun 2024',
    description:
      'Seabed mapping and acoustic survey of the South China Sea, from the Paracel Islands to the Spratly Islands.',
    color: [255, 200, 60],   // amber-gold
    path: [
      [112.0, 16.5],  [113.0, 15.8],  [114.5, 15.0],  [115.5, 14.0],
      [116.0, 12.5],  [115.5, 11.0],  [114.5, 9.5],   [113.0, 8.5],
      [111.5, 7.5],   [110.0, 7.0],   [108.5, 7.5],   [107.5, 8.5],
      [107.0, 10.0],  [108.0, 11.5],  [109.5, 13.0],  [111.0, 14.5],
      [112.5, 15.5],  [113.5, 16.0],
    ],
    timestamps: [
      100, 120, 145, 170, 195, 220, 245, 270,
      295, 320, 345, 370, 395, 415, 430, 445, 455, 465,
    ],
  },

  {
    id: 'giuk-gap',
    name: 'GIUK Watchtower',
    category: 'Defense',
    dates: 'May 2024 – Aug 2024',
    description:
      'Anti-submarine warfare patrol across the Greenland–Iceland–UK gap, monitoring the North Atlantic chokepoint.',
    color: [255, 90, 90],    // coral-red
    path: [
      [-5.0, 58.0],   [-7.0, 59.5],   [-10.0, 61.0],  [-13.0, 62.5],
      [-16.0, 63.5],  [-19.0, 64.5],  [-22.0, 65.0],  [-24.0, 65.5],
      [-27.0, 65.8],  [-30.0, 65.5],  [-33.0, 64.5],  [-36.0, 63.0],
      [-38.0, 61.5],  [-36.0, 60.0],  [-32.0, 59.0],  [-27.0, 58.5],
      [-22.0, 58.0],  [-17.0, 57.5],  [-12.0, 57.8],
    ],
    timestamps: [
      250, 276, 302, 328, 355, 381, 407, 433,
      460, 486, 512, 538, 564, 591, 617, 643, 670, 690, 710,
    ],
  },

  {
    id: 'gulf-of-america',
    name: 'Gulf of America Patrol',
    category: 'Commercial',
    dates: 'Feb 2024 – May 2024',
    description:
      'Infrastructure inspection and security patrol across the Gulf of America, from the Florida Straits to the Texas coast.',
    color: [120, 160, 255],  // soft blue
    path: [
      [-80.5, 25.0],  [-82.0, 25.5],  [-84.0, 26.0],  [-86.0, 27.0],
      [-88.0, 28.0],  [-90.0, 28.5],  [-92.0, 28.0],  [-93.5, 27.5],
      [-95.0, 27.0],  [-96.5, 26.5],  [-96.0, 25.5],  [-94.5, 24.5],
      [-92.0, 23.5],  [-90.0, 22.5],  [-88.0, 21.5],  [-86.0, 21.8],
      [-84.5, 23.0],  [-82.5, 24.5],
    ],
    timestamps: [
      50, 68, 86, 104, 122, 140, 160, 178,
      196, 214, 232, 250, 270, 290, 310, 330, 350, 370,
    ],
  },
];

/** Return interpolated [lng, lat] for a mission at the given time. */
export function getVesselPosition(mission, time) {
  const { path, timestamps } = mission;
  if (time < timestamps[0]) return null;
  if (time >= timestamps[timestamps.length - 1]) return path[path.length - 1];

  for (let i = 0; i < timestamps.length - 1; i++) {
    if (time >= timestamps[i] && time <= timestamps[i + 1]) {
      const t =
        (time - timestamps[i]) / (timestamps[i + 1] - timestamps[i]);
      return [
        path[i][0] + t * (path[i + 1][0] - path[i][0]),
        path[i][1] + t * (path[i + 1][1] - path[i][1]),
      ];
    }
  }
  return null;
}
