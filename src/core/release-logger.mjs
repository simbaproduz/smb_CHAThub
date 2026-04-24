//        __     __                   
// _|_   (_ ||\/|__) /\ _ _ _ _|   _  
//  |    __)||  |__)/--|_| (_(_||_|/_ 
//                     |  

import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { resolveRuntimeDir } from "./runtime-paths.mjs";

export class ReleaseLogger {
  constructor(rootDir) {
    this.logDir = path.join(resolveRuntimeDir(rootDir), "logs");
    this.logPath = path.join(this.logDir, "monitor.log");
    this.pendingWrite = Promise.resolve();
  }

  info(event, message, metadata = {}) {
    return this.write("info", event, message, metadata);
  }

  warn(event, message, metadata = {}) {
    return this.write("warning", event, message, metadata);
  }

  error(event, message, metadata = {}) {
    return this.write("error", event, message, metadata);
  }

  write(level, event, message, metadata = {}) {
    const line = JSON.stringify({
      time: new Date().toISOString(),
      level,
      event,
      message,
      metadata
    }) + "\n";

    this.pendingWrite = this.pendingWrite
      .then(async () => {
        await mkdir(this.logDir, { recursive: true });
        await appendFile(this.logPath, line, "utf8");
      })
      .catch(() => {
        // logging nunca deve derrubar o runtime
      });

    return this.pendingWrite;
  }
}
