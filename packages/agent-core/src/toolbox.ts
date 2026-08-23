import type { Service } from "./service.js";

/** A single tool invocation routed through the toolbox. */
export interface ToolCall {
  tool: string;
  args: unknown;
}

/** The result of a routed tool call. */
export interface ToolResult {
  tool: string;
  result: unknown;
}

/**
 * Routes each {@link ToolCall} to a named sub-service so many services
 * meter over one channel and settle with one proof.
 */
export class ToolboxService implements Service<ToolCall, ToolResult> {
  readonly name = "toolbox";
  readonly #tools: Map<string, Service<any, any>>;

  constructor(tools: Record<string, Service<any, any>>) {
    this.#tools = new Map(Object.entries(tools));
    if (this.#tools.size === 0) throw new Error("toolbox needs at least one tool");
  }

  toolNames(): string[] {
    return [...this.#tools.keys()];
  }

  #get(tool: string): Service<any, any> {
    const svc = this.#tools.get(tool);
    if (svc === undefined) throw new Error(`unknown tool: ${tool}`);
    return svc;
  }

  price(req: ToolCall): bigint {
    return this.#get(req.tool).price(req.args);
  }

  async handle(req: ToolCall): Promise<ToolResult> {
    const svc = this.#get(req.tool);
    return { tool: req.tool, result: await svc.handle(req.args) };
  }
}
