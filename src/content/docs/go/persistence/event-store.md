---
title: Event Store
sidebar:
  order: 1
---

The event store is the persistence layer for Event Sourcing. It stores events in streams, reads them back, and enforces optimistic concurrency to prevent conflicting writes.

Eventuous Go defines event store behavior through three interfaces, then provides package-level functions that compose those interfaces to handle common patterns like loading state and storing aggregates.

## The three interfaces

### EventReader

Reads events from a stream in forward or backward direction:

```go
type EventReader interface {
    ReadEvents(ctx context.Context, stream StreamName, start uint64, count int) ([]StreamEvent, error)
    ReadEventsBackwards(ctx context.Context, stream StreamName, start uint64, count int) ([]StreamEvent, error)
}
```

### EventWriter

Appends events to a stream with optimistic concurrency:

```go
type EventWriter interface {
    AppendEvents(ctx context.Context, stream StreamName, expected ExpectedVersion, events []NewStreamEvent) (AppendResult, error)
}
```

### EventStore

Combines reading and writing with stream management operations:

```go
type EventStore interface {
    EventReader
    EventWriter
    StreamExists(ctx context.Context, stream StreamName) (bool, error)
    DeleteStream(ctx context.Context, stream StreamName, expected ExpectedVersion) error
    TruncateStream(ctx context.Context, stream StreamName, position uint64, expected ExpectedVersion) error
}
```

### Why three interfaces?

Many components only need one capability. A subscription handler building a read model only needs to read events -- it never writes. A command service needs both reading and writing. By splitting the interfaces, you can depend on exactly what you need, making testing simpler and intent clearer.

In practice, concrete implementations like `kurrentdb.Store` implement the full `EventStore` interface, but your code can accept the narrower `EventReader` or `EventWriter` where appropriate.

## Stream naming

Eventuous follows a `{Category}-{ID}` convention for stream names:

```go
stream := eventuous.NewStreamName("Booking", "123")
// → "Booking-123"

stream.Category() // "Booking"
stream.ID()       // "123"
```

This convention is important because many event store features (like category projections in KurrentDB) rely on the category prefix. Streams in the same category share the same aggregate type.

The separator is `-`. If the stream name has no `-`, the entire name is treated as the category and `ID()` returns an empty string.

## Stream events

Events read from a stream come as `StreamEvent` values:

```go
type StreamEvent struct {
    ID             uuid.UUID
    EventType      string         // the registered type name
    Payload        any            // the deserialized event struct
    Metadata       Metadata       // correlation/causation IDs and custom headers
    ContentType    string         // e.g., "application/json"
    Position       int64          // position within the stream (0-based)
    GlobalPosition uint64         // position in the global log
    Created        time.Time      // when the event was written
}
```

Events written to a stream are `NewStreamEvent` values:

```go
type NewStreamEvent struct {
    ID       uuid.UUID      // event ID (auto-generated if nil)
    Payload  any            // the event struct
    Metadata Metadata       // optional metadata
}
```

## Optimistic concurrency

Every `AppendEvents` call specifies an `ExpectedVersion`. This is the core mechanism for preventing conflicting writes:

| Value | Meaning |
|-------|---------|
| `VersionNoStream` (-1) | The stream must not exist. Used for creation commands. |
| `VersionAny` (-2) | No version check. The append always succeeds. |
| Positive value (e.g., 2) | The stream must be at exactly this version. |

If the stream is at a different version than expected, the store returns `ErrOptimisticConcurrency`.

### How it prevents conflicts

Imagine two users simultaneously try to cancel the same booking. Both load the booking at version 5, both produce a `BookingCancelled` event, and both try to append at expected version 5.

The first write succeeds and advances the stream to version 6. The second write fails because the stream is now at version 6, not 5. The second command handler receives `ErrOptimisticConcurrency` and the caller can retry or report the conflict.

This is the same principle as an `If-Match` header in HTTP or a `WHERE version = ?` clause in SQL -- but built into the event store itself.

### When to use each

- **IsNew commands** (e.g., "book a room"): Use `VersionNoStream`. The stream must not exist because you're creating something new.
- **IsExisting commands** (e.g., "cancel a booking"): Use the version from the loaded state. This ensures no one else modified the booking between your read and write.
- **Idempotent operations** (e.g., importing data): Use `VersionAny` when you don't care about conflicts.

## Loading state

The `store.LoadState` function reads all events from a stream and folds them into state:

