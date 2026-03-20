---
title: Quick Start
sidebar:
  order: 2
---

This guide walks you through building a complete hotel booking system with Eventuous Go. By the end, you will have a working command service that handles commands, persists events to KurrentDB, and a subscription that reacts to those events.

## Prerequisites

- Go 1.25 or later
- Docker (for running KurrentDB)
- A new Go module: `go mod init booking-demo`

Start KurrentDB locally:

```bash
docker run -d --name kurrentdb \
  -p 2113:2113 \
  docker.kurrent.io/kurrent-latest/kurrent:latest \
  --insecure --run-projections=All
```

Install the dependencies:

```bash
go get github.com/eventuous/eventuous-go/core
go get github.com/eventuous/eventuous-go/kurrentdb
```

## Step 1: Define events

Events represent things that happened in your domain. They are plain Go structs with JSON tags for serialization.

```go
package main

// RoomBooked is emitted when a guest books a room.
type RoomBooked struct {
    BookingID string  `json:"bookingId"`
    RoomID    string  `json:"roomId"`
    CheckIn   string  `json:"checkIn"`
    CheckOut  string  `json:"checkOut"`
    Price     float64 `json:"price"`
}

// PaymentRecorded is emitted when a payment is received.
type PaymentRecorded struct {
    BookingID string  `json:"bookingId"`
    Amount    float64 `json:"amount"`
}

// BookingCancelled is emitted when a booking is cancelled.
type BookingCancelled struct {
    BookingID string `json:"bookingId"`
    Reason    string `json:"reason"`
}
```

:::tip
Events are immutable facts. Name them in the past tense (`RoomBooked`, not `BookRoom`) because they describe something that already happened.
:::

## Step 2: Define state and fold function

State is a plain struct. The fold function uses a type switch to apply events to state.

```go
type BookingState struct {
    ID         string
    RoomID     string
    Price      float64
    AmountPaid float64
    Active     bool
}

func bookingFold(state BookingState, event any) BookingState {
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
        return state
    default:
        return state
    }
}
```

The fold function is a pure function: given a state and an event, it returns a new state. It has no side effects and is easy to test.

## Step 3: Register types and create codec

Every event type needs a stable string name for serialization. This is what gets stored in KurrentDB -- not the Go type name.

```go
import "github.com/eventuous/eventuous-go/core/codec"

func newCodec() codec.Codec {
    types := codec.NewTypeMap()
    must(codec.Register[RoomBooked](types, "RoomBooked"))
    must(codec.Register[PaymentRecorded](types, "PaymentRecorded"))
    must(codec.Register[BookingCancelled](types, "BookingCancelled"))
    return codec.NewJSON(types)
}

func must(err error) {
    if err != nil {
        panic(err)
    }
}
```

:::caution
Always register your types before creating the codec and before any read/write operations. If you forget to register a type, encoding or decoding will return an error at runtime.
:::

## Step 4: Connect to KurrentDB

```go
import (
    "github.com/kurrent-io/KurrentDB-Client-Go/kurrentdb"
    kdb "github.com/eventuous/eventuous-go/kurrentdb"
)

func newStore() *kdb.Store {
    settings, err := kurrentdb.ParseConnectionString("kurrentdb://localhost:2113?tls=false")
    if err != nil {
        panic(err)
    }
    client, err := kurrentdb.NewClient(settings)
    if err != nil {
        panic(err)
    }
    return kdb.NewStore(client, newCodec())
}
```

The `Store` implements the full `EventStore` interface: reading, writing, deleting, and truncating streams.

## Step 5: Define commands

Commands are simple structs that represent user intent.

```go
type BookRoom struct {
    BookingID string
    RoomID    string
    CheckIn   string
    CheckOut  string
    Price     float64
}

type RecordPayment struct {
    BookingID string
    Amount    float64
}

type CancelBooking struct {
    BookingID string
    Reason    string
}
```

## Step 6: Create command service and register handlers

The functional command service loads state, calls your handler, and persists the resulting events.

