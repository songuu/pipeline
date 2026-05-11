# tekton-bridge

Go service that fronts a Tekton-on-Kubernetes execution kernel and exposes a
small HTTP API consumed by the Nest control plane.

## API

```
GET  /healthz
POST /v1/runs                       create a run; body = StartRunInput
GET  /v1/runs/{runId}               run status
POST /v1/runs/{runId}/cancel        cancel
GET  /v1/runs/{runId}/events        SSE stream of run events
```

Schemas are mirrored manually from `packages/shared/src/index.ts` (see
`internal/domain/run.go`).

## Backends

Two backends share the same `backend.Backend` interface.

| Backend | Build tag | Requires k8s | Use case |
|---|---|---|---|
| `SimulatedBackend` (default) | none | no | local dev, integration tests |
| `TektonBackend` | `tekton` | yes | real cluster with tektoncd/pipeline |

Default build:
```
go mod tidy
go build ./...
go run ./cmd/server
```

Tekton build (cluster required):
```
go build -tags tekton ./...
TEKTON_BRIDGE_BACKEND=tekton TEKTON_BRIDGE_NAMESPACE=ci go run -tags tekton ./cmd/server
```

When the `tekton` tag is enabled the consumer must add the corresponding
`require` blocks to `go.mod`:

```
require (
    github.com/tektoncd/pipeline v0.65.0
    k8s.io/client-go v0.30.0
)
```

This sprint scaffolded the Tekton backend as a stub; wiring real
`PipelineRun` CRD creation and watcher loops is the next sprint.

## Configuration

| Env | Default | Purpose |
|---|---|---|
| `TEKTON_BRIDGE_ADDR` | `:5050` | listen address |
| `TEKTON_BRIDGE_BACKEND` | `simulated` | `simulated` or `tekton` (build tag must match) |
| `TEKTON_BRIDGE_NAMESPACE` | `default` | k8s namespace (Tekton mode) |

## Smoke test

```
curl -s http://127.0.0.1:5050/healthz
curl -s -X POST http://127.0.0.1:5050/v1/runs -H 'content-type: application/json' \
  -d '{"pipelineRunId":"smoke-1","pipelineName":"smoke","applicationId":"demo","environment":"dev","stages":["source","test","build"]}'
curl -sN http://127.0.0.1:5050/v1/runs/smoke-1/events &
sleep 5
curl -s http://127.0.0.1:5050/v1/runs/smoke-1
```
