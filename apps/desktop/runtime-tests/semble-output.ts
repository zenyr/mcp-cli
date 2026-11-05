import { formatSearchResult } from "../../../plugins/fast-semble/src/output";
import { equal, type RuntimeCase } from "./contract";

export const sembleOutputCases: RuntimeCase[] = [
  {
    name: "Semble compact output preserves Unicode snippets and rejects unknown metadata",
    run: () => {
      const payload = {
        query: "인증",
        results: [
          {
            file_path: "인증.ts",
            start_line: 1,
            end_line: 2,
            score: 0.5,
            content: 'const 인증 = "허용";\n',
          },
        ],
      };
      const text = JSON.stringify(payload);
      equal(
        formatSearchResult({
          content: [{ type: "text", text }],
          structuredContent: { result: text },
        }),
        '인증.ts:1-2\nconst 인증 = "허용";\n',
      );
      equal(
        formatSearchResult({
          content: [{ type: "text", text: JSON.stringify({ ...payload, warning: "incomplete" }) }],
        }),
        undefined,
      );
    },
  },
];