```go
import (
    "context"
    eventuous "github.com/eventuous/eventuous-go/core"
    "github.com/eventuous/eventuous-go/core/command"
)

func newBookingService(es *kdb.Store) *command.Service[BookingState] {
    svc := command.New[BookingState](es, es, bookingFold, BookingState{})

    // Book a room -- stream must not exist yet
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
                    CheckIn:   cmd.CheckIn,
                    CheckOut:  cmd.CheckOut,
                    Price:     cmd.Price,
                },
            }, nil
        },
    })

    // Record a payment -- stream must already exist
    command.On(svc, command.Handler[RecordPayment, BookingState]{
        Expected: eventuous.IsExisting,
        Stream: func(cmd RecordPayment) eventuous.StreamName {
            return eventuous.NewStreamName("Booking", cmd.BookingID)
        },
        Act: func(ctx context.Context, state BookingState, cmd RecordPayment) ([]any, error) {
            if !state.Active {
                return nil, fmt.Errorf("cannot record payment: booking is not active")
            }
            return []any{
                PaymentRecorded{BookingID: cmd.BookingID, Amount: cmd.Amount},
            }, nil
        },
    })

    // Cancel a booking -- stream must already exist
    command.On(svc, command.Handler[CancelBooking, BookingState]{
        Expected: eventuous.IsExisting,
        Stream: func(cmd CancelBooking) eventuous.StreamName {
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

Each handler specifies:
- **Expected** -- whether the stream should be new, existing, or either
- **Stream** -- how to derive the stream name from the command
- **Act** -- a pure function that takes current state and a command and returns new events

## Step 7: Handle commands

```go
func main() {
    ctx := context.Background()
    store := newStore()
    svc := newBookingService(store)

    // Book a room
    result, err := svc.Handle(ctx, BookRoom{
        BookingID: "booking-1",
        RoomID:    "room-42",
        CheckIn:   "2026-04-01",
        CheckOut:  "2026-04-05",
        Price:     500.00,
    })
    if err != nil {
        panic(err)
    }
    fmt.Printf("Booked! State: %+v\n", result.State)

    // Record a payment
    result, err = svc.Handle(ctx, RecordPayment{
        BookingID: "booking-1",
        Amount:    250.00,
    })
    if err != nil {
        panic(err)
    }
    fmt.Printf("Payment recorded! Paid: %.2f\n", result.State.AmountPaid)
}
```

## Step 8: Subscribe to events

Subscriptions let you react to events in real time -- for projections, notifications, or integration with other systems.

```go
import (
    "log/slog"
    kdb "github.com/eventuous/eventuous-go/kurrentdb"
    "github.com/eventuous/eventuous-go/core/subscription"
)

func startSubscription(ctx context.Context, client *kurrentdb.Client, jsonCodec codec.Codec) {
    handler := subscription.HandlerFunc(
        func(ctx context.Context, msg *subscription.ConsumeContext) error {
            switch msg.Payload.(type) {
            case RoomBooked:
                slog.Info("Room booked", "stream", msg.Stream, "type", msg.EventType)
            case PaymentRecorded:
                slog.Info("Payment recorded", "stream", msg.Stream)
            case BookingCancelled:
                slog.Info("Booking cancelled", "stream", msg.Stream)
            }
            return nil
        },
    )

    sub := kdb.NewCatchUp(client, jsonCodec, "BookingProjection",
        kdb.FromAll(),
        kdb.WithHandler(handler),
        kdb.WithMiddleware(
            subscription.WithLogging(slog.Default()),
        ),
    )

    // Start blocks until ctx is cancelled
    if err := sub.Start(ctx); err != nil {
        slog.Error("subscription stopped", "error", err)
    }
}
```

:::tip
In a real application, you would run the subscription in a separate goroutine and use context cancellation for graceful shutdown. You would also add a `CheckpointStore` so the subscription can resume from where it left off after a restart.
:::

## What's next?

You now have a working Event Sourcing system. To go deeper:

- [Events](../../domain/events/) -- learn about type registration and serialization in detail
- [State](../../domain/state/) -- understand the fold pattern and state design
- [Command Service](../../application/command-service/) -- explore the full handler pipeline
- [Subscriptions](../../subscriptions/overview/) -- middleware, concurrency, and checkpointing
- [KurrentDB](../../infra/kurrentdb/) -- persistent subscriptions, filters, and advanced options
