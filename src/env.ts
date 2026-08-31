import path from "node:path";
import dotenv from "dotenv";

// Must be imported before anything else in index.ts (as a side-effect-only
// `import "./env"` on the very first line) -- webhook.ts and others read
// process.env at their own module top level, and ES/CJS imports all run
// before the importing file's own code. If dotenv.config() ran from
// inside index.ts's body instead, every other module's top-level env reads
// would already be frozen at `undefined` by the time it got there.
dotenv.config({ path: path.resolve(__dirname, "..", ".env") });
