---
title: Events
sidebar:
  order: 3
---

Domain events are the core building block of Event Sourcing. They represent facts -- things that happened in your domain. Once stored, events are immutable and permanent.

## What are domain events?

An event records a state change that already occurred. `RoomBooked` means a room was booked. `BookingCancelled` means a booking was cancelled. Events are always named in the past tense because they describe history.

Events differ from commands: a command is a request that might be rejected ("please book this room"), while an event is a fact that already happened ("the room was booked"). Commands are input, events are output.

In Event Sourcing, events are the **source of truth**. The current state of any entity is derived by replaying its events. Events are also used to communicate between parts of the system -- subscriptions react to events for projections, notifications, and cross-system integration.

## Events are plain Go structs

Eventuous Go does not require events to implement any interface or embed any base type. Events are simple structs:

```go
type RoomBooked struct {
    BookingID string  `json:"bookingId"`
    RoomID    string  `json:"roomId"`
    CheckIn   string  `json:"checkIn"`
    CheckOut  string  `json:"checkOut"`
    Price     float64 `json:"price"`
}

type PaymentRecorded struct {
    BookingID string  `json:"bookingId"`
    Amount    float64 `json:"amount"`
}

type BookingCancelled struct {
    BookingID string `json:"bookingId"`
    Reason    string `json:"reason"`
}
```

### JSON tags

Always add JSON tags to your event fields. Events are serialized to JSON for storage and the tags control the field names in the JSON representation. Without tags, Go uses the uppercase field names (`BookingID` instead of `bookingId`), which is unconventional for JSON and can cause interoperability issues if you have consumers written in other languages.

:::tip
Use camelCase for JSON field names. This is the most widely accepted convention for JSON and matches what JavaScript, TypeScript, and most API consumers expect.
:::

## Type registration

Every event type must be registered in a `TypeMap` with a stable string name before it can be serialized or deserialized.

```go
import "github.com/eventuous/eventuous-go/core/codec"

types := codec.NewTypeMap()
codec.Register[RoomBooked](types, "RoomBooked")
codec.Register[PaymentRecorded](types, "PaymentRecorded")
codec.Register[BookingCancelled](types, "BookingCancelled")
```

### Why explicit type names?

The string name `"RoomBooked"` is what gets written to the event store alongside the event data. This is the **persistent identity** of the event type. It must remain stable forever.

If you rename the Go struct from `RoomBooked` to `HotelRoomBooked`, the stored events still have `"RoomBooked"` as their type name. The TypeMap maps the new Go struct to the old name, so deserialization continues to work:

```go
// Even after renaming the struct, the stored name stays the same
codec.Register[HotelRoomBooked](types, "RoomBooked")
```

Without explicit names, the system would have to derive names from Go types using reflection. That would mean renaming a struct is a breaking change that corrupts your ability to read existing events. Explicit registration prevents this class of bugs entirely.

### Idempotency and conflict detection

Registering the same type with the same name is idempotent -- calling `Register` twice with the same arguments does nothing. However, registering the same type with a different name, or a different type with the same name, returns an error:

```go
// OK: idempotent
codec.Register[RoomBooked](types, "RoomBooked")
codec.Register[RoomBooked](types, "RoomBooked") // no error

// Error: type already registered under a different name
codec.Register[RoomBooked](types, "DifferentName")

// Error: name already registered for a different type
codec.Register[SomeOtherEvent](types, "RoomBooked")
```

### Thread safety

The `TypeMap` is safe for concurrent use. It uses a `sync.RWMutex` internally, so you can register types from multiple goroutines during initialization without additional synchronization.

## The Codec interface

The `Codec` interface handles encoding events to bytes and decoding bytes back to events:

```go
type Codec interface {
    Encode(event any) (data []byte, eventType string, contentType string, err error)
    Decode(data []byte, eventType string) (event any, err error)
}
```

- **Encode** takes an event struct, returns the serialized bytes, the registered type name, and the content type (e.g., `"application/json"`).
- **Decode** takes serialized bytes and the type name, returns the deserialized event struct.

### JSON codec

The built-in JSON codec uses `encoding/json` and a `TypeMap`:

```go
jsonCodec := codec.NewJSON(types)
```

The encoding flow:
1. Look up the event's Go type in the TypeMap to get the string name
2. Marshal the event to JSON using `json.Marshal`
3. Return the JSON bytes, type name, and `"application/json"`

The decoding flow:
1. Look up the string name in the TypeMap to find the Go type
2. Create a new zero-value instance of that type
3. Unmarshal the JSON bytes into it using `json.Unmarshal`
4. Return the deserialized event as a value (not a pointer)

### Custom codecs

If you need a different serialization format (Protocol Buffers, MessagePack, etc.), implement the `Codec` interface. You still need a `TypeMap` for type resolution, but the encoding/decoding is your own logic.

## Best practice: one registration function per bounded context

Group all event registrations for a bounded context in a single function. This makes it easy to find all event types, prevents accidental omissions, and gives you a single call site for initialization:

```go
func RegisterBookingEvents(tm *codec.TypeMap) {
    must(codec.Register[RoomBooked](tm, "RoomBooked"))
    must(codec.Register[PaymentRecorded](tm, "PaymentRecorded"))
    must(codec.Register[BookingCancelled](tm, "BookingCancelled"))
}

func must(err error) {
    if err != nil {
        panic(err)
    }
}
```

Call this at application startup, before creating the codec or any services:

```go
types := codec.NewTypeMap()
RegisterBookingEvents(types)
jsonCodec := codec.NewJSON(types)
```

## Common mistakes

:::caution[Forgetting to register a type]
If you add a new event type to your domain but forget to register it in the TypeMap, the codec will fail at runtime when it tries to encode or decode that event. Always add the registration alongside the type definition.
:::

:::caution[Name collisions across bounded contexts]
If two different bounded contexts register different event types under the same name (e.g., both register a `"Created"` event), the TypeMap will return an error. Use qualified names like `"BookingCreated"` and `"InvoiceCreated"` to avoid collisions.
:::

:::caution[Changing a registered name]
Once events are stored under a name, that name is permanent. If you change the registered name for a type, existing events in the store with the old name will fail to decode. If you must rename, register the type under both names (old and new) by creating a type alias.
:::
