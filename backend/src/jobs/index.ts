import { queue } from "./queue";
import { processOcrJob } from "./ocr.job";
import { processExportJob } from "./export.job";

// Registers all background job handlers on the in-process queue. Called
// once at server startup (see server.ts).
export function registerJobs() {
  queue.register("ocr", processOcrJob);
  queue.register("export", processExportJob);
}
