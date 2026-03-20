---
title: Subscriptions
sidebar:
  order: 1
---

Subscriptions consume events from an event store in real time. They are the bridge between the write side (command services producing events) and the read side (projections, notifications, integration with other systems).

## Why subscriptions?

In an Event Sourcing system, the event store is the source of truth. But most applications need more than just an event log. They need:

- **Read models** -- denormalized views optimized for queries (e.g., a list of active bookings)
- **Integration** -- notifying other services when something happens (e.g., sending a confirmation email when a room is booked)
- **Process managers** -- orchestrating multi-step workflows triggered by events

Subscriptions provide the mechanism for all of these. A subscription reads events as they are appended to the store and passes them to your handler for processing.

## The Subscription interface

```go
type Subscription interface {
    Start(ctx context.Context) error
}
```

`Start` blocks until the context is cancelled or a fatal error occurs. This is the entire interface -- subscriptions are started and run until shutdown. Implementations (like KurrentDB catch-up or persistent subscriptions) handle the details of connecting, reading, and managing position.

## EventHandler interface

Handlers process individual events. The interface is minimal:

```go
type EventHandler interface {
    HandleEvent(ctx context.Context, msg *ConsumeContext) error
}
```

Return `nil` to indicate success. Return an error to indicate failure (behavior depends on the subscription type -- catch-up subscriptions typically stop, persistent subscriptions nack and retry).

### HandlerFunc adaptor

For simple handlers, use `HandlerFunc` -- just like `http.HandlerFunc`:

```go
handler := subscription.HandlerFunc(
    func(ctx context.Context, msg *subscription.ConsumeContext) error {
        switch e := msg.Payload.(type) {
        case RoomBooked:
            log.Printf("Room %s booked", e.RoomID)
        case BookingCancelled:
            log.Printf("Booking %s cancelled: %s", e.BookingID, e.Reason)
        }
        return nil
    },
)
```

## ConsumeContext

Every event delivered to a handler comes wrapped in a `ConsumeContext`:

```go
type ConsumeContext struct {
    EventID        uuid.UUID        // unique ID of the event
    EventType      string           // registered type name (e.g., "RoomBooked")
    Stream         StreamName       // the stream the event belongs to
    Payload        any              // deserialized event struct, nil if type is unknown
    Metadata       Metadata         // correlation/causation IDs and custom headers
    ContentType    string           // e.g., "application/json"
    Position       uint64           // position in the source stream
    GlobalPosition uint64           // position in the global log ($all)
    Sequence       uint64           // local sequence number within this subscription
    Created        time.Time        // when the event was written
    SubscriptionID string           // the subscription's identifier
}
```

The `Payload` field contains the deserialized event struct. If the codec couldn't decode the event (e.g., an unregistered type), `Payload` is `nil` but the event is still delivered -- this lets your handler decide what to do with unknown events rather than silently dropping them.

The `Sequence` field is a monotonically increasing counter within the subscription, used by the checkpoint committer for gap detection.

## Middleware

Middleware wraps handlers with additional behavior, using the same pattern as `net/http`. A middleware is a function that takes a handler and returns a handler:

```go
type Middleware func(EventHandler) EventHandler
```

### Chain

`Chain` composes middleware and a handler together:

```go
handler := subscription.Chain(myHandler,
    subscription.WithLogging(slog.Default()),
    subscription.WithConcurrency(4),
)
```

Middleware is applied from left to right. `Chain(h, A, B)` produces `A(B(h))`, so execution flows through A first, then B, then the handler.

### Built-in middleware

#### WithLogging

Logs event processing at debug level using `slog`:

```go
subscription.WithLogging(slog.Default())
```

Logs "handling event" before processing and "event handled" or "event handler error" after. Useful for development and debugging.

#### WithConcurrency

Processes events concurrently up to a limit:

```go
subscription.WithConcurrency(4)
```

Uses a semaphore channel internally. When 4 events are already being processed, the next event blocks until one completes. Errors are propagated back correctly -- the subscription still knows whether each event succeeded or failed.

:::caution
Concurrent processing means events may be handled out of order. If your handler depends on event ordering (e.g., a projection that needs to see `RoomBooked` before `PaymentRecorded`), do not use `WithConcurrency` alone. Use `WithPartitioning` instead.
:::

#### WithPartitioning

Distributes events across N goroutines by a partition key:

```go
// Partition by stream name (default if keyFunc is nil)
subscription.WithPartitioning(8, nil)

// Custom partition key
subscription.WithPartitioning(8, func(msg *subscription.ConsumeContext) string {
    return msg.Stream.Category()
})
```

Events with the same partition key always go to the same goroutine, preserving order within a partition. Different partitions are processed concurrently.

The default key function uses the stream name, which means all events for the same aggregate are processed in order. This is the most common partitioning strategy.

Partition goroutines are started lazily on the first event and run until the context is cancelled.

### When to use concurrency vs. partitioning

| Scenario | Recommendation |
|----------|---------------|
| Handler is order-independent (e.g., sending notifications) | `WithConcurrency(n)` |
| Handler needs order within a stream (e.g., projection) | `WithPartitioning(n, nil)` |
| Handler needs order within a category | `WithPartitioning(n, categoryKeyFunc)` |
| Handler is fast and simple | No middleware needed |

### Custom middleware

Write your own middleware by following the `Middleware` signature:

```go
func WithMetrics(counter *prometheus.Counter) subscription.Middleware {
    return func(next subscription.EventHandler) subscription.EventHandler {
        return subscription.HandlerFunc(
            func(ctx context.Context, msg *subscription.ConsumeContext) error {
                err := next.HandleEvent(ctx, msg)
                if err == nil {
                    counter.Inc()
                }
                return err
            },
        )
    }
}
```

## Complete example: building a projection

Here is a handler that builds an in-memory read model from booking events:

```go
type BookingReadModel struct {
    mu       sync.Mutex
    bookings map[string]BookingSummary
}

type BookingSummary struct {
    ID     string
    RoomID string
    Active bool
    Paid   float64
}

func (rm *BookingReadModel) Handler() subscription.EventHandler {
    return subscription.HandlerFunc(
        func(ctx context.Context, msg *subscription.ConsumeContext) error {
            rm.mu.Lock()
            defer rm.mu.Unlock()

            switch e := msg.Payload.(type) {
            case RoomBooked:
                rm.bookings[e.BookingID] = BookingSummary{
                    ID: e.BookingID, RoomID: e.RoomID, Active: true,
                }
            case PaymentRecorded:
                if b, ok := rm.bookings[e.BookingID]; ok {
                    b.Paid += e.Amount
                    rm.bookings[e.BookingID] = b
                }
            case BookingCancelled:
                if b, ok := rm.bookings[e.BookingID]; ok {
                    b.Active = false
                    rm.bookings[e.BookingID] = b
                }
            }
            return nil
        },
    )
}
```

Wire it up with a KurrentDB subscription:

```go
readModel := &BookingReadModel{bookings: make(map[string]BookingSummary)}

sub := kdb.NewCatchUp(client, jsonCodec, "BookingReadModel",
    kdb.FromAll(),
    kdb.WithHandler(readModel.Handler()),
    kdb.WithCheckpointStore(checkpointStore),
    kdb.WithMiddleware(
        subscription.WithLogging(slog.Default()),
        subscription.WithPartitioning(4, nil),
    ),
)

// Run in a goroutine; blocks until ctx is cancelled
go func() {
    if err := sub.Start(ctx); err != nil {
        slog.Error("subscription stopped", "error", err)
    }
}()
```
