//        __     __
// _|_   (_ ||\/|__) /\ _ _ _ _|   _
//  |    __)||  |__)/--|_| (_(_||_|/_
//                     |

import path from "node:path";

export function resolveRuntimeDir(rootDir) {
  const override = process.env.CHAT_HUB_RUNTIME_DIR?.trim();
  return override ? path.resolve(override) : path.join(rootDir, "runtime");
}

export function resolveBundledRuntimeDir(rootDir) {
  return path.join(rootDir, "runtime");
}
