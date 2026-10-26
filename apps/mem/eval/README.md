# Memory compression evaluation

This evaluator builds real `summarize` trees from synthetic Korean records. By default, it writes a fixture manifest to a file. Specify `--live` to call the model.

```sh
bun apps/mem/eval/main.ts --records 32 --model deepseek-v4.1-flash
bun apps/mem/eval/main.ts --live --records 32 --model deepseek-v4.1-flash --thinking disabled --mode range-only --max-calls 80 --node-bytes 512 --output /tmp/mem-eval-range-only32.json
bun test apps/mem/test/evaluation.test.ts
```

- The default mode is `range-only`. Both dry runs and live runs reject `system` and `isolated`.
- Leaf requests contain only their own message. Parent requests contain only their two children.
- Retries send the same original input and `retry: true`. They exclude previous model responses and earlier records outside the node's range.
- The report's `inputPolicy` is `range-only-v1`. `externalContextBytes` is always 0.
- Each attempt records actual `sourceBytes` and `outputBytes`. Failed responses have null `outputBytes`.
- `--records` supports 32 through 256. The default is 32.
- Omitting `--model` uses the existing configuration loader's defaults and `MEM_MODEL`.
- The default API address is the CPA address in the existing configuration. Override it with `MEM_BASE_URL`.
- `MEM_API_KEY` is used only in request headers. Reports do not store environment variables or the API address.
- `--thinking enabled|disabled|default` selects reasoning settings for supported providers. The default preserves existing settings.

For 32 records, the maximum structural depth is 5. The evaluator reports actual nodes at depths 0, 1, 2, 4, and 5. Evaluation depth never exceeds `floor(log2(records))`, even with a different record count. Irrelevant records are shorter than the default 512-byte target. Four important records exceed 512 bytes and trigger leaf compression with the default settings. Short parents preserve both children's text verbatim.

The fixture distinguishes production cancellation, staging restrictions, the expired token that caused E731, unconfirmed deployment status, and user versus tool sources. Each fact retains its record index and Unicode scalar range `[from, to)` as an evidence address. Reports retain the original fixture and node summaries so manual reviewers can trace corrections.

Call instrumentation accumulates every compression attempt and retry. Budget checks run before the next compression call. Budget exhaustion reports `budget-stopped` and exit code 1. Model errors report `failed`. Failed calls and responses with incomplete usage are counted in `unknownUsage`. Token totals include only calls with known usage. Do not interpret unknown usage as free calls. Latency distinguishes per-call time from total runtime.

`proxyChecks` only checks for expected words, missing words, and possible contradiction phrases. It does not measure semantic accuracy or error rates. Possible contradiction phrases can also occur in negative statements. Manually review the original text together with `quotedText`. Even the presence of every expected word does not guarantee correct cancellation relationships or attribution.

This version does not evaluate search performance or an agent's ability to discover records. It also does not measure oracle accessibility through evidence addresses. Model comparisons, price-based cost calculations, and long-term quality verification are deferred. These require per-model reports using identical fixtures and settings, followed by manual review and usage comparisons.

The evaluator uses a temporary SQLite database separate from the user's XDG paths. It removes the database on exit.
Reports are saved to `--output`. If omitted, a unique file is created in a temporary directory.
stdout returns only a short status, usage summary, and file path. Read the fixture and full report from the file.

A call's `success` means that the model response was parsed successfully. It does not mean a summary node satisfying the size constraints was published successfully.
Use the report's `status` and `failure` to determine whether the entire tree succeeded.

[Historical results](RESULTS.md) preserve completed and failed generation v2 runs.
[Range-only verification](RANGE_ONLY.md) distinguishes automated input-boundary checks from live model observations under the current policy.
