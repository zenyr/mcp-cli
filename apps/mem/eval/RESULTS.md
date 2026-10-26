# Summary evaluation with 32 synthetic records

> This document and its archived JSON record the generation v2 schema and historical context policy at commit `da2151a`.
> The current generation v3 uses `range-only-v1` and excludes earlier records outside the node's range and previous model responses.
> The observations below do not validate the current policy's quality. Run the reproduction commands from a `da2151a` checkout.

On October 9, 2026, OpenCode GO's `deepseek-v4.1-flash` was called through the existing CPA.
Both runs used the same 32 records and a 512-byte summary target.
The output limit was 4,096 tokens, with reasoning explicitly disabled.
Each run had a limit of 80 calls.
Each condition was run only once.

## Completed runs

- Actual preceding context: 12 calls, 7,826 input tokens, 1,114 output tokens, approximately 21.6 seconds.
- Isolated context: 9 calls, 3,426 input tokens, 528 output tokens, approximately 13.2 seconds.
- Both runs completed through structural depth 5.
- Neither run's completed calls had unknown usage or size-reduction retries.

Token counts are usage reported by responses.
Monetary cost and subscription quota consumption were not measured.
These figures are observations, not general improvement rates or optimal settings.

## Manual review

Both top-level summaries preserved the following:

1. The production plan was canceled before execution.
2. Only staging verification was authorized, and production was prohibited.
3. E731 was caused by an expired token, not the network.
4. Acceptance of a request does not establish deployment success or approval.

String checks produce false positives.
The actual-context run omitted the Korean word `확인` (confirmation) but stated that no completion log existed.
Both runs included `배포 성공` (deployment success) in sentences prohibiting a conclusion of success.
Counts of missing words or possible contradictions are therefore not semantic error rates.

In the actual-context run, the node at depth 4, index 1 covered `[16,32)`.
Its summary also included the cancellation at index 2 and E731 facts at index 9, both outside that range.
This is an example of preceding context facts reappearing in a summary for a different range.
The behavior can confuse where to find original text and how to interpret dates.
This case alone does not establish that context isolation is always better.

## Boundaries revealed by failures

The initial implementation forced LLM compression even for small parents.
Input shorter than the target still failed after three compression attempts.
The implementation was changed to preserve both children's text verbatim for short parents.

With provider-default reasoning, both conditions stopped at the output token limit.
Usage for those failed calls is unknown.
Known token totals from failed runs are not compared with the total cost of completed runs.
The product's default reasoning setting was not changed.

## Reproduction

```sh
bun apps/mem/eval/main.ts --live --records 32 --model deepseek-v4.1-flash --thinking disabled --mode system --max-calls 80 --node-bytes 512 --output /tmp/mem-eval-system.json
bun apps/mem/eval/main.ts --live --records 32 --model deepseek-v4.1-flash --thinking disabled --mode isolated --max-calls 80 --node-bytes 512 --output /tmp/mem-eval-isolated.json
```

- [Actual-context report](results/deepseek-disabled-system-32.json).
- [Isolation report](results/deepseek-disabled-isolated-32.json).
- [Actual-context failure record](results/failures-system.json).
- [Isolation failure record](results/failures-isolated.json).

Model comparisons, agent retrieval success rates, and variation across repeated runs were not measured.
Neither datasets with 256 or more records nor real user conversations were evaluated.
