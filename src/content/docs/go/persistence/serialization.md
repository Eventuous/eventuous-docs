---
title: Serialization
sidebar:
  order: 2
---

Events need to be serialized for storage and deserialized when read back. Eventuous Go uses a two-layer approach: a **TypeMap** for mapping between Go types and stable string names, and a **Codec** for the actual byte encoding.

## Why custom serialization?

Events are stored permanently. A booking event written today must be readable in five years. This creates a constraint that most general-purpose serialization libraries don't address: **the type identity stored alongside the event data must be stable across code changes**.

If you use Go reflection to derive the type name (e.g., `main.RoomBooked` or `booking.RoomBooked`), you create a fragile coupling between your package structure and your stored data. Renaming a package, moving a type, or renaming a struct would break deserialization of every event written with the old name.

Eventuous Go solves this with explicit type registration. You choose the name, and it stays the same regardless of how your code evolves.

## TypeMap

The `TypeMap` is a bidirectional registry that maps Go types to stable string names and back:

```go
import "github.com/eventuous/eventuous-go/core/codec"

types := codec.NewTypeMap()
codec.Register[RoomBooked](types, "RoomBooked")
codec.Register[PaymentRecorded](types, "PaymentRecorded")
codec.Register[BookingCancelled](types, "BookingCancelled")
```

### Register[E]

`Register` is a generic function that maps a Go type `E` to a string name:

```go
func Register[E any](tm *TypeMap, name string) error
```

- If `E` is already registered with the same name: no-op (idempotent)
- If `E` is already registered with a different name: returns an error
- If `name` is already registered for a different type: returns an error

### Type lookup

The TypeMap supports two directions:

- **TypeName(event)** -- given an event value, returns its registered string name. Used during encoding.
- **NewInstance(name)** -- given a string name, creates a new zero-value pointer of the registered type. Used during decoding.

Both accept either pointer or non-pointer values (the TypeMap resolves through pointer indirection automatically).

### Thread safety

The TypeMap uses a `sync.RWMutex` internally. Registration uses a write lock, lookups use a read lock. You can safely register types during initialization from multiple goroutines.

## Codec interface

The `Codec` interface defines how events are converted to and from bytes:

```go
type Codec interface {
    Encode(event any) (data []byte, eventType string, contentType string, err error)
    Decode(data []byte, eventType string) (event any, err error)
}
```

`Encode` is called when appending events to a stream. It returns:
- `data` -- the serialized bytes
- `eventType` -- the registered type name (stored alongside the data)
- `contentType` -- a MIME type like `"application/json"`

`Decode` is called when reading events from a stream. It receives the stored bytes and type name and returns the deserialized event as a value type (not a pointer).

## JSON codec

The built-in JSON codec uses `encoding/json` and a TypeMap:

```go
jsonCodec := codec.NewJSON(types)
```

**Encode flow:**
1. Look up the event's type in the TypeMap via `TypeName(event)` to get the string name
2. Marshal the event struct to JSON with `json.Marshal`
3. Return JSON bytes, the type name, and `"application/json"`

**Decode flow:**
1. Look up the string name in the TypeMap via `NewInstance(name)` to create a `*T`
2. Unmarshal the JSON bytes into the pointer with `json.Unmarshal`
3. Dereference the pointer and return the value `T`

The dereference step means event handlers always receive value types, not pointers, which is consistent with how events are used throughout the library.

## Custom codecs

If JSON doesn't meet your needs (perhaps you want Protocol Buffers for smaller payloads, or MessagePack for faster serialization), implement the `Codec` interface. You still need a TypeMap for type resolution, but the serialization logic is yours:

```go
type ProtobufCodec struct {
    types *codec.TypeMap
}

func (c *ProtobufCodec) Encode(event any) ([]byte, string, string, error) {
    name, err := c.types.TypeName(event)
    if err != nil {
        return nil, "", "", err
    }
    msg, ok := event.(proto.Message)
    if !ok {
        return nil, "", "", fmt.Errorf("event does not implement proto.Message")
    }
    data, err := proto.Marshal(msg)
    if err != nil {
        return nil, "", "", err
    }
    return data, name, "application/protobuf", nil
}
```

## Best practices

**One registration function per bounded context.** Keep all registrations together so they are easy to audit and hard to forget:

```go
func RegisterBookingEvents(tm *codec.TypeMap) {
    must(codec.Register[RoomBooked](tm, "RoomBooked"))
    must(codec.Register[PaymentRecorded](tm, "PaymentRecorded"))
    must(codec.Register[BookingCancelled](tm, "BookingCancelled"))
}
```

**Register at startup, before any I/O.** If a type is missing from the TypeMap when the codec tries to encode or decode it, you get a runtime error. Register everything upfront to fail fast.

**Use domain-qualified names.** Instead of generic names like `"Created"` or `"Updated"`, use names that include the bounded context: `"BookingCreated"`, `"InvoiceUpdated"`. This prevents collisions if multiple contexts share a TypeMap.

:::caution
Never change a registered name for an existing event type. Events already stored under the old name will fail to decode. If you must rename a Go struct, keep the same registered string name.
:::
