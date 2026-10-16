import { McpServer } from "@modelcontextprotocol/server";
import type { FilesContext } from "../files/readers.ts";
import { registerFilesTools } from "./tools.ts";

export const SERVER_NAME = "devflow-lab-files";
export const SERVER_VERSION = "0.1.0";

export type FilesServerDependencies = FilesContext;

export function createFilesServer(deps: FilesServerDependencies): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION }, { capabilities: { tools: {} } });
  registerFilesTools(server, deps);
  return server;
}
