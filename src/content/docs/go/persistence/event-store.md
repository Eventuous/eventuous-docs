---
title: Event Store
sidebar:
  order: 1
---

# Event Store

Eventuous defines persistence through three interfaces.

## Interfaces

```go
type EventReader interface {
    ReadEvents(ctx context.Context, stream StreamName, start uint64, count int) ([]StreamEvent, error)
    ReadEventsBackwards(ctx context.Context, stream StreamName, start uint64, count int) ([]StreamEvent, error)
}

type EventWriter interface {
    AppendEvents(ctx context.Context, stream StreamName, expected ExpectedVersion, events []NewStreamEvent) (AppendResult, error)
}

type EventStore interface {
    EventReader
    EventWriter
    StreamExists(ctx context.Context, stream StreamName) (bool, error)
    DeleteStream(ctx context.Context, stream StreamName, expected ExpectedVersion) error
    TruncateStream(ctx context.Context, stream StreamName, position uint64, expected ExpectedVersion) error
}
```

## Loading and storing

Package-level functions handle the load/store cycle:

```go
// Functional path — load state directly
state, events, version, err := store.LoadState(ctx, reader, stream, fold, zero, eventuous.IsExisting)

// Aggregate path
agg, err := store.LoadAggregate(ctx, reader, stream, fold, zero)
result, err := store.StoreAggregate(ctx, writer, stream, agg)
```

## Optimistic concurrency

Every append specifies an expected version:

- `VersionNoStream` (-1) — stream must not exist
- `VersionAny` (-2) — no version check
- Positive value — stream must be at exactly this version

A version mismatch returns `ErrOptimisticConcurrency`.

## Stream naming

```go
stream := eventuous.NewStreamName("Booking", "123")
// → "Booking-123"

stream.Category() // "Booking"
stream.ID()       // "123"
```
