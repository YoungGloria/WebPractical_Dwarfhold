# Dwarfhold

Dwarfhold is a small browser-based colony and resource-management game. You are the warden of **Stonehome**, a new settlement beneath Emberpeak. Your three dwarves gather supplies, eat from the shared food stores, forge equipment, and explore locations beyond the hold.

This is the completed assignment for the Advanced Web Development practical exam. It was extended and adjusted to meet the [Requirements](REQUIREMENTS.md).

Additional design choices are documented in [Decisions](DECISIONS.md).

## Project Diary
The project diary for the practiacal exam can be accessed [here](https://bokuprod-my.sharepoint.com/:w:/g/personal/gloriayoung_office365_boku_ac_at/IQALL-N8-O0XTKg9cjG5ZVxqAenqxQCpctWFAYE8sYUiN3Y?e=GuaPc9).

## How the game works

The colony advances in **days**. One day passes every eight seconds while the simulation is active. The Pause button stops this clock (and every countdown with it).

The hold starts on day 12 with 14 wood, 9 stone, 18 food, 1 tool and 0 weapons, and three dwarves: Bromli (mining specialist), Yrsa (woodcutting specialist) and Dori (generalist).

Each resident has one local assignment:

| Assignment | Production per day |
|---|---:|
| Woodcutting | 3 wood |
| Deep Mining | 2 stone |
| Mushroom Farm | 4 food |
| Unassigned | No production |

A resident is only ever doing **one thing at a time**: working, travelling, forging or resting. Someone who is travelling, forging or resting cannot be reassigned and produces nothing. After an expedition or a forging task the resident **rests until the next day change** and then returns to work.

At the end of each day, every resident (including those who are away) eats one food.

### Resources

The shared inventory contains **wood**, **stone**, **food**, **tools** and **weapons**. Weapons are a colony stock, not something a single dwarf carries.

### Tools

Tick **Has Tool** on a resident to take a tool from the shared inventory. One resident carries at most one tool, and the roster shows who has it. A tool adds **+1 of the assigned resource per day** (woodcutting 4, mining 3, farming 5) while the resident is producing. A tool stays with a dwarf who leaves on an expedition.

### Famine

If the food stock at the day change is smaller than the number of residents, the hold suffers a **famine**: every producing resident yields **1 less** (never below 0). A popup and a chronicle warning explain it. Nobody dies, and food never drops below 0. Boosts stack (tool +1, knight +1, famine -1).

### Ember Forge

Forging takes **materials, a specialist and time**. Only a dwarf with a specialty can forge, and materials are paid when the task starts. The Forge page shows who is crafting and how many seconds remain.

| Recipe | Cost | Time |
|---|---|---:|
| Tool | 3 wood + 2 stone | 5 s |
| Weapon | 4 wood + 3 stone | 7 s |

An invalid attempt (missing materials, busy or unqualified forger) changes nothing.

### Expeditions

The expedition panel lets you select a scout and a destination. The scout is away while the request runs (a 5 second journey plus the server response). A success adds the rewards exactly once, a failure awards nothing and brings the scout home. Network problems are retried safely with the same request id, so nothing is rewarded twice.

| Destination | Outcome |
|---|---|
| Crystal Cave | 8 stone and 1 tool. The first success here recruits **Sir One Uper**. |
| The Old Mine | 12 stone and 2 wood |
| Blocked Pass | Always fails |
| Abandoned Fortifications | 4 stone, 3 wood, 1 tool and 1 weapon, but a **raid follows the scout home** |

### Sir One Uper, the knight

After the first successful Crystal Cave expedition the knight joins Stonehome (once only). He **produces +1 on every job**, eats like everyone else and counts for famine, but he **cannot forge and cannot go on expeditions**.

### Raids

A successful Abandoned Fortifications expedition is followed by a raid. The rewards are paid first, then:

- **3 or more weapons:** the hold defends itself. 3 weapons are used up (they are too dull to be reused), surplus weapons remain and nothing is looted.
- **Fewer than 3 weapons:** all weapons are lost and the stock of wood, stone, food and tools is **halved** (rounded, never random).

A popup, a chronicle entry and the resource bar show the result. Failed expeditions never trigger a raid.

### Save and restore

The hold is saved automatically (the last 5 states are kept). After a refresh the game restores the latest valid state, starts **paused** and explains what happened. Corrupt or incompatible saves fall back to an older save or to a new hold. Forging continues after a refresh. An expedition continues if its request was saved, otherwise it is reported as lost and the dwarf returns without a reward.

For the complete rule set see [docs/DESCISIONS.md](docs/DESCISIONS.md).

## Features

- Named residents with assignments, status and optional specialization.
- Woodcutting, mining and farming jobs, an eight-second day with pause/resume.
- Daily food consumption with a visible famine consequence.
- Equippable tools (+1 per day) and a timed forge for tools and weapons.
- A delayed, retry-safe expedition API with four destinations.
- A second species (Sir One Uper) with its own production bonus and crafting limitation.
- Raids after the Abandoned Fortifications expedition, with weapon defense or deterministic looting.
- Autosave with a save history, safe fallback and a policy for interrupted tasks.
- A recent-activity chronicle and popups for famine, raids and restored saves.
- Responsive fantasy-themed React interface.
- A Vitest suite per requirement (`src/tests/requirements/D1` to `D7`).

## Run locally

Requirements: Node.js 20.19+ or 22.12+ and npm.

```bash
npm install
npm run dev
```

The web app runs at `http://localhost:5174`; its API runs at `http://localhost:4200`. Available scripts are `dev`, `server`, `build`, `test`, and `preview`.

| Command | Purpose |
|---|---|
| `npm run dev` | Start the Vite frontend and Express API together |
| `npm run server` | Start only the API on port 4200 |
| `npm run build` | Type-check and create a production frontend build |
| `npm run test` | Run the existing Vitest tests once |
| `npm run preview` | Preview a previously created production build |

## API

- `GET /api/health`
- `POST /api/expeditions` with `{ "dwarfId": "dwarf-2", "destination": "crystal-cave", "requestId": "<uuid>" }`

Destinations: `crystal-cave`, `old-mine`, `abandoned-fortifications` (rewards) and `blocked-pass` (always fails with 503). A successful answer contains `expeditionId`, `status`, `rewards`, `message` and `raid`. The `raid` flag is `true` only for `abandoned-fortifications`. A repeated `requestId` returns the same expedition, and a `requestId` reused for another dwarf or destination returns 409. Add `?fail=true` to force a failure or `?latency=2500` to control the delay (default two seconds, maximum five).

## Project orientation

- `src/App.tsx` defines the colony and forge routes.
- `src/state/` owns the shared colony state (`ColonyProvider`), the simulation clock, the expedition runner and autosave (`hooks/`).
- `src/pages/` contains the shared layout (popups, resource bar), the colony page and the forge page.
- `src/config/` contains constants, jobs, recipes and destinations.
- `src/domain/` contains types, rules (availability, production, famine), actions (assignment, crafting, equipment, expedition, recruitment, attack) and the day simulation.
- `src/persistence/` contains the save ring, validation and the reconcile policy for interrupted tasks.
- `src/services/expeditionApi.ts` contains the expedition HTTP request with timeout and retry.
- `src/components/` contains the roster, resource bar, forge recipe panel, popup and chronicle.
- `src/tests/` contains the Vitest suites.
- `server/index.js` implements the local expedition service.

More detail: [docs/ARCHITECTUR.md](docs/ARCHITECTUR.md) (structure and call flows), [docs/DESCISIONS.md](docs/DESCISIONS.md) (game rules) and [docs/API.md](docs/API.md) (contract).
