---
title: KurrentDB
sidebar:
  order: 1
---

# KurrentDB

KurrentDB (formerly EventStoreDB) integration for Eventuous Go.

## Installation

```bash
go get github.com/eventuous/eventuous-go/kurrentdb
```

## Event store

```go
import "github.com/kurrent-io/KurrentDB-Client-Go/kurrentdb"
import kdb "github.com/eventuous/eventuous-go/kurrentdb"

settings, _ := kurrentdb.ParseConnectionString("kurrentdb://localhost:2113?tls=false")
client, _ := kurrentdb.NewClient(settings)

store := kdb.NewStore(client, jsonCodec)
```

The store implements the full `EventStore` interface: append, read forward/backward, delete, and truncate.

## Catch-up subscriptions

Subscribe to a specific stream or to `$all`:

```go
sub := kdb.NewCatchUp(client, jsonCodec, "MyProjection",
    kdb.FromStream(eventuous.NewStreamName("Booking", "123")),
    kdb.WithHandler(myHandler),
    kdb.WithCheckpointStore(checkpointStore),
    kdb.WithMiddleware(
        subscription.WithLogging(slog.Default()),
    ),
)

// Blocks until context is cancelled
err := sub.Start(ctx)
```

### Options

| Option | Description |
|--------|-------------|
| `FromStream(name)` | Subscribe to a specific stream |
| `FromAll()` | Subscribe to the `$all` stream |
| `WithHandler(h)` | Set the event handler |
| `WithCheckpointStore(cs)` | Enable checkpointing |
| `WithMiddleware(mw...)` | Apply middleware |
| `WithResolveLinkTos(bool)` | Resolve link events |
| `WithFilter(filter)` | Server-side event filter (for `$all`) |

## Persistent subscriptions

Server-managed subscriptions with ack/nack:

```go
sub := kdb.NewPersistent(client, jsonCodec, "MyGroup",
    kdb.PersistentFromStream(eventuous.NewStreamName("Booking", "123")),
    kdb.PersistentWithHandler(myHandler),
)

err := sub.Start(ctx)
```

- Returns `nil` from handler — event is **acked**
- Returns `error` from handler — event is **nacked** and retried
- Consumer group is auto-created if it doesn't exist
