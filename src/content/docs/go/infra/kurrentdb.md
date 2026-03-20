---
title: KurrentDB
sidebar:
  order: 1
---

[KurrentDB](https://kurrent.io) (formerly EventStoreDB) is an event-native database built specifically for Event Sourcing. It stores events in streams, supports real-time subscriptions, and provides powerful projections. The Eventuous Go `kurrentdb` module provides a complete integration.

## Installation

```bash
go get github.com/eventuous/eventuous-go/kurrentdb
```

This brings in the KurrentDB Go client as a transitive dependency.

## Running KurrentDB

For development, run KurrentDB in Docker:

```bash
docker run -d --name kurrentdb \
  -p 2113:2113 \
  docker.kurrent.io/kurrent-latest/kurrent:latest \
  --insecure --run-projections=All
```

The admin UI is available at `http://localhost:2113`. The `--insecure` flag disables TLS for local development. The `--run-projections=All` flag enables system projections (needed for `$all` stream subscriptions with filters).

## Connecting

```go
import "github.com/kurrent-io/KurrentDB-Client-Go/kurrentdb"

settings, err := kurrentdb.ParseConnectionString("kurrentdb://localhost:2113?tls=false")
if err != nil {
    log.Fatal(err)
}

client, err := kurrentdb.NewClient(settings)
if err != nil {
    log.Fatal(err)
}
```

The connection string supports multiple nodes for clustering:

```
kurrentdb://node1:2113,node2:2113,node3:2113?tls=true
```

## Event store

Create a KurrentDB-backed event store:

```go
import kdb "github.com/eventuous/eventuous-go/kurrentdb"

store := kdb.NewStore(client, jsonCodec)
```

The `Store` implements the full `store.EventStore` interface:

| Operation | What it does |
|-----------|-------------|
| `AppendEvents` | Appends events with optimistic concurrency |
| `ReadEvents` | Reads events forward from a position |
| `ReadEventsBackwards` | Reads events backward from a position |
| `StreamExists` | Checks if a stream has at least one event |
| `DeleteStream` | Soft-deletes a stream |
| `TruncateStream` | Sets TruncateBefore metadata so old events are no longer returned |

The store handles encoding/decoding events using the provided codec, and maps between Eventuous version semantics and KurrentDB stream states.

### Optimistic concurrency mapping

| Eventuous | KurrentDB |
|-----------|-----------|
| `VersionNoStream` (-1) | `NoStream{}` |
| `VersionAny` (-2) | `Any{}` |
| Positive value | `StreamRevision{Value: n}` |

A version mismatch from KurrentDB is wrapped as `ErrOptimisticConcurrency` so your code uses the standard `errors.Is()` pattern.

## Catch-up subscriptions

Catch-up subscriptions read historical events and then continue in real time as new events arrive. They are the most common subscription type, used for projections and event-driven processing.

### Basic usage

```go
sub := kdb.NewCatchUp(client, jsonCodec, "BookingProjection",
    kdb.FromAll(),
    kdb.WithHandler(handler),
    kdb.WithCheckpointStore(checkpointStore),
)

// Blocks until ctx is cancelled
err := sub.Start(ctx)
```

The subscription:
1. Loads the last checkpoint position (if a checkpoint store is provided)
2. Subscribes to KurrentDB starting after that position
3. For each event: decodes it, wraps it in a `ConsumeContext`, and passes it to the handler
4. After successful handling, stores the updated checkpoint
5. Continues until the context is cancelled or a fatal error occurs

System events (types starting with `$`) are automatically skipped.

### Subscribing to a specific stream

```go
sub := kdb.NewCatchUp(client, jsonCodec, "BookingDetailView",
    kdb.FromStream(eventuous.NewStreamName("Booking", "123")),
    kdb.WithHandler(handler),
)
```

### Subscribing to $all with a filter

For `$all` subscriptions, you can add a server-side filter to receive only events from specific stream prefixes:

```go
sub := kdb.NewCatchUp(client, jsonCodec, "AllBookings",
    kdb.FromAll(),
    kdb.WithFilter(kurrentdb.ExcludeSystemEventsFilter()),
    kdb.WithHandler(handler),
    kdb.WithCheckpointStore(checkpointStore),
)
```

Server-side filtering is more efficient than client-side filtering because events that don't match the filter are never sent over the network.

### Options reference

| Option | Description |
|--------|-------------|
| `FromStream(name)` | Subscribe to a single stream |
| `FromAll()` | Subscribe to the `$all` stream (default) |
| `WithHandler(h)` | Set the event handler (required) |
| `WithCheckpointStore(cs)` | Persist positions for resume after restart |
| `WithMiddleware(mw...)` | Apply middleware (logging, concurrency, etc.) |
| `WithResolveLinkTos(bool)` | Resolve link events to their targets |
| `WithFilter(filter)` | Server-side event filter (for `$all` only) |

### Adding middleware

```go
sub := kdb.NewCatchUp(client, jsonCodec, "BookingProjection",
    kdb.FromAll(),
    kdb.WithHandler(handler),
    kdb.WithCheckpointStore(checkpointStore),
    kdb.WithMiddleware(
        subscription.WithLogging(slog.Default()),
        subscription.WithPartitioning(4, nil),
    ),
)
```

Middleware is applied through `subscription.Chain` internally, so the first middleware in the list is the outermost.

## Persistent subscriptions

Persistent subscriptions are server-managed. KurrentDB tracks the position (no client-side checkpointing needed) and supports competing consumers -- multiple instances can process events from the same subscription group, with the server distributing events between them.

### Basic usage

```go
sub := kdb.NewPersistent(client, jsonCodec, "PaymentProcessor",
    kdb.PersistentFromAll(),
    kdb.PersistentWithHandler(handler),
)

err := sub.Start(ctx)
```

### Ack/nack behavior

- **Handler returns nil** -- the event is **acknowledged** and won't be delivered again
- **Handler returns error** -- the event is **nacked** with retry action, meaning KurrentDB will redeliver it

```go
handler := subscription.HandlerFunc(
    func(ctx context.Context, msg *subscription.ConsumeContext) error {
        err := processEvent(msg)
        if err != nil {
            // Returning error triggers nack + retry
            return fmt.Errorf("processing failed: %w", err)
        }
        // Returning nil triggers ack
        return nil
    },
)
```

### Auto-create consumer group

The persistent subscription automatically creates the consumer group if it doesn't exist. If it already exists (from a previous run or another instance), it connects to the existing group. This makes deployments simpler -- no manual setup required.

### Options reference

| Option | Description |
|--------|-------------|
| `PersistentFromStream(name)` | Subscribe to a single stream |
| `PersistentFromAll()` | Subscribe to the `$all` stream |
| `PersistentWithHandler(h)` | Set the event handler (required) |
| `PersistentWithMiddleware(mw...)` | Apply middleware |
| `PersistentWithBufferSize(n)` | Set the connection buffer size |
| `PersistentWithFilter(filter)` | Server-side filter (for `$all` only) |

## Catch-up vs. persistent: when to use which

| Aspect | Catch-up | Persistent |
|--------|----------|------------|
| Position tracking | Client-side (checkpoint store) | Server-side (KurrentDB manages) |
| Competing consumers | Not supported | Supported (multiple instances share work) |
| Failure handling | Subscription stops on error | Nack + retry per event |
| Control over position | Full (can rewind by resetting checkpoint) | Limited (server-managed) |
| Use case | Projections, event handlers | Distributed processing, work queues |

**Use catch-up subscriptions** when you need full control over position tracking, want to rebuild projections by resetting checkpoints, or when ordering guarantees matter.

**Use persistent subscriptions** when you need competing consumers (horizontal scaling), want the server to handle retry logic, or when at-least-once delivery per event is sufficient.

## Complete example: event store + catch-up subscription

```go
package main

import (
    "context"
    "fmt"
    "log/slog"
    "os/signal"
    "syscall"

    "github.com/kurrent-io/KurrentDB-Client-Go/kurrentdb"

    eventuous "github.com/eventuous/eventuous-go/core"
    "github.com/eventuous/eventuous-go/core/codec"
    "github.com/eventuous/eventuous-go/core/command"
    "github.com/eventuous/eventuous-go/core/subscription"
    kdb "github.com/eventuous/eventuous-go/kurrentdb"
)

func main() {
    ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
    defer stop()

    // Connect to KurrentDB
    settings, _ := kurrentdb.ParseConnectionString("kurrentdb://localhost:2113?tls=false")
    client, _ := kurrentdb.NewClient(settings)

    // Create codec with registered types
    types := codec.NewTypeMap()
    codec.Register[RoomBooked](types, "RoomBooked")
    codec.Register[BookingCancelled](types, "BookingCancelled")
    jsonCodec := codec.NewJSON(types)

    // Create event store
    store := kdb.NewStore(client, jsonCodec)

    // Create command service
    svc := command.New[BookingState](store, store, bookingFold, BookingState{})
    command.On(svc, command.Handler[BookRoom, BookingState]{
        Expected: eventuous.IsNew,
        Stream: func(cmd BookRoom) eventuous.StreamName {
            return eventuous.NewStreamName("Booking", cmd.BookingID)
        },
        Act: func(ctx context.Context, state BookingState, cmd BookRoom) ([]any, error) {
            return []any{RoomBooked{BookingID: cmd.BookingID, RoomID: cmd.RoomID}}, nil
        },
    })

    // Handle a command
    result, _ := svc.Handle(ctx, BookRoom{BookingID: "b-1", RoomID: "r-42"})
    fmt.Printf("Booked: %+v\n", result.State)

    // Start a subscription in the background
    handler := subscription.HandlerFunc(
        func(ctx context.Context, msg *subscription.ConsumeContext) error {
            slog.Info("Event received", "type", msg.EventType, "stream", msg.Stream)
            return nil
        },
    )
    sub := kdb.NewCatchUp(client, jsonCodec, "DemoProjection",
        kdb.FromAll(),
        kdb.WithHandler(handler),
        kdb.WithMiddleware(subscription.WithLogging(slog.Default())),
    )

    // Block until SIGINT/SIGTERM
    if err := sub.Start(ctx); err != nil {
        slog.Error("subscription stopped", "error", err)
    }
}
```

## Testing with testcontainers

For integration tests, use testcontainers-go to start KurrentDB automatically:

```go
import (
    "context"
    "testing"

    "github.com/testcontainers/testcontainers-go"
    "github.com/testcontainers/testcontainers-go/wait"
    "github.com/kurrent-io/KurrentDB-Client-Go/kurrentdb"
)

func setupClient(t *testing.T) *kurrentdb.Client {
    t.Helper()
    ctx := context.Background()

    container, err := testcontainers.GenericContainer(ctx, testcontainers.GenericContainerRequest{
        ContainerRequest: testcontainers.ContainerRequest{
            Image:        "docker.kurrent.io/kurrent-latest/kurrent:latest",
            ExposedPorts: []string{"2113/tcp"},
            Cmd:          []string{"--insecure", "--run-projections=All"},
            WaitingFor:   wait.ForHTTP("/health/live").WithPort("2113/tcp"),
        },
        Started: true,
    })
    if err != nil {
        t.Fatal(err)
    }
    t.Cleanup(func() { container.Terminate(ctx) })

    endpoint, _ := container.Endpoint(ctx, "")
    connStr := fmt.Sprintf("kurrentdb://%s?tls=false", endpoint)
    settings, _ := kurrentdb.ParseConnectionString(connStr)
    client, _ := kurrentdb.NewClient(settings)
    return client
}
```

This lets your CI pipeline run integration tests without requiring a pre-configured KurrentDB instance. The container starts, tests run, and the container is cleaned up automatically.
