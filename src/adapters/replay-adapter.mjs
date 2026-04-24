//        __     __                   
// _|_   (_ ||\/|__) /\ _ _ _ _|   _  
//  |    __)||  |__)/--|_| (_(_||_|/_ 
//                     |  

import path from "node:path";
import { buildConnectionId } from "../core/platforms.mjs";
import { loadReplayFixtures } from "../core/replay-fixtures.mjs";

export class ReplayAdapter {
  constructor({ rootDir, onEvent, tickMs = 700 }) {
    this.rootDir = rootDir;
    this.onEvent = onEvent;
    this.tickMs = tickMs;
    this.timers = [];
    this.running = false;
  }

  async start() {
    if (this.running) return;
    this.running = true;

    const fixtureDir = path.join(this.rootDir, "fixtures", "replay");
    const fixtures = await loadReplayFixtures(fixtureDir);
    const events = fixtures
      .flatMap((fixture) => fixture.events)
      .sort((a, b) => Date.parse(a.time) - Date.parse(b.time))
      .map((event) => ({
        ...event,
        connection_id: buildConnectionId({
          source: event.source,
          channel: event.channel || "replay",
          streamId: "fixture-replay"
        }),
        stream_id: "fixture-replay",
        channel_display_name: event.channel || "Replay"
      }));

    events.forEach((event, index) => {
      const timer = setTimeout(() => {
        if (!this.running) return;
        this.onEvent(event);
      }, index * this.tickMs);
      this.timers.push(timer);
    });
  }

  async stop() {
    this.running = false;
    for (const timer of this.timers) {
      clearTimeout(timer);
    }
    this.timers = [];
  }
}

