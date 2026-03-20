---
title: Introduction
sidebar:
  order: 1
---

## What is Event Sourcing?

Most applications store their current state in a database. When a hotel booking is modified, the row in the `bookings` table gets updated. The previous state is gone. You know *what* the data looks like now, but not *how* it got there.

Event Sourcing flips this model. Instead of storing the latest state, you store every change that ever happened as an **event**. A booking isn't a row -- it's a sequence of events: `RoomBooked`, `PaymentRecorded`, `BookingCancelled`. The current state is derived by replaying those events in order.

This gives you several things that traditional CRUD cannot:

- **Complete audit trail** -- every state change is recorded, with metadata about when and why it happened.
- **Temporal queries** -- you can reconstruct the state at any point in time by replaying events up to that moment.
- **Event-driven integration** -- other systems can subscribe to your events and react in real time, without polling or shared databases.
- **Debugging production issues** -- when something goes wrong, you have the full history of how the system reached that state.

### How it differs from CRUD

In a traditional application, handling "cancel a booking" looks like this:

```
1. Read booking row from database
2. Set status = "cancelled"
3. Write booking row back
```

The old status is overwritten. If you need history, you have to build it separately (audit tables, change-data-capture, etc.).

With Event Sourcing:

```
1. Read all events for booking stream
2. Fold events into current state
3. Validate that cancellation is allowed
4. Append BookingCancelled event to the stream
```

The `BookingCancelled` event is appended -- nothing is overwritten. The current state is always computed by folding over the event stream. This is the fundamental difference: **events are the source of truth**, not derived data.

## Why Eventuous Go?

Eventuous Go is a production-grade Event Sourcing library for Go, ported from the [battle-tested .NET Eventuous library](https://eventuous.dev) that has been used in production systems since 2021. Rather than being a toy or proof-of-concept, it provides the same core patterns that the .NET version offers, adapted to be idiomatic Go.

The library covers the full Event Sourcing lifecycle:

- **Domain modelling** -- defining events, state, and aggregates
- **Command handling** -- loading state, executing business logic, persisting new events
- **Persistence** -- reading and writing event streams with optimistic concurrency
- **Subscriptions** -- consuming events in real time for projections, integration, or reactions
- **Observability** -- OpenTelemetry tracing and metrics out of the box

## Functional-first philosophy

Eventuous Go is designed around **pure functions**, not class hierarchies. This is a deliberate choice that aligns with both Go's strengths and Event Sourcing's nature.

**State reconstruction uses a fold function with a type switch:**

```go
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

There is no handler registration, no interface to implement, no base type to embed. Just a plain function that takes state and an event and returns new state. This is idiomatic Go -- the type switch is checked at compile time for exhaustiveness (with linters) and is trivial to read.

**Command handlers are pure functions too:**

```go
func(ctx context.Context, state BookingState, cmd BookRoom) ([]any, error) {
    return []any{RoomBooked{BookingID: cmd.BookingID, RoomID: cmd.RoomID}}, nil
}
```

State in, events out. No side effects. Easy to test, easy to reason about.

The aggregate pattern is available for teams that prefer it, but it's explicitly optional. The functional command service is the primary path.

## Module overview

Eventuous Go is organized as a multi-module project. You only import what you need, which keeps your dependency tree clean.

| Module | Import path | What it provides |
|--------|-------------|------------------|
| **core** | `github.com/eventuous/eventuous-go/core` | Domain model (aggregates, state), persistence interfaces, command services, subscriptions, serialization |
| **kurrentdb** | `github.com/eventuous/eventuous-go/kurrentdb` | KurrentDB (formerly EventStoreDB) event store implementation, catch-up and persistent subscriptions |
| **otel** | `github.com/eventuous/eventuous-go/otel` | OpenTelemetry tracing and metrics decorators for command handlers and subscriptions |

The `core` module has no heavy dependencies. The `kurrentdb` and `otel` modules depend on `core` but not on each other.

### Installation

```bash
# Core library (always needed)
go get github.com/eventuous/eventuous-go/core

# KurrentDB integration (for production use)
go get github.com/eventuous/eventuous-go/kurrentdb

# OpenTelemetry support (optional)
go get github.com/eventuous/eventuous-go/otel
```

## What's inside core

The `core` module is organized into focused packages:

- **`aggregate`** -- the `Aggregate[S]` type that tracks state, pending changes, and version
- **`codec`** -- `TypeMap` for event type registration, `Codec` interface, and JSON implementation
- **`store`** -- `EventReader`, `EventWriter`, and `EventStore` interfaces, plus `LoadState`, `LoadAggregate`, and `StoreAggregate` functions
- **`command`** -- functional `Service[S]` and aggregate-based `AggregateService[S]` for command handling
- **`subscription`** -- `EventHandler` interface, middleware chain, and `CheckpointCommitter` with gap detection
- **`test/memstore`** -- in-memory `EventStore` for unit testing without infrastructure

## Next steps

Head to the [Quick Start](../quick-start/) to build a complete booking system from scratch, or dive into specific topics:

- [State](../../domain/state/) -- how to model state with fold functions
- [Aggregate](../../domain/aggregate/) -- the optional aggregate pattern
- [Events](../../domain/events/) -- defining and registering event types
- [Command Service](../../application/command-service/) -- handling commands with the functional approach
- [Event Store](../../persistence/event-store/) -- persistence interfaces and the load/store cycle
- [Subscriptions](../../subscriptions/overview/) -- consuming events in real time
- [KurrentDB](../../infra/kurrentdb/) -- connecting to KurrentDB
