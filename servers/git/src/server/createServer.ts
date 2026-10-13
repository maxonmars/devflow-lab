import { McpServer } from "@modelcontextprotocol/server";
import type { RunGit } from "../git/run.ts";
import { registerGitTools } from "./tools.ts";

export const SERVER_NAME = "devflow-lab-git";
export const SERVER_VERSION = "0.1.0";

export type GitServerDependencies = Readonly<{ runGit: RunGit }>;

export function createGitServer(deps: GitServerDependencies): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION }, { capabilities: { tools: {} } });
  registerGitTools(server, deps.runGit);
  return server;
}
