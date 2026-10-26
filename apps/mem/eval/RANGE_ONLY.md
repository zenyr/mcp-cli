# Verification of range-only summarization

The `range-only-v1` policy was verified on October 9, 2026.
The code baseline was `032d7bb`.
The summarizer does not send earlier records outside the node's range.
Leaves receive only their own message, parents receive their two child summaries, and retries receive the same source with compression constraints.

## Automated boundary checks

All 81 mem tests, type checking, and the full check passed.
An independent review found no P1/P2 defects within its scope.
Boundary tests checked the following paths:

- Earlier messages and memory from other scopes do not enter later leaves.
- Parents receive only their own two children.
- Caller-supplied context, history, and pin properties are excluded from HTTP requests.
- Rejected model responses and assistant messages are excluded from retries.
- Generation v2 nodes are not reused in the new generation v3.
- The legacy contextBytes setting does not affect summary input or generation.

These checks verify the boundaries of supplied data.
They do not establish that model prior knowledge or hallucinations have been eliminated.

## Live evaluation with 32 records

OpenCode GO's `deepseek-v4.1-flash` was called through the existing CPA.
The run used the same 32 synthetic records as the historical evaluation.
The summary target was 512 bytes, the output limit was 4,096 tokens, and reasoning was explicitly disabled.
One run completed.

- It completed through structural depth 5.
- It made 10 model calls, including one compression retry.
- Known usage was 4,566 input tokens and 809 output tokens.
- Total runtime was approximately 17.8 seconds.
- The completed run had no responses with unknown usage.

The previously problematic range at depth 4, index 1 was `[16,32)`.
This summary recorded that request acceptance and completion were unconfirmed, and distinguished user reports from tool reports.
It did not include the production cancellation at index 2 or E731 facts at index 9, both outside the range.
The top-level `[0,32)` summary preserved the cancellation, staging restriction, E731 cause, and unconfirmed deployment success.

The summary grouped some meeting-room record numbers as `16–23`.
That range also contains important record 18, so precise record distinctions require comparison with the original text.
Restricting input boundaries does not eliminate inaccurate grouping of facts within a range.

## Ambiguous references

A separate request supplied only one message repeating “아까 그 계획 취소해 주세요.” (Please cancel that earlier plan.)
The model returned the following 66-byte summary in Korean:

> 사용자가 "아까 그 계획"을 취소해 달라고 요청함.

English translation: The user requested cancellation of “that earlier plan.”

The model did not invent a specific plan name or target.
This observation comes from one synthetic case.

## Changes after failure

The first range-only run stopped after three compression attempts returned responses of the same length.
The implementation was changed to reduce only the target bytes to 75% and 50%, without resending the previous response.
An instruction to condense repeated sentences to a single occurrence was also added.
The acceptance limit and original text preservation policy remained unchanged.
Neither the original text nor its range was truncated to obtain a completed result.

## Reproduction and limits

```sh
bun apps/mem/eval/main.ts --live --records 32 --model deepseek-v4.1-flash --thinking disabled --mode range-only --max-calls 80 --node-bytes 512 --output /tmp/mem-eval-range-only32.json
```

- [Completed report](results/deepseek-disabled-range-only-32.json).
- [Initial size-reduction failure](results/range-only-initial-size-failure.json).
- [Ambiguous cancellation request](results/range-only-ambiguity.json).

Prompts, retry conditions, and generation policy also differ from the historical evaluation.
Token differences cannot be attributed solely to removing external context.
Monetary cost, model comparisons, variation across repeated runs, and agent retrieval success rates were not measured.
String checks do not guarantee semantic accuracy or freedom from hallucinations.
