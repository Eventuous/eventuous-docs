---
title: Subscriptions
sidebar:
  order: 1
---

# Subscriptions

Subscriptions consume events from an event store in real-time.

## Event handler

```go
type EventHandler interface {
    HandleEvent(ctx context.Context, msg *ConsumeContext) error
}

// HandlerFunc adaptor (like http.HandlerFunc)
handler := subscription.HandlerFunc(func(ctx context.Context, msg *subscription.ConsumeContext) error {
    fmt.Printf("Event: %s on stream %s\n", msg.EventType, msg.Stream)
    return nil
})
```

## Middleware

Middleware wraps handlers with additional behavior, using the same pattern as `net/http`:

```go
handler := subscription.Chain(myHandler,
    subscription.WithLogging(slog.Default()),
    subscription.WithConcurrency(4),
    subscription.WithPartitioning(8, nil), // nil = partition by stream name
)
```

| Middleware | Description |
|-----------|-------------|
| `WithLogging` | Logs event processing at debug level |
| `WithConcurrency(n)` | Process up to n events concurrently |
| `WithPartitioning(n, keyFunc)` | Distribute across n goroutines by key |

## Checkpoint management

The `CheckpointCommitter` batches checkpoint writes with gap detection — it never commits position N+1 if position N hasn't been processed yet.

```go
type CheckpointStore interface {
    GetCheckpoint(ctx context.Context, id string) (Checkpoint, error)
    StoreCheckpoint(ctx context.Context, checkpoint Checkpoint) error
}
```
