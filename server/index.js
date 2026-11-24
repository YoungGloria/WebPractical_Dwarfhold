import cors from "cors";
import express from "express";

const app = express();
const port = Number(process.env.PORT ?? 4200);
let expeditionNumber = 16;
const processed = new Map();

const outcomes = {
  "crystal-cave": {
    rewards: { stone: 8, tools: 1 },
    message: "The scout found a crystal seam and an abandoned mason's tool.",
    raid: false,
  },
  "old-mine": {
    rewards: { stone: 12, wood: 2 },
    message: "The old mine still holds good stone and usable supports.",
    raid: false,
  },
  "abandoned-fortifications": {
    rewards: { stone: 4, wood: 3, tools: 1, weapons: 1 },
    message: "The abandoned fortifications are already looted. But there where some tools and weapons under a collapsed building.",
    raid: true,
  }
};

app.use(cors());
app.use(express.json());

app.get("/api/health", (_req, res) =>
  res.json({ ok: true, service: "dwarfhold" }),
);

// Expeditions endpoint - Adjusted to meet D4 requirements by:
// 1. Validate request (requires dwarfId and destination)
// 2. Await existing promise from processed Map if requestId was already seen
// 3. Reject intentional/simulated failures (503) before mutating state
// 4. Look up outcome for new expedition (404 if destination has none)
// 5. Increment expeditionNumber on success and resolve the cached promise by requestId

app.post("/api/expeditions", async (req, res) => {
  const { dwarfId, destination, requestId } = req.body ?? {};

  // Validate request
  if (typeof dwarfId !== "string" || typeof destination !== "string") {
    return res
      .status(400)
      .json({ error: "dwarfId and destination are required" });
  }

  // Check if requestId is provided and valid - this correspods to a cached response in the processed Map
  const hasRequestId = typeof requestId === "string" && requestId.length > 0;

  if (hasRequestId && processed.has(requestId)) {
    const entry = processed.get(requestId);

    // Validate that the cached entry corresponds to the same dwarfId and destination
    if (entry.dwarfId !== dwarfId || entry.destination !== destination) {
      return res
        .status(409)
        .json({ error: "requestId belongs to another expedition" });
    }
    try {
      const body = await entry.promise;
      return res.json(body);
    } catch (err) {
      return res.status(err.status ?? 500).json({ error: err.message });
    }
  }

  // simulated latency
  const latency = Math.max(
    0,
    Math.min(
      5000,
      Number(req.query.latency ?? process.env.API_LATENCY ?? 2000),
    ),
  );

  // Simulate processing the new expedition request
  const runExpedition = () =>
    new Promise((resolve, reject) => {
      setTimeout(() => {
        if (req.query.fail === "true" || destination === "blocked-pass") {
          return reject({
            status: 503,
            message:
              "Rockfall has sealed the route. The company heard no signal.",
          });
        }

        // Look up the outcome for the expedition destination
        const outcome = outcomes[destination];

        // If no outcome is found for the destination, return a 404 error
        if (!outcome) {
          return reject({
            status: 404,
            message: "That destination is not on the hold map",
          });
        }

        // Outcome found, increment expeditionNumber for the new expedition and resolve the promise
        expeditionNumber += 1;

        const body = {
          expeditionId: `expedition-${expeditionNumber}`,
          status: "completed",
          ...outcome,
        };

        resolve(body);
      }, latency);
    });

  const promise = runExpedition();
  if (hasRequestId) {
    processed.set(requestId, { promise, dwarfId, destination });
    setTimeout(() => processed.delete(requestId), 10 * 60_000).unref(); // Clean up the cache after 10 minutes, unref so it doesn't keep the server alive
  }

  try {
    const body = await promise;
    return res.json(body);
  } catch (err) {
    return res.status(err.status ?? 500).json({ error: err.message });
  }
});

app.listen(port, () =>
  console.log(`Dwarfhold API listening on http://localhost:${port}`),
);
