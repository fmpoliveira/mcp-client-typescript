import Anthropic from "@anthropic-ai/sdk";
import { MessageParam, Tool } from "@anthropic-ai/sdk/resources/index.mjs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import readline from "readline/promises";
import dotenv from "dotenv";

dotenv.config();

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
if (!ANTHROPIC_API_KEY) {
  throw new Error("ANTHROPIC_API_KEY is not set");
}

class MCPClient {
  private mcps: Client[] = [];
  private anthropic: Anthropic;
  private tools: Tool[] = [];
  private toolToServerMap: Map<string, number> = new Map();

  constructor() {
    this.anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
  }

  async connectToServer(serverScriptPaths: string[]) {
    try {
      const allTools = await Promise.all(
        serverScriptPaths.map(async (serverScriptPath, index) => {
          console.log(`Connecting to server ${index + 1}: ${serverScriptPath}`);

          const isJs = serverScriptPath.endsWith(".js");
          const isPy = serverScriptPath.endsWith(".py");

          if (!isJs && !isPy) {
            throw new Error("Server script must be a .js or .py file");
          }

          const command = isPy
            ? process.platform === "win32"
              ? "python"
              : "python3"
            : process.execPath;

          const transport = new StdioClientTransport({
            command,
            args: [serverScriptPath],
            env: {
              METEOSTAT_RAPID_API_KEY:
                process.env.METEOSTAT_RAPID_API_KEY || "",
            },
          });

          const mcpInstance = new Client({
            name: `mcp-client-${index}`,
            version: "1.0.0",
          });

          mcpInstance.connect(transport);
          this.mcps.push(mcpInstance);

          const toolsResult = await mcpInstance.listTools();

          console.log(
            `Server ${index + 1} tools:`,
            toolsResult.tools.map((t) => t.name).join(", ")
          );

          return toolsResult.tools.map((tool) => {
            this.toolToServerMap.set(tool.name, index);

            return {
              name: tool.name,
              description: tool.description,
              input_schema: tool.inputSchema,
            };
          });
        })
      );

      this.tools = allTools.flat();

      console.log(
        "Connected to server with tools: ",
        this.tools.map(({ name }) => name)
      );
    } catch (error) {
      console.log("Failed to connect to MCP server: ", error);
      throw error;
    }
  }

  async processQuery(query: string) {
    const messages: MessageParam[] = [
      {
        role: "user",
        content: query,
      },
    ];

    const response = await this.anthropic.messages.create({
      model: "claude-3-5-sonnet-20241022",
      max_tokens: 1000,
      messages,
      tools: this.tools,
    });

    console.log("Claude response received: ");
    const finalText = [];
    const toolResults = [];

    try {
      for (const content of response.content) {
        if (content.type === "text") {
          finalText.push(content.text);
        } else if (content.type === "tool_use") {
          const toolName = content.name;

          const toolArgs = content.input as
            | { [x: string]: unknown }
            | undefined;

          const serverIndex = this.toolToServerMap.get(toolName);

          if (serverIndex === undefined) {
            console.error(`Tool ${toolName} not found in any connected server`);
            finalText.push(
              `[Error: Tool ${toolName} not found in any connected server]`
            );
            continue;
          }

          console.log(`Calling tool ${toolName} on server ${serverIndex}`);

          const result = await this.mcps[serverIndex].callTool({
            name: toolName,
            arguments: toolArgs,
          });

          toolResults.push(result);

          finalText.push(
            `[Called tool ${toolName} with args ${JSON.stringify(toolArgs)}]`
          );

          messages.push({
            role: "user",
            content: result.content as string,
          });

          const followUpResponse = await this.anthropic.messages.create({
            model: "claude-3-5-sonnet-20241022",
            max_tokens: 1000,
            messages,
          });

          const followUpText =
            followUpResponse.content[0].type === "text"
              ? followUpResponse.content[0].text
              : "";

          finalText.push(followUpText);
        }
      }
    } catch (error) {
      console.error("Error on processQuery: ", error);
      finalText.push(`[Error processing query: ${error}]`);
    }

    return finalText.join("\n");
  }

  async chatLoop() {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    try {
      console.log("\nMCP Client Started!");
      console.log(`Connected to ${this.mcps.length} MCP servers`);
      console.log("Type your queries or 'quit' to exit.");

      while (true) {
        console.log("\x1b[36mQuery\x1b[0m");
        const message = await rl.question("\n------ ");

        if (message.toLowerCase() === "quit") {
          break;
        }

        const response = await this.processQuery(message);
        console.log("\n" + response);
      }
    } catch (error) {
      throw new Error("Failed to process query: " + error);
    } finally {
      rl.close();
    }
  }

  async cleanup() {
    for (const mcp of this.mcps) {
      await mcp.close();
    }
    console.log("Closed all MCP connections");
  }
}

async function main() {
  if (process.argv.length < 3) {
    console.log(
      "Usage: tsc && node index.ts <path-to-server-script-1> [<path-to-server-script-2> ...]"
    );
    return;
  }
  const mcpClient = new MCPClient();
  const serverScripts = process.argv.slice(2);

  try {
    await mcpClient.connectToServer(serverScripts);
    await mcpClient.chatLoop();
  } catch (error) {
    throw new Error("Failed to start MCP client: " + error);
  } finally {
    await mcpClient.cleanup();
    process.exit(0);
  }
}

main();
