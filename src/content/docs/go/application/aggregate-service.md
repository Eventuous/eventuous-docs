---
title: Aggregate Service
sidebar:
  order: 2
---

The aggregate service is an alternative to the [functional command service](../command-service/) for teams that prefer working with the DDD aggregate pattern. Instead of pure functions that return events, handlers receive an aggregate and call `Apply` to record events.

## When to use the aggregate service

The aggregate service makes sense when:

- You want explicit guards (`EnsureNew`, `EnsureExists`) as part of your domain language
- A single command can produce multiple events and you want to interleave logic between them
- Your team is familiar with the DDD tactical patterns and finds aggregates clearer

The functional service is often more concise for simple handlers. Choose based on what makes your code most readable.

## Creating an aggregate service

```go
import (
    "github.com/eventuous/eventuous-go/core/command"
    "github.com/eventuous/eventuous-go/core/store"
)

svc := command.NewAggregateService[BookingState](reader, writer, bookingFold, BookingState{})
```

The constructor is the same as the functional service: reader, writer, fold function, and zero value. The difference is in how handlers are registered and how they work.

## Registering handlers

Handlers are registered with `command.OnAggregate`:

```go
import (
    "context"
    eventuous "github.com/eventuous/eventuous-go/core"
    "github.com/eventuous/eventuous-go/core/aggregate"
    "github.com/eventuous/eventuous-go/core/command"
)

command.OnAggregate(svc, command.AggregateHandler[BookRoom, BookingState]{
    Expected: eventuous.IsNew,
    ID: func(cmd BookRoom) string {
        return cmd.BookingID
    },
    Act: func(ctx context.Context, agg *aggregate.Aggregate[BookingState], cmd BookRoom) error {
        agg.Apply(RoomBooked{
            BookingID: cmd.BookingID,
            RoomID:    cmd.RoomID,
            Price:     cmd.Price,
        })
        return nil
    },
})
```

### AggregateHandler fields

| Field | Type | Description |
|-------|------|-------------|
| `Expected` | `ExpectedState` | `IsNew`, `IsExisting`, or `IsAny` -- how the aggregate should exist |
| `ID` | `func(C) string` | Extracts the entity ID from the command |
| `Act` | `func(ctx, *Aggregate[S], C) error` | Applies domain logic to the aggregate |

### Key differences from functional handlers

**ID instead of Stream.** The aggregate service derives the stream name automatically from the state type name and the ID. For `BookingState` with ID `"123"`, the stream name becomes `"BookingState-123"`. You provide just the ID extractor.

**Act receives an aggregate, not state.** Your handler gets the full `*Aggregate[S]` and records events by calling `agg.Apply()` rather than returning a slice of events.

**Act returns only error.** Events are recorded through `agg.Apply()`, so the return value is just an error (or nil for success).

### Automatic guard enforcement

The aggregate service enforces `ExpectedState` before calling your handler:

- `IsNew`: calls `agg.EnsureNew()` -- returns error if the aggregate already exists
- `IsExisting`: calls `agg.EnsureExists()` -- returns error if the aggregate doesn't exist
- `IsAny`: no guard

You can still call `EnsureNew`/`EnsureExists` in your handler for extra safety, but the service handles it automatically.

## The Handle pipeline

The aggregate service pipeline differs from the functional service:

```
Handle(ctx, BookRoom{BookingID: "123", RoomID: "42"})
  │
  ├─ 1. Lookup handler for type BookRoom → found
  ├─ 2. handler.ID(cmd) → "123"
  ├─ 3. Build stream name: "BookingState-123"
  ├─ 4. store.LoadAggregate(ctx, reader, stream, fold, zero)
  ├─ 5. Enforce expected state (EnsureNew/EnsureExists)
  ├─ 6. handler.Act(ctx, agg, cmd)
  │     └─ Handler calls agg.Apply(RoomBooked{...})
  ├─ 7. If no changes on aggregate, return current state (no-op)
  ├─ 8. store.StoreAggregate(ctx, writer, stream, agg)
  └─ 9. Return Result[S]
```

:::caution
The stream name is derived from the Go type name of the state struct. If you rename `BookingState` to `HotelBookingState`, the stream category changes from `"BookingState"` to `"HotelBookingState"`. This would make existing streams unreachable. Be deliberate about your state type names.
:::

## Complete example

```go
func NewBookingAggregateService(es store.EventStore) *command.AggregateService[BookingState] {
    svc := command.NewAggregateService[BookingState](es, es, BookingFold, BookingState{})

    command.OnAggregate(svc, command.AggregateHandler[BookRoom, BookingState]{
        Expected: eventuous.IsNew,
        ID:       func(cmd BookRoom) string { return cmd.BookingID },
        Act: func(ctx context.Context, agg *aggregate.Aggregate[BookingState], cmd BookRoom) error {
            agg.Apply(RoomBooked{
                BookingID: cmd.BookingID,
                RoomID:    cmd.RoomID,
                CheckIn:   cmd.CheckIn,
                CheckOut:  cmd.CheckOut,
                Price:     cmd.Price,
            })
            return nil
        },
    })

    command.OnAggregate(svc, command.AggregateHandler[RecordPayment, BookingState]{
        Expected: eventuous.IsExisting,
        ID:       func(cmd RecordPayment) string { return cmd.BookingID },
        Act: func(ctx context.Context, agg *aggregate.Aggregate[BookingState], cmd RecordPayment) error {
            state := agg.State()
            if !state.Active {
                return fmt.Errorf("cannot record payment: booking is not active")
            }
            if state.AmountPaid+cmd.Amount > state.Price {
                return fmt.Errorf("payment exceeds remaining balance")
            }
            agg.Apply(PaymentRecorded{BookingID: cmd.BookingID, Amount: cmd.Amount})
            return nil
        },
    })

    command.OnAggregate(svc, command.AggregateHandler[CancelBooking, BookingState]{
        Expected: eventuous.IsExisting,
        ID:       func(cmd CancelBooking) string { return cmd.BookingID },
        Act: func(ctx context.Context, agg *aggregate.Aggregate[BookingState], cmd CancelBooking) error {
            if !agg.State().Active {
                return fmt.Errorf("booking is already inactive")
            }
            agg.Apply(BookingCancelled{BookingID: cmd.BookingID, Reason: cmd.Reason})
            return nil
        },
    })

    return svc
}
```

## Functional vs. aggregate: comparison

| Aspect | Functional service | Aggregate service |
|--------|-------------------|-------------------|
| Handler receives | `(ctx, state, cmd)` | `(ctx, *Aggregate[S], cmd)` |
| Handler returns | `([]any, error)` | `error` |
| Event production | Return a slice | Call `agg.Apply()` |
| Stream name | Explicit via `Stream` func | Auto from state type name + ID |
| Guards | Via `ExpectedState` only | `ExpectedState` + `EnsureNew`/`EnsureExists` |
| State access | Direct parameter | `agg.State()` |
| Multiple events per command | Build a slice | Call `Apply` multiple times |
| Side-effect free | Yes (pure function) | Yes (but through mutation of aggregate) |

Both approaches use the same state type, fold function, and produce the same result type. You can even use both in the same application for different bounded contexts.
