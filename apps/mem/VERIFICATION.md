# mem first milestone verification

Verification date: October 9, 2026.
T3 subagents split implementation across the tree, paths, CLI, and failure tests.
Two separate reviews were performed.
The second review found no new P1/P2 defects within its scope.

## Automated tests

```sh
bun test apps/mem
bun run check
```

All 37 mem tests passed.
Verification covered these boundaries:

- SQLite restarts, original text preservation, receipt conflicts, and redelivery.
- Parent creation after child storage, node immutability, lease contention, and expiration.
- Odd message counts and complete range coverage for 48 messages.
- Oversized summaries, oversized input, and resuming after failure.
- Shared project IDs across Git worktrees and repository relocation.
- XDG paths, configuration errors, and excluding API keys from error responses.
- Unicode text pagination, search cursors, and byte limits for entire JSON responses.
- Matching help output between the root script and direct CLI invocation.

## Live OpenCode GO connection

Requests used `deepseek-v4.1-flash` at the existing CPA's `/v1/chat/completions` endpoint.
The test data contained four original Korean records describing these events:

1. The user planned a production deployment but did not execute it.
2. The user canceled that plan and authorized only a staging deployment.
3. Staging encountered error E731 because of an expired token.
4. The user retained the staging restriction and production cancellation.

The summary target was 256 UTF-8 bytes.
The final operation stopped at the initial output limit of 1,024 tokens.
The CLI retained all four original records and recovery information.
After raising the limit to 4,096 tokens, work resumed in the same generation.

The result contained 4 messages, 7 summary nodes, and 0 incomplete leaves.
The actual response to `mem start --max-bytes 768` was 689 bytes, including the newline.
The returned top-level summary is preserved below in its original Korean:

> 사용자는 production 배포를 계획했으나 실행하지 않았고 이후 해당 계획을 취소해 production 배포는 금지되고 staging에만 배포해야 하며, staging에서 E731 오류(원인: 토큰 만료)를 확인했고 배포 성공은 확인하지 않았으며 이 결정을 유지했다.

English translation: The user planned a production deployment but did not execute it, then canceled the plan. Production deployment was prohibited, and deployment was restricted to staging. E731 occurred in staging because of an expired token. Deployment success was not confirmed, and the user retained this decision.

Seven summary responses were parsed successfully.
Their total reported usage was 3,047 input tokens and 1,732 output tokens.
These totals exclude usage from the earlier truncated response.
Monetary cost and subscription quota consumption were not measured.

## Verification limits

This verification used one synthetic case.
Long-conversation memory accuracy and improvement in memory degradation were not measured.
Long-running heartbeats, multiprocess fault injection, and real disk failures were not verified.
Comparisons between summarization models and strict model-specific token accounting belong to the next milestone.

## Follow-up implementation verification

After adding tree navigation, verbatim pins, and the evaluator, all 67 tests passed.
An independent review found no new P1/P2 defects within its scope.
Checks also covered the review's recommendations: migration rollback, a 512-byte response with maximum-length identifiers, and removing a pin with a missing source.
Completed and failed live runs with 32 synthetic records are documented in the [evaluation record](eval/RESULTS.md).
This record does not certify semantic accuracy.

## Restricting input to the assigned range

After removing earlier records outside the assigned range, all 81 tests and the full check passed.
Retries do not resend previous responses.
The new generation is separate from existing summaries.
The live 32-record rerun and ambiguous cancellation request are documented in the [range-only verification](eval/RANGE_ONLY.md).
