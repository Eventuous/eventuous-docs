---
title: Command Service
sidebar:
  order: 1
---

A command service is the entry point for executing business operations in an Event Sourcing system. It handles the full lifecycle: loading the current state, executing business logic, and persisting the resulting events.

The **functional command service** is the primary approach in Eventuous Go. It works with pure functions -- no aggregates involved. State goes in, events come out.

## The concept

When a user submits a command like "book a room" or "cancel a booking," the command service performs this pipeline:

1. **Look up** the registered handler for the command type
2. **Get the stream name** from the command (e.g., `"Booking-123"`)
3. **Load the current state** from the event store by reading and folding all events in that stream
4. **Execute the handler** -- a pure function that receives the current state and command, and returns new events
5. **Append the new events** to the stream with optimistic concurrency
6. **Fold the new events** into the state and return the result

This pipeline is the same for every command. You only write the handler function (step 4). The rest is handled by the framework.

## Creating a service

```go
import (
    "github.com/eventuous/eventuous-go/core/command"
    "github.com/eventuous/eventuous-go/core/store"
)

svc := command.New[BookingState](reader, writer, bookingFold, BookingState{})
```

The type parameter `BookingState` is the state type for this service. All handlers registered on this service share the same state type, fold function, and zero value.

Parameters:
- `reader` -- a `store.EventReader` for loading events
- `writer` -- a `store.EventWriter` for appending events
- `bookingFold` -- the fold function (`func(BookingState, any) BookingState`)
- `BookingState{}` -- the zero value used as the initial state for new streams

In most cases, you pass the same event store as both reader and writer:

```go
es := kdb.NewStore(client, jsonCodec)
svc := command.New[BookingState](es, es, bookingFold, BookingState{})
```

## Registering handlers

Handlers are registered with `command.On`:

```go
command.On(svc, command.Handler[BookRoom, BookingState]{
    Expected: eventuous.IsNew,
    Stream: func(cmd BookRoom) eventuous.StreamName {
        return eventuous.NewStreamName("Booking", cmd.BookingID)
    },
    Act: func(ctx context.Context, state BookingState, cmd BookRoom) ([]any, error) {
        return []any{
            RoomBooked{
                BookingID: cmd.BookingID,
                RoomID:    cmd.RoomID,
                Price:     cmd.Price,
            },
        }, nil
    },
})
```

The `Handler` struct has two type parameters: the command type `C` and the state type `S`. Let's look at each field.

### Expected

Controls how the stream is expected to exist when the command is handled:

| Value | Meaning | Use case |
|-------|---------|----------|
| `eventuous.IsNew` | Stream must not exist | Creation commands (booking a room, opening an account) |
| `eventuous.IsExisting` | Stream must exist | Mutation commands (recording a payment, cancelling a booking) |
| `eventuous.IsAny` | Stream may or may not exist | Import or upsert-style commands |

When `IsNew` is specified and the stream already exists, the service returns an error before your handler is called. When `IsExisting` is specified and the stream doesn't exist, it returns `ErrStreamNotFound`.

### Stream

A function that extracts the stream name from the command:

```go
Stream: func(cmd BookRoom) eventuous.StreamName {
    return eventuous.NewStreamName("Booking", cmd.BookingID)
}
```

This determines which event stream the command operates on. The stream name follows the `{Category}-{ID}` convention. Different handlers for the same service can target different streams, though in practice they usually share the same category.

### Act

The business logic. A pure function that receives the current state and the command, and returns new events:

```go
Act: func(ctx context.Context, state BookingState, cmd BookRoom) ([]any, error) {
    return []any{
        RoomBooked{BookingID: cmd.BookingID, RoomID: cmd.RoomID, Price: cmd.Price},
    }, nil
}
```

Key points about the Act function:
- It receives the **current state** after folding all existing events. For `IsNew` commands, this is the zero value.
- It returns a **slice of events** to append. These are domain events, not stream events.
- It can return an **error** to reject the command. When an error is returned, no events are persisted.
- It can return an **empty slice** and no error, which is a no-op -- the command succeeds but no events are produced.
- The `context.Context` is available for operations that need it, but the function should remain side-effect free in its business logic.

## Handling commands

Dispatch a command with `Handle`:

```go
result, err := svc.Handle(ctx, BookRoom{
    BookingID: "booking-1",
    RoomID:    "room-42",
    Price:     200.00,
})
```

### Result

On success, `Handle` returns a `Result[S]`:

```go
type Result[S any] struct {
    State          S       // the updated state (after folding new events)
    NewEvents      []any   // the events that were produced
    GlobalPosition uint64  // the position in the global log
    StreamVersion  int64   // the new stream version
}
```

