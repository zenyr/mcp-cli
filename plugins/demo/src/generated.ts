import type { Manifest, ToolCaller } from "@mcp-cli/core";
export const manifest = {
  "commands": [
    {
      "description": "Echo a message",
      "examples": [
        "demo message echo --text hello --count 2"
      ],
      "inputSchema": {
        "additionalProperties": false,
        "properties": {
          "count": {
            "maximum": 5,
            "minimum": 1,
            "type": "integer"
          },
          "labels": {
            "items": {
              "type": "string"
            },
            "type": "array"
          },
          "parent": {
            "additionalProperties": false,
            "properties": {
              "page_id": {
                "type": "string"
              }
            },
            "type": "object"
          },
          "text": {
            "description": "Message to echo",
            "type": "string"
          },
          "uppercase": {
            "type": "boolean"
          }
        },
        "required": [
          "text"
        ],
        "type": "object"
      },
      "name": "demo-echo",
      "path": [
        "message",
        "echo"
      ],
      "summary": "Echo a message"
    },
    {
      "description": "Return an error",
      "inputSchema": {
        "additionalProperties": false,
        "properties": {},
        "type": "object"
      },
      "name": "demo-fail",
      "path": [
        "message",
        "fail"
      ],
      "summary": "Return a tool error"
    }
  ],
  "service": "demo",
  "summary": "Local MCP example",
  "version": 1
} satisfies Manifest;
export interface Tool0Input {
count?: number
labels?: string[]
parent?: {
page_id?: string
}
/**
 * Message to echo
 */
text: string
uppercase?: boolean
}

export interface Tool1Input {

}

export function createClient(call: ToolCaller) {
  return {
    ["demo-echo"]: (input: Tool0Input) => call("demo-echo", { ...input }),
    ["demo-fail"]: (input: Tool1Input) => call("demo-fail", { ...input }),
  };
}
