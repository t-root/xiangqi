# Pika cache after off-guide cannon move

## Current policy: stop at the remaining horizon

After the user's requested policy change, the same fixture was rerun on both real engines.
Native and Web each passed with 20 dispatches and maximum depth 6: 3 branches READY_ATTACK,
17 branches HORIZON_MISS. A horizon miss stops retries, carries verifiedHorizon=false,
and is displayed as no answer found within the remaining 3 moves, not an exhaustive BF proof.
The full test suite also passed. Retry time doubles only for incomplete searches below the horizon.
The older unrestricted-search results below describe the previous policy, superseded by this change.

Fixture: `3a3P1/4nk3/4Pa3/9/7r1/9/9/4K4/4A4/8C w - - 0 1`.
Red guide, attack target 4 moves, both sides human; execute `i0c0` (Pháo (1,1) → (7,1)). Pika slice 600 ms.

Before fix, the real browser/native reproduction repeated about 115 runs per unresolved branch while attempt remained 1. Searches stopped at depth 6 in a few milliseconds. The incomplete-result path referenced undeclared `completedSearch`; the queue caught that exception and retried without advancing the attempt.

Fix: declare the completion flag before result handling; use `go movetime` instead of a fixed horizon depth cap. The horizon remains the acceptance threshold. Existing current-run and cancellation checks remain.

Verification after fix, with the dedicated server and actual engines:

- Native: PASS, 38 dispatches, maximum observed depth 245.
- Web: PASS, 38 dispatches, maximum observed depth 172.
- Both: all 20 branches completed or advanced beyond L2; dispatch assertions detected no overlapping active jobs or higher-attempt overtaking.
- `node tests/run.cjs`: all suites passed, including the actual adapter regression that catches the undeclared-variable path.

This verifies scheduling progress and transport/result handling, not that all branches have a winning answer. The browser fixture directly initializes the guide state rather than replaying the entire preceding analysis UI. Packaged executable was not rebuilt.
