---
title: Command Service
sidebar:
  order: 1
---

# Command Service

The functional command service is the primary way to handle commands in Eventuous Go.

## Creating a service

```go
svc := command.New[BookingState](reader, writer, bookingFold, BookingState{})
```

## Registering handlers

```go
command.On(svc, command.Handler[BookRoom, BookingState]{
    Expected: eventuous.IsNew,
    Stream:   func(cmd BookRoom) eventuous.StreamName {
        return eventuous.NewStreamName("Booking", cmd.BookingID)
    },
    Act: func(ctx context.Context, state BookingState, cmd BookRoom) ([]any, error) {
        return []any{RoomBooked{BookingID: cmd.BookingID, RoomID: cmd.RoomID}}, nil
    },
})
```

### Handler fields

| Field | Type | Description |
|-------|------|-------------|
| `Expected` | `ExpectedState` | `IsNew`, `IsExisting`, or `IsAny` |
| `Stream` | `func(C) StreamName` | Extracts stream name from command |
| `Act` | `func(ctx, state, cmd) ([]any, error)` | Pure function: state in, events out |

## Handling commands

```go
result, err := svc.Handle(ctx, BookRoom{BookingID: "123", RoomID: "room-42"})
// result.State — the updated state
// result.NewEvents — events that were produced
// result.GlobalPosition — position in the event store
```

## Aggregate service

For teams that prefer the DDD aggregate pattern:

```go
svc := command.NewAggregateService[BookingState](reader, writer, bookingFold, BookingState{})

command.OnAggregate(svc, command.AggregateHandler[BookRoom, BookingState]{
    Expected: eventuous.IsNew,
    ID:       func(cmd BookRoom) string { return cmd.BookingID },
    Act: func(ctx context.Context, agg *aggregate.Aggregate[BookingState], cmd BookRoom) error {
        if err := agg.EnsureNew(); err != nil {
            return err
        }
        agg.Apply(RoomBooked{BookingID: cmd.BookingID, RoomID: cmd.RoomID})
        return nil
    },
})
```

Key difference: `Act` receives an aggregate and returns only `error`. Events are recorded via `agg.Apply()`.
