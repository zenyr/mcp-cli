# Slack 플러그인

Slack MCP 서버의 도구 정의와 명령 매핑을 제공합니다.
서버는 동적 클라이언트 등록을 지원하지 않습니다.
내부 앱의 사용자 토큰(`xoxp`)을 저장하거나 `SLACK_MCP_TOKEN`으로 전달하십시오.

```sh
bun run cli login slack
bun run generate slack
bun run cli slack --help
```

봇 토큰(`xoxb`)은 `mcp-cli login slack --xoxb`로 저장하고 실행 명령에도 `--xoxb`를 붙입니다.
환경변수는 `SLACK_MCP_BOT_TOKEN`을 사용합니다.
앱 설정의 Agents & AI Apps(`app-assistant`)에서 MCP 접근을 켜야 합니다.
서버는 토큰의 User Token Scope에 맞는 도구만 제공합니다. 권한 범위를 바꾸면 다시 생성하십시오.

[공통 사용법](../../apps/cli/README.md)과 [플러그인 개발 안내](../README.md)를 참고하십시오.
