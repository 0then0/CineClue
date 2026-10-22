import { lazyFunction } from "../../apps/api/src/runtime.ts";

export default lazyFunction();
export const config = { path: "/api/*", memory: 1024 };
