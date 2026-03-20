---
title: Aggregate
sidebar:
  order: 1
---

# Aggregate

The `Aggregate[S]` type tracks state, pending changes, and version for optimistic concurrency.

## State and fold

State is any Go struct. State reconstruction uses a **fold function** with a type switch — no handler registration needed.

```go
type BookingState struct {
    ID     string
    RoomID string
    Active bool
}

func bookingFold(state BookingState, event any) BookingState {
    switch e := event.(type) {
    case RoomBooked:
        return BookingState{ID: e.BookingID, RoomID: e.RoomID, Active: true}
    case BookingCancelled:
        state.Active = false
        return state
    default:
        return state
    }
}
```

## Creating and using aggregates

```go
agg := aggregate.New(bookingFold, BookingState{})

// Apply events (records as pending changes)
agg.Apply(RoomBooked{BookingID: "123", RoomID: "room-42"})

// Read state
state := agg.State() // BookingState{ID: "123", RoomID: "room-42", Active: true}

// Check pending changes
changes := agg.Changes() // []any{RoomBooked{...}}
```

## Guards

```go
func BookRoom(agg *aggregate.Aggregate[BookingState], roomID string) error {
    if err := agg.EnsureNew(); err != nil {
        return err // aggregate already exists
    }
    agg.Apply(RoomBooked{RoomID: roomID})
    return nil
}
```

- `EnsureNew()` — returns error if aggregate was loaded from an existing stream
- `EnsureExists()` — returns error if aggregate is new (never persisted)

## Aggregate is optional

The aggregate pattern is optional. The [functional command service](../application/command-service) works directly with state and fold — no aggregate needed.
