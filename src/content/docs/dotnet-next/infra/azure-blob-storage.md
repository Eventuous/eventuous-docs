---
title: "Azure Blob Storage"
description: "Projections for Azure Blob Storage"
sidebar:
  order: 8
---

[Azure Blob Storage](https://azure.microsoft.com/en-us/products/storage/blobs/) is a fully managed object storage in the cloud. Eventuous supports Azure Service Bus for projections using the `Eventuous.Azure.Storage.Blobs` package.
It allows you to project event store events to Azure Blob Storage as state objects, maintaining a separate state document for each event stream.

## Using projections

Create your own projection class that inherits from `BlobStorageProjector<T>` where `T` is your state type. The state type must be a class with a parameterless constructor.

Register event handlers using the `On<TEvent>` methods. When an event is received, the projector retrieves the current state blob (or creates a new state instance if the blob doesn't exist), applies the event to the state using the registered event handler, and uploads the updated state back to Blob Storage.

```csharp
public class BookingProjection : BlobStorageProjector<BookingState> {
    public BookingProjection(BlobServiceClient client, IOptions<JsonSerializerOptions> serializerOptions)
        : base(client, "bookings-container", serializerOptions.Value) {
        
        // Uses default blob ID from stream
        On<BookingImported>((state, evt) => {
            state.RoomId = evt.RoomId;
            state.CheckInDate = evt.CheckIn;
            return state;
        });

        // Custom blob ID using event data
        On<BookingPaymentRegistered>(
            (state, evt) => {
                state.PaidAmount += evt.AmountPaid;
                return state;
            },
            context => new ValueTask<string>($"custom-{context.Message.BookingId}")
        );
    }
}
```

By using `IOptions<JsonSerializerOptions>` we can also use the Json serialization options as set in ASP DI.

The blob name itself is constructed using the projection type name and stream id. This can be overriden.


## Projector options

The `BlobStorageProjectorOptions<T>` class provides several configuration options for fine-tuning the projector behavior.

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `JsonOptions` | `JsonSerializerOptions?` | `null` (uses `JsonSerializerOptions.Web`) | JSON serializer options for state serialization/deserialization. Controls formatting, naming policies, etc. |
| `RaceRetries` | `int` | `0` | Number of retry attempts for optimistic concurrency conflicts. Increase when concurrent updates are likely. |
| `IdempotencyMode` | `IdempotencyMode` | `IdempotencyMode.None` | Controls duplicate message detection behavior. |

### Idempotency modes

The `IdempotencyMode` enum controls how the projector handles duplicate messages:

- **`None`** - No idempotency checks. Always processes messages and updates blobs.
- **`ByGlobalPosition`** - Skips processing if existing blob has matching global position metadata.
- **`ByMessageId`** - Skips processing if existing blob has matching message ID metadata.

### Custom blob naming

By default, blob names are generated using `GetBlobName(string id)` which creates names in the format `{id}/{T}.json`, where `id` defaults to the stream ID from `context.Stream.GetId()`.

You can customize blob naming in two ways:

**1. Override the virtual methods globally for all events:**

```csharp
protected override string GetBlobName(string id, IMessageConsumeContext context) {
    // Use stream name and type in the path
    var streamName = context.Stream.ToString();
    return $"projections/{streamName}/{id}.json";
}

protected override string GetBlobName(string id) {
    return $"{id}/{typeof(T).Name}.json";
}
```

**2. Override blob ID per event handler using `getBlobId`:**

```csharp
On<BookingPaymentRegistered>(
    (state, evt) => {
        state.PaidAmount += evt.AmountPaid;
        return state;
    },
    // Custom blob ID for this specific event only
    context => new ValueTask<string>($"payments/{context.Message.BookingId}.json")
);
```

Use per-event blob ID overrides when you need different events to target different blob paths or naming conventions within the same projector, such as when the business identifier differs from the stream identifier.
## Features

- **Automatic state management** - Creates new state instances when blobs don't exist
- **Optimistic concurrency control** - Uses ETags for safe concurrent updates
- **Idempotency** - Prevents duplicate processing with configurable modes
- **Retry handling** - Automatic retries for race conditions
- **Flexible blob naming** - Customizable blob ID and naming conventions
- **Metadata storage** - Automatically stores stream info, positions, and message IDs

## Background

The projector stores each state as a separate blob in Azure Blob Storage. Each blob contains:
- The serialized state object (JSON by default)
- Metadata including stream name, message ID, stream position, and global position
- Content type set to `application/json`

This approach provides natural partitioning by stream and enables efficient state retrieval for individual streams.