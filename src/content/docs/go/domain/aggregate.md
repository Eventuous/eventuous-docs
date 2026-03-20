---
title: Aggregate
sidebar:
  order: 2
---

## Concept

An aggregate is a consistency boundary from Domain-Driven Design. It groups related data and business rules together and ensures that all changes within that boundary are consistent. In Event Sourcing, an aggregate is the unit that reads events from a stream, applies business logic, and produces new events.

For example, a hotel `Booking` is an aggregate. It has rules like "you can't cancel a booking that's already cancelled" or "you can't record a payment on an inactive booking." These invariants are enforced by the aggregate before any new events are produced.

## Aggregate[S] in Eventuous Go

The `Aggregate[S]` type is a generic container that tracks:

- **State** (type `S`) -- the current domain state, computed by folding events
- **Pending changes** -- new events that have been applied but not yet persisted
- **Version** -- the stream version for optimistic concurrency control

```go
import "github.com/eventuous/eventuous-go/core/aggregate"
```

`S` can be any Go type. There is no interface constraint -- you pass a fold function when creating the aggregate, and it handles state reconstruction.

### Creating an aggregate

```go
agg := aggregate.New(bookingFold, BookingState{})
```

`New` takes two arguments:
- The **fold function** (`func(S, any) S`) that applies events to state
- The **zero value** of your state type, used as the starting point

The new aggregate starts with `OriginalVersion` set to `-1`, meaning it has never been persisted.

### Apply: recording new events

`Apply` records a domain event and immediately folds it into the state:

```go
agg.Apply(RoomBooked{BookingID: "123", RoomID: "room-42", Price: 200})

state := agg.State()
// state.ID == "123", state.RoomID == "room-42", state.Active == true

changes := agg.Changes()
// []any{RoomBooked{...}}
```

Each call to `Apply` does two things:
1. Appends the event to the pending changes list
2. Passes the event through the fold function to update the state

### Load: reconstructing from stored events

When an aggregate is loaded from the event store, `Load` is called with the persisted events:

```go
agg := aggregate.New(bookingFold, BookingState{})
agg.Load(2, []any{
    RoomBooked{BookingID: "123", RoomID: "room-42", Price: 200},
    PaymentRecorded{BookingID: "123", Amount: 100},
    BookingCancelled{BookingID: "123", Reason: "changed plans"},
})

agg.OriginalVersion() // 2 (position of last event in the stream)
agg.State().Cancelled  // true
agg.Changes()          // nil (no pending changes)
```

`Load` sets the original version, stores the original events, clears any pending changes, and folds all events into the state.

:::tip
You rarely call `Load` directly. The `store.LoadAggregate` function reads from the event store and calls `Load` for you.
:::

## Guards

Guards enforce preconditions before domain logic executes. They prevent invalid operations early, before any events are applied.

### EnsureNew

Returns an error if the aggregate has already been persisted (version >= 0). Use this for creation commands:

```go
func BookRoom(agg *aggregate.Aggregate[BookingState], cmd BookRoom) error {
    if err := agg.EnsureNew(); err != nil {
        return err // "aggregate: already exists"
    }
    agg.Apply(RoomBooked{
        BookingID: cmd.BookingID,
        RoomID:    cmd.RoomID,
        Price:     cmd.Price,
    })
    return nil
}
```

### EnsureExists

Returns an error if the aggregate has never been persisted (version is -1). Use this for mutation commands:

```go
func CancelBooking(agg *aggregate.Aggregate[BookingState], cmd CancelBooking) error {
    if err := agg.EnsureExists(); err != nil {
        return err // "aggregate: does not exist"
    }
    if !agg.State().Active {
        return fmt.Errorf("booking is already inactive")
    }
    agg.Apply(BookingCancelled{
        BookingID: cmd.BookingID,
        Reason:    cmd.Reason,
    })
    return nil
}
```

:::tip
When using the `AggregateService`, the service enforces `ExpectedState` (IsNew, IsExisting, IsAny) automatically before calling your handler. You can still use `EnsureNew` and `EnsureExists` as belt-and-suspenders validation, but it is not strictly necessary.
:::

## ClearChanges

After the aggregate's pending changes have been successfully persisted, `ClearChanges` resets the changes list and advances the version:

