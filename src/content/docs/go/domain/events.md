---
title: Events
sidebar:
  order: 2
---

# Events

Events are plain Go structs. They must be registered in a TypeMap for serialization.

## Defining events

```go
type RoomBooked struct {
    BookingID string `json:"bookingId"`
    RoomID    string `json:"roomId"`
    Price     float64 `json:"price"`
}

type BookingCancelled struct {
    BookingID string `json:"bookingId"`
    Reason    string `json:"reason"`
}
```

## Type registration

Every event type must be registered in a `codec.TypeMap` with a stable name. The name is what gets stored — renaming the Go struct won't break existing events.

```go
types := codec.NewTypeMap()
codec.Register[RoomBooked](types, "RoomBooked")
codec.Register[BookingCancelled](types, "BookingCancelled")
```

Register all events for a bounded context in one place:

```go
func RegisterBookingEvents(tm *codec.TypeMap) {
    codec.Register[RoomBooked](tm, "RoomBooked")
    codec.Register[BookingCancelled](tm, "BookingCancelled")
    codec.Register[PaymentRecorded](tm, "PaymentRecorded")
}
```

## Serialization

Create a JSON codec from the type map:

```go
jsonCodec := codec.NewJSON(types)
```

The codec handles encoding (struct to JSON bytes + type name) and decoding (JSON bytes + type name to struct).
