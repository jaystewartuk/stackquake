// npm run ui:seed: wipes the local D1's users, projects, events and alerts and writes the
// deterministic demo data (src/dev-seed.ts). Needs `npm run dev` running.
import { seed } from "./lib.mjs";

const data = await seed();
console.log(`seeded: ${data.deps} deps, ${Object.keys(data.events).length} events, projects ${JSON.stringify(data.projects)}; ids in .ui/seed.json`);
