import { Command } from "commander";
import { registerAccount, registerAuth, registerDoctor, registerSkill } from "./core.js";
import { registerDeployments } from "./deployments.js";
import { registerDiscovery, registerHardware, registerWebhooks } from "./discovery.js";
import { registerFiles } from "./files.js";
import { registerModels } from "./models.js";
import { registerOutputs, registerPredictions } from "./predictions.js";
import { registerRawApi } from "./raw-api.js";
import { registerShortcuts } from "./shortcuts.js";
import { registerTrainings } from "./trainings.js";

export function registerCommands(program: Command): void {
  registerDoctor(program);
  registerAuth(program);
  registerAccount(program);
  registerDiscovery(program);
  registerPredictions(program);
  registerOutputs(program);
  registerFiles(program);
  registerTrainings(program);
  registerDeployments(program);
  registerModels(program);
  registerHardware(program);
  registerWebhooks(program);
  registerShortcuts(program);
  registerRawApi(program);
  registerSkill(program);
}