```go
agg.Apply(RoomBooked{...})
agg.OriginalVersion() // -1
agg.CurrentVersion()  // 0

// ... persist changes ...

agg.ClearChanges()
agg.OriginalVersion() // 0
agg.Changes()         // nil
```

This is called automatically by `store.StoreAggregate`. You would only call it manually if you're building a custom persistence layer.

## Version tracking

The aggregate tracks two versions:

- **OriginalVersion** -- the stream version the aggregate was loaded at. `-1` for new aggregates.
- **CurrentVersion** -- the version after applying pending changes: `OriginalVersion + len(Changes)`.

These are used for optimistic concurrency. When persisting, the event store checks that the stream is still at `OriginalVersion`. If another process appended events in the meantime, the store returns `ErrOptimisticConcurrency`.

## Domain logic as free functions

In Eventuous Go, domain logic is typically written as free functions, not methods on a custom aggregate type. There is no "BookingAggregate" type -- there is `Aggregate[BookingState]` and plain functions that operate on it:

```go
func BookRoom(agg *aggregate.Aggregate[BookingState], cmd BookRoom) error {
    if err := agg.EnsureNew(); err != nil {
        return err
    }
    agg.Apply(RoomBooked{BookingID: cmd.BookingID, RoomID: cmd.RoomID})
    return nil
}

func RecordPayment(agg *aggregate.Aggregate[BookingState], cmd RecordPayment) error {
    if err := agg.EnsureExists(); err != nil {
        return err
    }
    agg.Apply(PaymentRecorded{BookingID: cmd.BookingID, Amount: cmd.Amount})
    return nil
}
```

This approach avoids creating wrapper types that just delegate to the underlying aggregate. It keeps the code flat and testable.

## The aggregate is optional

The aggregate pattern is **not required** in Eventuous Go. The [functional command service](../application/command-service/) works directly with state and fold functions -- no aggregate involved. The aggregate adds value when:

- You need to call `Apply` multiple times in a single operation (producing multiple events from one command)
- You want guards (`EnsureNew`, `EnsureExists`) as a domain-level concept
- Your team prefers the DDD tactical pattern and finds it makes the code clearer

If your handlers are simple (one command produces one or a few events based on state), the functional approach is often more concise.

### Trade-offs comparison

| Aspect | Functional (no aggregate) | Aggregate-based |
|--------|--------------------------|-----------------|
| Handler signature | `func(ctx, state, cmd) ([]any, error)` | `func(ctx, agg, cmd) error` |
| State access | Directly as a parameter | Via `agg.State()` |
| Event production | Return a slice of events | Call `agg.Apply()` one or more times |
| Guards | Handled by `ExpectedState` on handler | `agg.EnsureNew()`, `agg.EnsureExists()` |
| Multiple events | Build and return a slice | Call `Apply` multiple times |
| Testability | Pure function, trivial to test | Need to create aggregate, call function, check state/changes |

## Complete example

```go
package booking

import (
    "context"
    "fmt"

    "github.com/eventuous/eventuous-go/core/aggregate"
)

// Domain functions
func BookRoom(
    ctx context.Context,
    agg *aggregate.Aggregate[BookingState],
    cmd BookRoom,
) error {
    if err := agg.EnsureNew(); err != nil {
        return err
    }
    agg.Apply(RoomBooked{
        BookingID: cmd.BookingID,
        RoomID:    cmd.RoomID,
        Price:     cmd.Price,
    })
    return nil
}

func RecordPayment(
    ctx context.Context,
    agg *aggregate.Aggregate[BookingState],
    cmd RecordPayment,
) error {
    if err := agg.EnsureExists(); err != nil {
        return err
    }
    state := agg.State()
    if !state.Active {
        return fmt.Errorf("cannot record payment: booking is not active")
    }
    if state.AmountPaid + cmd.Amount > state.Price {
        return fmt.Errorf("payment would exceed booking price")
    }
    agg.Apply(PaymentRecorded{BookingID: cmd.BookingID, Amount: cmd.Amount})
    return nil
}

func CancelBooking(
    ctx context.Context,
    agg *aggregate.Aggregate[BookingState],
    cmd CancelBooking,
) error {
    if err := agg.EnsureExists(); err != nil {
        return err
    }
    if !agg.State().Active {
        return fmt.Errorf("booking is already inactive")
    }
    agg.Apply(BookingCancelled{BookingID: cmd.BookingID, Reason: cmd.Reason})
    return nil
}
```
