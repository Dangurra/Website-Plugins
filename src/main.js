/**
 * Entry point.
 * - Dev mode: auto-inits from #past-missions div
 * - Production: exposes AlbacoreGlobe.init() for Webflow embed
 */

import { initPastMissions } from './past-missions.js';
import { initWireframeGlobe } from './wireframe-globe.js';

// Auto-init for local dev (div exists in index.html)
const el = document.getElementById('past-missions');
if (el) initPastMissions(el);

const wfEl = document.getElementById('wireframe-globe');
if (wfEl) initWireframeGlobe(wfEl);

// Export for library consumers
export { initPastMissions, initWireframeGlobe };