If the handler returns no events (empty slice, nil error), the result contains the current state with `NewEvents` set to nil. No events are appended to the store.

### Error handling

The service can return errors at several points:

| Error | Cause |
|-------|-------|
| `ErrHandlerNotFound` | No handler registered for the command type |
| `ErrStreamNotFound` | `IsExisting` was specified but the stream doesn't exist |
| Stream already exists | `IsNew` was specified but the stream already exists |
| Handler error | Your Act function returned an error |
| `ErrOptimisticConcurrency` | Another process modified the stream between load and store |

For optimistic concurrency errors, the typical strategy is to retry the entire command. Since the handler is a pure function, retrying is safe -- the command service will re-load the latest state and re-execute the handler:

```go
result, err := svc.Handle(ctx, cmd)
if errors.Is(err, eventuous.ErrOptimisticConcurrency) {
    // Retry: re-loads state and re-executes handler
    result, err = svc.Handle(ctx, cmd)
}
```

## The Handle pipeline in detail

Understanding the internal pipeline helps with debugging:

```
Handle(ctx, BookRoom{BookingID: "123", RoomID: "42"})
  │
  ├─ 1. Lookup handler for type BookRoom → found
  ├─ 2. handler.Stream(cmd) → "Booking-123"
  ├─ 3. store.LoadState(ctx, reader, "Booking-123", fold, zero, IsNew)
  │     └─ Stream doesn't exist → state = BookingState{}, version = -1
  ├─ 4. handler.Act(ctx, BookingState{}, cmd) → [RoomBooked{...}]
  ├─ 5. Events not empty, proceed to append
  ├─ 6. writer.AppendEvents(ctx, "Booking-123", VersionNoStream, events)
  │     └─ Success → global position 42, next version 0
  ├─ 7. Fold new events: fold(BookingState{}, RoomBooked{...})
  └─ 8. Return Result{State: BookingState{Active: true}, NewEvents: [...], ...}
```

## Complete example with multiple handlers

```go
func NewBookingService(es store.EventStore) *command.Service[BookingState] {
    svc := command.New[BookingState](es, es, BookingFold, BookingState{})

    command.On(svc, command.Handler[BookRoom, BookingState]{
        Expected: eventuous.IsNew,
        Stream:   func(cmd BookRoom) eventuous.StreamName {
            return eventuous.NewStreamName("Booking", cmd.BookingID)
        },
        Act: func(ctx context.Context, state BookingState, cmd BookRoom) ([]any, error) {
            return []any{
                RoomBooked{
                    BookingID: cmd.BookingID,
                    RoomID:    cmd.RoomID,
                    CheckIn:   cmd.CheckIn,
                    CheckOut:  cmd.CheckOut,
                    Price:     cmd.Price,
                },
            }, nil
        },
    })

    command.On(svc, command.Handler[RecordPayment, BookingState]{
        Expected: eventuous.IsExisting,
        Stream:   func(cmd RecordPayment) eventuous.StreamName {
            return eventuous.NewStreamName("Booking", cmd.BookingID)
        },
        Act: func(ctx context.Context, state BookingState, cmd RecordPayment) ([]any, error) {
            if !state.Active {
                return nil, fmt.Errorf("cannot record payment: booking is not active")
            }
            if state.AmountPaid+cmd.Amount > state.Price {
                return nil, fmt.Errorf("payment of %.2f would exceed remaining balance of %.2f",
                    cmd.Amount, state.Price-state.AmountPaid)
            }
            return []any{
                PaymentRecorded{BookingID: cmd.BookingID, Amount: cmd.Amount},
            }, nil
        },
    })

    command.On(svc, command.Handler[CancelBooking, BookingState]{
        Expected: eventuous.IsExisting,
        Stream:   func(cmd CancelBooking) eventuous.StreamName {
            return eventuous.NewStreamName("Booking", cmd.BookingID)
        },
        Act: func(ctx context.Context, state BookingState, cmd CancelBooking) ([]any, error) {
            if !state.Active {
                return nil, fmt.Errorf("booking is already inactive")
            }
            return []any{
                BookingCancelled{BookingID: cmd.BookingID, Reason: cmd.Reason},
            }, nil
        },
    })

    return svc
}
```

:::tip
Handler functions are pure: state in, events out. This makes them trivial to unit test without any infrastructure:

```go
events, err := actFn(ctx, BookingState{Active: true}, CancelBooking{
    BookingID: "123",
    Reason:    "changed plans",
})
// Assert events and err
```
:::
