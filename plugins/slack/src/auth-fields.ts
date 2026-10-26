import type { AuthSettingsField } from "@mcp-cli/core";

export const authFields: AuthSettingsField[] = ["mcp", "web"].flatMap((target) => [
  {
    path: [target, "method"],
    label: "로그인 방법",
    type: "select" as const,
    options: [
      { value: "choose", label: "선택 전" },
      { value: "token", label: "토큰 직접 입력" },
      { value: "pkce", label: "브라우저 로그인" },
    ],
  },
  ...[
    { key: "clientId", label: "Client ID" },
    { key: "appId", label: "App ID" },
    { key: "teamId", label: "워크스페이스 ID" },
    { key: "redirectUri", label: "등록한 Redirect URL" },
  ].map(({ key, label }) => ({ path: [target, key], label, type: "text" as const })),
  {
    path: [target, "scopes"],
    label: "사용자 권한",
    description: "쉼표로 구분합니다.",
    type: "strings" as const,
  },
  {
    path: [target, "pkceEnabled"],
    label: "Slack App에서 PKCE 활성화를 확인했습니다",
    description: "Slack의 PKCE 활성화는 되돌릴 수 없습니다. 먼저 App 관리자와 확인하세요.",
    type: "boolean" as const,
  },
  ...(target === "mcp"
    ? [
        {
          path: [target, "mcpEnabled"],
          label: "Slack MCP 접근 허용을 확인했습니다",
          type: "boolean" as const,
        },
        {
          path: [target, "distribution"],
          label: "Slack App 배포 상태",
          type: "select" as const,
          options: [
            { value: "internal", label: "내부 앱" },
            { value: "marketplace", label: "Marketplace 게시 완료" },
            { value: "unlisted", label: "미게시 배포 앱" },
          ],
        },
      ]
    : []),
]);
