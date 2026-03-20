---
title: Checkpoints
sidebar:
  order: 2
---

When a subscription restarts (after a deployment, crash, or scaling event), it needs to know where to resume. Without checkpoints, it would reprocess every event from the beginning every time. Checkpoints solve this by recording the last successfully processed position.

## Why checkpoints matter

Consider a subscription that builds a read model from booking events. If your service restarts after processing 10,000 events, you don't want to reprocess all 10,000. A checkpoint records "I've processed up to position 9,999," so the subscription resumes from position 10,000.

This is straightforward for sequential processing. But with concurrent processing, it gets more nuanced -- and that's where Eventuous Go's `CheckpointCommitter` earns its keep.

## CheckpointStore interface

The `CheckpointStore` defines how checkpoints are persisted and retrieved:

```go
type CheckpointStore interface {
    GetCheckpoint(ctx context.Context, id string) (Checkpoint, error)
    StoreCheckpoint(ctx context.Context, checkpoint Checkpoint) error
}
```

A `Checkpoint` contains a subscription ID and an optional position:

```go
type Checkpoint struct {
    ID       string   // subscription identifier
    Position *uint64  // nil means no checkpoint stored yet
}
```

When `Position` is `nil`, the subscription starts from the beginning. When it has a value, the subscription resumes after that position.

The `id` parameter is the subscription's unique identifier (e.g., `"BookingReadModel"`). Different subscriptions track their positions independently.

## CheckpointCommitter

The `CheckpointCommitter` is a smart component that sits between your event handler and the checkpoint store. It provides two key features: **batching** and **gap detection**.

### Creating a committer

```go
committer := subscription.NewCheckpointCommitter(
    checkpointStore,    // where to persist checkpoints
    "BookingReadModel", // subscription ID
    100,                // batch size: commit every 100 events
    5 * time.Second,    // interval: commit at least every 5 seconds
)
```

Parameters:
- `batchSize` -- commit after this many events have been processed. Set to 0 to disable batch-based commits.
- `interval` -- commit at least this often, even if the batch size hasn't been reached. Set to 0 to disable time-based commits.
- If both are 0, every event triggers an immediate commit.

### Recording processed events

After your handler successfully processes an event, call `Commit`:

```go
err := committer.Commit(ctx, consumeCtx.GlobalPosition, consumeCtx.Sequence)
```

The committer uses both the `position` (the event's position in the store, which is what gets checkpointed) and the `sequence` (the subscription-local counter, which is used for gap detection).

## Gap detection explained

Gap detection is the reason the `CheckpointCommitter` exists rather than simply writing the position of each processed event. Consider what happens with concurrent processing.

### The problem

Suppose three events arrive with sequences 1, 2, 3 and are processed concurrently:

```
Event seq=1 → handler goroutine A (takes 100ms)
Event seq=2 → handler goroutine B (takes 10ms)
Event seq=3 → handler goroutine C (takes 50ms)
```

Goroutine B finishes first (seq=2), then C (seq=3), then A (seq=1). If we checkpoint after each completion:

```
B finishes → checkpoint position of seq=2
```

If the service crashes now, it restarts from position of seq=2. But seq=1 was never processed -- it's lost. This is the gap problem.

### The solution

The `CheckpointCommitter` tracks which sequences have been completed and only advances the checkpoint when there are no gaps:

```
B finishes (seq=2) → gap detected (seq=1 missing), don't commit
C finishes (seq=3) → gap still exists (seq=1 missing), don't commit
A finishes (seq=1) → no gap! Advance to seq=3, commit position of seq=3
```

Internally, it maintains a map of pending completions and walks forward from the last committed sequence. It only advances when the next expected sequence is present, then continues walking until it hits a gap.

### Step by step

Here is how the committer processes the scenario above:

1. **B completes (seq=2, pos=200):**
   - Add {2 → 200} to pending map
   - Walk from last committed (0): need seq=1, not in pending
   - Gap detected. No commit.

2. **C completes (seq=3, pos=300):**
   - Add {3 → 300} to pending map
   - Walk from last committed (0): need seq=1, not in pending
   - Gap still present. No commit.

3. **A completes (seq=1, pos=100):**
   - Add {1 → 100} to pending map
   - Walk from last committed (0): need seq=1, found! Advance. Need seq=2, found! Advance. Need seq=3, found! Advance. Need seq=4, not found, stop.
   - Uncommitted frontier is now seq=3 at position 300
   - Commit position 300 to checkpoint store

The result: the checkpoint correctly reflects that all events through position 300 have been processed, and no events were skipped.

## Flush and Close

Call `Flush` to force an immediate commit of the highest contiguous position:

```go
err := committer.Flush(ctx)
```

Call `Close` before shutdown to stop the internal timer and flush any pending checkpoints:

```go
err := committer.Close(ctx)
```

:::tip
Always call `Close` during graceful shutdown. Without it, you might lose the last batch of checkpoint updates, causing some events to be reprocessed on restart.
:::

## Configuration guidance

| Scenario | Batch size | Interval | Rationale |
|----------|-----------|----------|-----------|
| Low throughput, strong consistency | 1 | 0 | Commit every event. Higher I/O, lowest reprocessing on restart. |
| High throughput, some reprocessing OK | 500 | 10s | Batch for efficiency. May reprocess up to 500 events on restart. |
| Balanced | 100 | 5s | Good default for most applications. |

:::caution
Larger batch sizes mean fewer writes to the checkpoint store but more events to reprocess if the service crashes before the batch commits. Choose based on how expensive reprocessing is for your handlers.
:::
