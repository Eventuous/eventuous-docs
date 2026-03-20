---
title: Introduction
sidebar:
  order: 1
---

# Eventuous for Go

Production-grade Event Sourcing library for Go, ported from [Eventuous](https://github.com/Eventuous/eventuous) (.NET).

## Installation

```bash
go get github.com/eventuous/eventuous-go/core
go get github.com/eventuous/eventuous-go/kurrentdb
```

## Design principles

- **Functional-first** — pure functions over OOP, type switch fold over handler registration
- **Idiomatic Go** — composition over inheritance, middleware chains, `context.Context` + errors
- **Multi-module** — import only what you need, no transitive dependency bloat

## Modules

| Module | Import | Description |
|--------|--------|-------------|
| **core** | `github.com/eventuous/eventuous-go/core` | Domain, persistence, command services, subscriptions |
| **kurrentdb** | `github.com/eventuous/eventuous-go/kurrentdb` | KurrentDB/EventStoreDB store and subscriptions |
| **otel** | `github.com/eventuous/eventuous-go/otel` | OpenTelemetry tracing and metrics |

## Source code

[github.com/eventuous/eventuous-go](https://github.com/eventuous/eventuous-go)
