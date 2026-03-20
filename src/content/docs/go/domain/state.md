---
title: State
sidebar:
  order: 1
---

In Event Sourcing, state is not stored directly -- it is **derived** from events. Every time you need the current state of a booking, the system reads all events from that booking's stream and folds them together into a single state value.

State is the foundational concept in Eventuous Go. Both the functional command service and the aggregate pattern depend on it.

## State is a plain struct

There is no interface to implement, no base type to embed. State is just a Go struct:

```go
type BookingState struct {
    ID         string
    RoomID     string
    Price      float64
    AmountPaid float64
    Active     bool
    Cancelled  bool
}
```

This is deliberate. Your domain model should be free of framework concerns. The struct is yours -- put whatever fields you need in it.

## The fold function

State reconstruction requires a **fold function** with this signature:

```go
func(state S, event any) S
```

It takes the current state and an event, and returns the new state. The implementation uses a type switch to handle each event type:

```go
func BookingFold(state BookingState, event any) BookingState {
    switch e := event.(type) {
    case RoomBooked:
        return BookingState{
            ID:     e.BookingID,
            RoomID: e.RoomID,
            Price:  e.Price,
            Active: true,
        }
    case PaymentRecorded:
        state.AmountPaid += e.Amount
        return state
    case BookingCancelled:
        state.Active = false
        state.Cancelled = true
        return state
    default:
        return state
    }
}
```

### Why type switch, not handler registration?

Some Event Sourcing libraries use a registration-based approach where you register a handler function for each event type. Eventuous Go uses a type switch instead. There are good reasons for this:

1. **It's idiomatic Go.** Type switches are a first-class language feature. Every Go developer reads them immediately.
2. **The compiler helps.** Static analysis tools like `exhaustive` can warn you when your switch is missing a case, catching bugs at build time.
3. **Everything is in one place.** You can see all state transitions for a given state type in a single function. There is no need to search across multiple registration calls to understand how state evolves.
4. **No reflection at runtime.** The type switch is a direct dispatch -- there is no map lookup or reflection involved.

### The default case

Always include a `default` case that returns the state unchanged. If the fold encounters an event type it does not recognize (for example, an event added later that this version of the code doesn't know about), it should not fail. It should simply ignore the unknown event and move on.

## Immutability by convention

Go does not have immutable types, so immutability is a convention. The fold function should return a new or modified state value rather than mutating shared data through pointers.

For creation events, return a brand new struct:

```go
case RoomBooked:
    return BookingState{
        ID:     e.BookingID,
        RoomID: e.RoomID,
        Price:  e.Price,
        Active: true,
    }
```

For mutation events, it is fine to modify the value and return it, because structs in Go are values, not references. The caller's copy is not affected:

```go
case PaymentRecorded:
    state.AmountPaid += e.Amount
    return state
```

:::caution
If your state contains slices or maps, modifying them in-place *will* affect the caller's copy because slices and maps are reference types. In that case, copy before mutating:

```go
case ItemAdded:
    items := make([]string, len(state.Items))
    copy(items, state.Items)
    items = append(items, e.ItemID)
    state.Items = items
    return state
```
:::

## State reconstruction

When the system needs the current state of a booking, it:

1. Reads all events from the booking's stream
2. Starts with a **zero value** (empty `BookingState{}`)
3. Folds each event into the state, one by one
4. The final result is the current state

```
zero → fold(zero, RoomBooked{...}) → fold(s1, PaymentRecorded{...}) → fold(s2, BookingCancelled{...}) → final state
```

This happens automatically inside the command service and the `store.LoadState` function. You never need to call the fold manually in production code (though you might in tests).

## State is shared

The same state struct and fold function are used by both the functional command service and the aggregate-based command service. If you start with the functional approach and later decide you need aggregates, you do not rewrite your state or fold. They stay the same.

```go
// Used by functional command service
svc := command.New[BookingState](reader, writer, BookingFold, BookingState{})

// Used by aggregate command service -- same fold and state
aggSvc := command.NewAggregateService[BookingState](reader, writer, BookingFold, BookingState{})

// Used by the aggregate directly -- same fold and state
agg := aggregate.New(BookingFold, BookingState{})
```

## When state has identity

In the booking example, the state contains an `ID` field. This is often useful because it lets you access the entity's identity from the state after loading. However, identity is not required in the state -- the stream name already encodes the identity (e.g., `Booking-123`).

Whether to include identity in state is a design choice:

- **Include it** if your handlers or read models need to reference the entity's ID from the state
- **Omit it** if the stream name is always available in context and you want leaner state

Both approaches work. There is no framework requirement either way.