```go
state, events, version, err := store.LoadState(ctx, reader, stream, fold, zero, expected)
```

Parameters:
- `reader` -- an `EventReader` implementation
- `stream` -- the stream name to read from
- `fold` -- your fold function (`func(S, any) S`)
- `zero` -- the zero value of your state type
- `expected` -- how the stream is expected to behave

The `expected` parameter controls validation:

| ExpectedState | Stream exists | Stream doesn't exist |
|---------------|---------------|---------------------|
| `IsNew` | Returns error | Returns zero state, `VersionNoStream` |
| `IsExisting` | Returns folded state and version | Returns `ErrStreamNotFound` |
| `IsAny` | Returns folded state and version | Returns zero state, `VersionNoStream` |

## Loading aggregates

`store.LoadAggregate` creates an aggregate and populates it from a stream:

```go
agg, err := store.LoadAggregate(ctx, reader, stream, fold, zero)
```

This function:
1. Creates a new `Aggregate[S]` with the fold function and zero value
2. Calls `LoadState` with `IsAny` to read the stream
3. If events exist, calls `agg.Load(version, events)` to reconstruct state

The returned aggregate has its `OriginalVersion` set to the stream version (or -1 if the stream doesn't exist), and no pending changes.

## Storing aggregates

`store.StoreAggregate` persists an aggregate's pending changes:

```go
result, err := store.StoreAggregate(ctx, writer, stream, agg)
```

This function:
1. Gets the pending changes from `agg.Changes()`
2. Wraps each change in a `NewStreamEvent` with a new UUID
3. Calls `AppendEvents` with the aggregate's `OriginalVersion` for optimistic concurrency
4. Calls `agg.ClearChanges()` to reset the aggregate

If there are no pending changes, it returns a zero `AppendResult` without touching the store.

## Metadata

Events can carry metadata -- a map of string keys to arbitrary values:

```go
type Metadata map[string]any
```

Eventuous defines three well-known metadata keys:

| Key | Constant | Purpose |
|-----|----------|---------|
| `eventuous.correlation-id` | `MetaCorrelationID` | Groups related events across services |
| `eventuous.causation-id` | `MetaCausationID` | Links an event to the event that caused it |
| `eventuous.message-id` | `MetaMessageID` | Unique identifier for the message |

You can add metadata to events using the `Metadata` helpers:

```go
meta := eventuous.Metadata{}
meta = meta.WithCorrelationID("corr-123")
meta = meta.WithCausationID("cause-456")

event := store.NewStreamEvent{
    Payload:  RoomBooked{...},
    Metadata: meta,
}
```

The `With*` methods return new `Metadata` maps without modifying the original, following Go's convention for value types.

## Error handling

Eventuous uses sentinel errors with `errors.Is()` for error checking:

```go
result, err := writer.AppendEvents(ctx, stream, expected, events)
if errors.Is(err, eventuous.ErrOptimisticConcurrency) {
    // Another process modified the stream -- retry or report conflict
}
if errors.Is(err, eventuous.ErrStreamNotFound) {
    // The stream doesn't exist
}
```

Available sentinel errors:

| Error | When it occurs |
|-------|---------------|
| `ErrStreamNotFound` | Reading from a stream that doesn't exist |
| `ErrOptimisticConcurrency` | Appending with a wrong expected version |
| `ErrAggregateNotFound` | Loading an aggregate that doesn't exist (when IsExisting is expected) |
| `ErrHandlerNotFound` | Dispatching a command with no registered handler |

## Available implementations

| Implementation | Module | Notes |
|---------------|--------|-------|
| **KurrentDB** | `github.com/eventuous/eventuous-go/kurrentdb` | Production-ready. Full `EventStore` interface. See [KurrentDB docs](../infra/kurrentdb/). |
| **In-memory** | `github.com/eventuous/eventuous-go/core/test/memstore` | Thread-safe in-memory store for unit testing. Full `EventStore` interface. |

### Using the in-memory store for testing

```go
import "github.com/eventuous/eventuous-go/core/test/memstore"

func TestBookingService(t *testing.T) {
    es := memstore.New()
    svc := command.New[BookingState](es, es, bookingFold, BookingState{})
    // ... register handlers and test ...
}
```

The in-memory store is thread-safe, requires no infrastructure, and implements the full `EventStore` interface including optimistic concurrency checks. It is ideal for unit testing command handlers.
