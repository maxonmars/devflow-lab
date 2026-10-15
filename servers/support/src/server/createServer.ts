import { McpServer } from "@modelcontextprotocol/server";
import type { ReadData } from "../data/store.ts";
import { registerSupportTools } from "./tools.ts";

export const SERVER_NAME = "devflow-lab-support";
export const SERVER_VERSION = "0.1.0";

export type SupportServerDependencies = Readonly<{ readData: ReadData }>;

export function createSupportServer(deps: SupportServerDependencies): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION }, { capabilities: { tools: {} } });
  registerSupportTools(server, deps.readData);
  return server;
}
